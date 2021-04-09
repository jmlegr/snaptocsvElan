var MongoClient = require("mongodb").MongoClient;
const url = 'mongodb://localhost:27017'
const dbName = 'sierpinski_db';
const coll = 'reconstructions';
const {parse} = require('json2csv');
const fs = require('fs');
const h2p = require('html2plaintext');
const yargs = require("yargs");
const readlineSync = require('readline-sync');
//const fields = ['field1', 'field2', 'field3'];
//const opts = { fields };

const client = new MongoClient(url,{ useUnifiedTopology: true });

async function run() {
    try {

        await client.connect();
        const database = client.db(dbName);
        const collection = database.collection(coll);

        let session='imd2kp5g8wcnr49mqet8afczt6l4wf26'
        //const session=readlineSync.question('Numéro de session:');
        //const offset_temps=readlineSync.questionInt("Offset de décalage (en millisecondes)? ");
        const offset_temps = 1000000; //décalage temporel pour synchronisation
        //const duree = readlineSync.questionInt("Durée de base d'un évènement? (en millisecondes) ");
        const duree = 1000; //dureee de base d'un evenement pour ELAN
        //const nomFic=readlineSync.question("Nom de fichier csv? ");
        let nomFic="test_";
        const options = yargs
            .usage("Usage: -s <session>, -f <nomfic>")
            .option("s", { alias: "session", describe: "Session", type: "string", demandOption: true })
            .option("f",{ alias: "nomfic", describe: "Nom de fichier (base)", type: "string", demandOption: false })
            .argv;
        if (options.nomfic) nomFic=options.nomfic
        session=options.session

        const aggENV = [
            {
                '$match': {
                    'session_key': session,
                    'commandes.evt.evenement_type': 'ENV'
                }
            },{
                '$addFields': {
                    'temps_adjust': {
                        '$add': [
                            '$commandes.temps', offset_temps
                        ]
                    },
                    'acteur':'LOAD/SAVE',
                    'annotation': {
                        $concat: [
                            '$commandes.evt.type', '-', '$commandes.evt.detail']
                    }
                }
            }, {
                '$project': {'commandes':0}
            }
        ];
        const aggEPR = [
            {
                '$match': {
                    'session_key': session,
                    'commandes.epr': {
                        '$ne': null
                    },
                    'commandes.epr.type': {
                        '$ne': 'SNP'
                    }
                }
            }, {
                '$addFields': {
                    'temps_adjust': {
                        '$add': [
                            '$commandes.temps', offset_temps
                        ]
                    },
                    'truc': {
                        '$concat': [
                            '$commandes.epr.type', '--', '$commandes.epr.detail'
                        ]
                    },
                    'acteur':'$commandes.epr.detail',
                    'annotation':'$commandes.evt.type'
                }
            },{
                '$project': {'commandes':0}
            }
        ];
        const aggVal=[
            {
                '$match':{'session_key': session,'commandes.evt.type':/VAL/}
            }, {
                '$addFields': {
                    'temps_adjust': {
                        '$add': [
                            '$commandes.temps', offset_temps
                        ]
                    },
                    'truc': {
                        '$concat': [
                            '$commandes.epr.type', '--', '$commandes.epr.detail'
                        ]
                    },
                    'acteur':'VALEURS',
                    'annotation':'$commandes.evt.type'
                }
            }, {
                '$sort':{time:1}
            }


        ]
        const aggVar=[
            {
                '$match':{'session_key': session,'commandes.snap.selector':/Var/,'commandes.snap.truc':/me/}
            }, {
                '$addFields': {
                    'temps_adjust': {
                        '$add': [
                            '$commandes.temps', offset_temps
                        ]
                    },
                    'acteur':'VARIABLE',
                    'annotation':'$commandes.evt.type'
                }
            }, {
                '$sort':{time:1}
            }
        ]
        const epr_max = await collection.findOne({}, {sort: {etape: -1}});
        const t_max = epr_max.commandes.temps + offset_temps; //temps de la dernièreaction EPR (normalement SNP+SAVE)
        //console.log("MAX TERMPS", t_max)
        const chercheTete=(s,el)=>{
            //  renvoi la tête de script + numéro de boucle (si contenu) + numéro d'instruction
            let i=el
            let conteneur=i.conteneurBlock
            const repeat=el.selector=='doRepeat'
            let nb=repeat?0:1;
            let boucle=repeat?1:0;
            while (!repeat && i.prevBlock != null) {
                nb+=1
                i=s.find(d => d.JMLid == i.prevBlock)
                conteneur=i.conteneurBlock
            }
            if ((conteneur!=null && !conteneur.match(/SCRIPT/)) || repeat) {
                //on est dans une boucle, on cherche laquelle, on ne prend pas en compte les boucles imbriquée)
                if (!repeat) i = s.find(d => d.JMLid == conteneur)
                //console.log("find",i,conteneur)
                boucle=1
                if (i.selector != 'doRepeat') console.log('ERREUR PAS DANS UNE BOUCLE REPEAT')
                while  (i.prevBlock!=null) {
                    i=s.find(d => d.JMLid == i.prevBlock)
                    if (i.selector=='doRepeat') boucle+=1
                }
            }
            return {tete:i,contenu:conteneur?!conteneur.match(/SCRIPT/):false,nb:nb,boucle:boucle}
        }
        //traitement des lancements/arrêts
        const promise1=collection.aggregate(aggEPR).toArray().then(r => {
                //construction du temps de fin de l'action
                r.forEach((c, i, a) => {
                    if (c.annotation=='START'
                        || c.annotation=='STOP'
                        || c.annotation=='PAUSE'
                        || c.annotation=='FIN' ) {
                        c.temps_fin = i + 1 < a.length ? a[i + 1].temps_adjust : t_max;
                        console.log('XXXXXXXXXXXXXXXX',c)
                        c.annotation+=' '+c.acteur
                        c.acteur='EXECUTION'

                    } else if (c.annotation=='ASK' || c.annotation=='ANSW') {
                       // console.log("YOUYOU",c)
                       c.annotation=c.annotation+" <<"+c.acteur+">>"
                        c.acteur="ENTRÉE"
                        c.temps_fin = i + 1 < a.length ? a[i + 1].temps_adjust : t_max;
                    } else {
                        c.temps_fin = Math.min(c.temps_adjust + duree, i +1< a.length ? a[i + 1].temps_adjust : t_max);
                    }
                    //console.log(c.etape,  c.acteur, c.temps_adjust, c.temps_fin,c.annotation)
                });
                return r;
            }
        );
        //traitement des chargements/sauvegardes
        const promise2=collection.aggregate(aggENV).toArray().then(r => {
            r.forEach(c=>{
                c.temps_fin=Math.min(c.temps_adjust+duree,t_max)
            });
            return r;
        })
        //traitement des changements de valeurs (sans indication de script ou d'instruction)
        const promise3=collection.aggregate(aggVal).toArray().then(r=>{
            r.forEach((c,i,a)=>{
                const el=c.commandes.snap.filter(s=> (s.change!=null && s.change.match(/val_/)))
                el.forEach((e,i,liste)=>{
                    //console.log(e)
                    const anc=e.change.match(/.*(<<.*>>).*/); //pour ajout ancienne valeur a?a[1]:''
                    //console.log('anc:',a?a[1]:'--')
                    c.annotation='('+c.annotation+'): '+h2p(e.commande)+ (anc?anc[1]:'');
                    c.temps_fin=Math.min(c.temps_adjust+duree,t_max);
                    //traitement si on a une boucle: on recherche l'indice de la boucle et la tête de script
                    /*
                    // version simple, sans prise en compte de boucles imbriquées (sinon tester conteneurBlock?)
                    //if (e.commande.match(/répéter/)) {
                        let instruction = e;
                        let niveauCommande = 1;
                        let niveauBoucle = (e.commande.match(/répéter/)?1:0);
                        while (instruction.prevBlock != null) {
                            instruction = c.commandes.snap.find(d => d.JMLid == instruction.prevBlock);
                            niveauCommande += 1
                            if (instruction.commande.match(/répéter/)) niveauBoucle += 1;
                        }
                        c.annotation = "i" + niveauCommande + "b" + niveauBoucle + c.annotation//+ (anc?anc[1]:'')
                        c.acteur = (e.commande.match(/répéter/)?'(BOUCLE)':'')+h2p(instruction.commande)
                    //}
                     */
                    const o=chercheTete(a[i].commandes.snap,e)
                    c.acteur+=(e.commande.match(/répéter/)?'(BOUCLE)':'')+h2p(o.tete.commande)+'('+o.tete.JMLid+')'
                    c.annotation = 'b'+o.boucle+(o.contenu?"i" + o.nb:'') + c.annotation//+ (anc?anc[1]:'')

                })
            });
            return r;
        })
        //Opérations sur les variables

        const promise4=collection.aggregate(aggVar).toArray().then(r=>{
            const retour=[]
            r.forEach(e=>{
                e.commandes.snap.forEach(c=>{
                    if (c.selector !=null && c.selector.match(/Var/) && c.truc.match(/me/)) {
                        const o=chercheTete(e.commandes.snap,c)
                        const a=c.truc.match(/.*(<<.*>>).*/)
                        //console.log(o, h2p(c.commande), a?a[1]:"",c.truc.match(/me (.*)/)[1])
                        //console.log(o.contenu?"contenu b"+o.boucle:"","i"+o.nb)
                        console.log('TETE',o.tete)
                        e.acteur='(VARIABLE)'+h2p(o.tete.commande)+'('+o.tete.JMLid+')'
                        e.annotation=(o.contenu?"(b"+o.boucle:"(")+"i"+o.nb+") "+ h2p(c.commande)+" ["+c.truc.match(/me (.*)/)[1]+"]"
                        e.temps_fin=Math.min(e.temps_adjust+duree,t_max);
                        retour.push(e)
                    }
                })
            })
            return retour
        })
        const tocsvElan=result => {
            try {
                const csv = parse(result, {
                    fields: ["acteur",
                        "temps_adjust", "temps_fin",
                        "annotation"],
                    header: false,
                });
                fs.appendFileSync(nomFic+".csv", csv+'\n');
            } catch (err) {
                console.error(err);
            }
        };
        const tocsv=s=>result=> {
            //idem tocsvElan mais dans un fichhier à part, %s complément de nom
            try {
                const csv = parse(result, {
                    fields: ["acteur",
                        "temps_adjust", "temps_fin",
                        "annotation"],
                    header: false,
                });
                fs.appendFileSync(nomFic+"_"+s+".csv", csv+'\n');

            } catch (err) {
                console.error(err);
            }
        }

        collection.findOne({session_key:session,commandes:{$exists:false}}).then(infos=> {
            console.log("Traitement de la session:", session)
            console.log(infos.user, " le ", infos.infos.date)
            console.log("Type: ", infos.infos.type)
            console.log("Base créée le ", infos.date)
            nomFic+=infos.user+"_"+infos.infos.date;
            fs.writeFileSync(nomFic+".csv", '');
        })
        promise1.then(tocsvElan);
        promise2.then(tocsvElan);
        promise3.then(tocsvElan);
        promise4.then(tocsvElan);
        //promise3.then(tocsv("VAL"))
       // promise4.then(tocsv('VAR'))
        //console.log("wiat to finish")
        await Promise.all([promise1,promise2,promise3,promise4])

        //console.log("finished")
    } finally {
        await client.close()
        //const session='ezffdsfefesfscfsfsefsefsef'
        /*
        const utf8 = require('utf8');
        const msg=utf8.encode(`https://api.telegram.org/bot1590159741:AAHznnhWe0x62DeC_uspGEx0fAtHWmLdfnA/sendMessage?chat_id=-1001207327242&text="rendu ${session} terminé"`)
        const fetch = require("node-fetch");

        fetch(msg)
            .then(response=>response.json())
            .then(response=>console.log('réponse recue:',response))

         */
        console.log("Session closed.")

    }

}

run().catch(console.dir);