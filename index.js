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

        let session='wrafil0cpbqpqc305rpkcjpuvxqzusj9'
        //const session=readlineSync.question('Numéro de session:');
        //const offset_temps=readlineSync.questionInt("Offset de décalage (en millisecondes)? ");
        let offset_temps = 1000000; //décalage temporel pour synchronisation ou pour suite fichiers

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


        const epr_max = await collection.findOne({}, {sort: {etape: -1}});
        const t_max = epr_max.commandes.temps + offset_temps; //temps de la dernièreaction EPR (normalement SNP+SAVE)
        //console.log("MAX TERMPS", t_max)

        let aggVar, aggVal, aggEPR, aggENV,debut_temps
        await collection.findOne({session_key:session,commandes:{$exists:false}}).then(infos=> {
            console.log("Traitement de la session:", session)
            console.log(infos.user, " le ", infos.infos.date)
            console.log("Type: ", infos.infos.type)
            console.log("Base créée le ", infos.date)
            nomFic+=infos.user+"_"+infos.infos.date;
            debut_temps=new Date(infos.infos.date).getTime()
            console.log('OFFSET:',offset_temps)
            aggENV = [
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
            aggEPR = [
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
            aggVal=[
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
                                '$commandes.spr.blockSpec', '--', '$commandes.spr.location'
                            ]
                        },
                        'detail': '$commandes.spr.blockId',
                        'acteur':'VALEURS',
                        'annotation':'$commandes.evt.type'
                    }
                }, {
                    '$sort':{time:1}
                }


            ]
            aggVar=[
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
            fs.writeFileSync(nomFic+".csv", '');
        })
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
                boucle=1
                if (i.selector != 'doRepeat') console.log('ERREUR PAS DANS UNE BOUCLE REPEAT')
                while  (i.prevBlock!=null) {
                    i=s.find(d => d.JMLid == i.prevBlock)
                    if (i.selector=='doRepeat') boucle+=1
                }
            }
            return {tete:i,contenu:conteneur?!conteneur.match(/SCRIPT/):false,nb:nb,boucle:boucle,repeat:repeat}
        }
        //traitement des lancements/arrêts

        let z=async (c)=>{
            let r=await collection.findOne({session_key:session,etape:c.etape})
            let tete=chercheTete(r.commandes.snap,c)
            console.log("TTET",tete)
            return c
        }
        /*
        console.log(z)
        let f=async () => {
            const value = async ()=> collection.aggregate(aggEPR).forEach(r=> {
                r=z(r)
            })
            await value()

            return "ok"
        };
         await f();
*/

        const promise1=collection.aggregate(aggEPR).toArray().then(r => {
                //construction du temps de fin de l'action
            let promises=[]
                r.forEach((c, i, a) => {
                    if (c.annotation=='START'
                        || c.annotation=='STOP'
                        || c.annotation=='PAUSE'
                        || c.annotation=='FIN' ) {
                        c.temps=debut_temps+c.temps_adjust
                        c.temps_string=new Date(c.temps).toISOString()
                        c.temps_fin = i + 1 < a.length ? a[i + 1].temps_adjust : t_max;
                        c.annotation+=' '+c.acteur
                        const tete=c.acteur.match(/.*\((.*)\).*/)
                        c.idScript=tete?tete[1]:'??'
                        c.nomScript=c.acteur
                        c.acteur='EXECUTION'

                    } else if (c.annotation=='ASK' || c.annotation=='ANSW') {
                       //console.log("YOUYOU",c)
                        c.idScript=''
                        c.nomScript=''
                       c.annotation=c.annotation+" <<"+c.acteur+">>"
                        c.acteur="ENTRÉE"
                        //console.log("YYYY",c,a)
                        c.temps=debut_temps+c.temps_adjust
                        c.temps_string=new Date(c.temps).toISOString()
                        c.temps_fin = i + 1 < a.length ? a[i + 1].temps_adjust : t_max;
                    } else {
                        //console.log("ZZZZZZZ",c)
                        c.idScript='ZZZZ'
                        c.nomScript='ZZZ'
                        c.temps=debut_temps+c.temps_adjust
                        c.temps_string=new Date(c.temps).toISOString()
                        c.temps_fin = Math.min(c.temps_adjust + duree, i +1< a.length ? a[i + 1].temps_adjust : t_max);
                    }
                    //console.log(c.etape,  c.acteur, c.temps_adjust, c.temps_fin,c.annotation)
                    //await z(c)
                });
            //await Promise.all(promises)
                //return r,Promise.all(promises);
                return r;
            }
        );

        //traitement des chargements/sauvegardes
        const promise2=collection.aggregate(aggENV).toArray().then(r => {
            r.forEach(c=>{
                c.temps=debut_temps+c.temps_adjust
                c.temps_string=new Date(c.temps).toISOString()
                c.temps_fin=Math.min(c.temps_adjust+duree,t_max)
                c.idScript=''
                c.nomScript=''
            });
            return r;
        })
        //traitement des changements de valeurs (sans indication de script ou d'instruction)
        const promise3=collection.aggregate(aggVal).toArray().then(r=>{
            r.forEach((c,i,a)=>{
                const el=c.commandes.snap.filter(s=> (s.change!=null && s.change.match(/val_/)))
                el.forEach(e=>{
                    const anc=e.change.match(/.*(<<.*>>).*/); //pour ajout ancienne valeur anc?anc[1]:''
                    c.annotation='('+c.annotation+'): '+h2p(e.commande)+ (anc?anc[1]:'');
                    c.temps=debut_temps+c.temps_adjust
                    c.temps_string=new Date(c.temps).toISOString()
                    c.temps_fin=Math.min(c.temps_adjust+duree,t_max);
                    const o=chercheTete(a[i].commandes.snap,e)
                    c.idScript=o.tete.JMLid
                    c.nomScript=h2p(o.tete.commande)+'('+o.tete.JMLid+')'
                    //c.acteur+=(e.commande.match(/répéter/)?'(BOUCLE)':'')+h2p(o.tete.commande)+'('+o.tete.JMLid+')'
                    c.annotation = (e.commande.match(/répéter/)?'(BOUCLE)':'')+'b'+o.boucle+"i" + o.nb + c.annotation//+ (anc?anc[1]:'')

                })
            });
            return r;
        })
        //Opérations sur les variables

        const promise4=collection.aggregate(aggVar).toArray().then(r=>{
            const retour=[]
            r.forEach(e=>{
                e.commandes.snap.forEach(c=>{
                    if (c.selector !=null && c.selector.match(/Var/) && c.truc!=null && c.truc.match(/me/)) {
                        const o=chercheTete(e.commandes.snap,c)
                        const a=c.truc.match(/.*(<<.*>>).*/)
                        e.idScript=o.tete.JMLid
                        e.nomScript=h2p(o.tete.commande)+'('+o.tete.JMLid+')'
                        //e.acteur='(VARIABLE)'+h2p(o.tete.commande)+'('+o.tete.JMLid+')' //pour ELAN
                        e.annotation=(o.contenu?"(b"+o.boucle:"(")+"i"+o.nb+") "+ h2p(c.commande)+" ["+c.truc.match(/me (.*)/)[1]+"]"
                        e.temps=debut_temps+e.temps_adjust
                        e.temps_string=new Date(e.temps).toISOString()
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
                    fields: ["acteur","nomScript","idScript","temps","temps_string",
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
                    fields: ["acteur","temps","temps_string",
                        "temps_adjust", "temps_fin",
                        "annotation"],
                    header: false,
                });
                fs.appendFileSync(nomFic+"_"+s+".csv", csv+'\n');

            } catch (err) {
                console.error(err);
            }
        }


        promise1.then(tocsvElan),
        promise2.then(tocsvElan);
        promise3.then(tocsvElan);
        promise4.then(tocsvElan);
        await Promise.all([promise1, promise2, promise3, promise4])
/*
        //promise3.then(tocsv("VAL"))
       // promise4.then(tocsv('VAR'))
        //console.log("wiat to finish")
        let ret=new Array()
        let resultats=Promise.all([promise1, promise2, promise3, promise4])
            .then(r=>Array.prototype.concat.apply([],r))
            .then(r=>Promise.all(r.map(z)))

        await resultats
        console.log("RESusklt",resultats)

 */
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