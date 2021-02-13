var MongoClient = require("mongodb").MongoClient;
const url = 'mongodb://localhost:27017'
const dbName = 'sierpinski_db';
const coll = 'reconstructions';
const {parse} = require('json2csv');
const fs = require('fs');
const h2p = require('html2plaintext');
const readlineSync = require('readline-sync');
//const fields = ['field1', 'field2', 'field3'];
//const opts = { fields };

const client = new MongoClient(url,{ useUnifiedTopology: true });

async function run() {
    try {

        await client.connect();
        const database = client.db(dbName);
        const collection = database.collection(coll);

        //const session='9t2dta3yr5ft495kbpye61jl0fetalf8'
        const session=readlineSync.question('Numéro de session:');
        const offset_temps=readlineSync.questionInt("Offset de décalage (en millisecondes)? ");
        //const offset_temps = 1000000; //décalage temporel pour synchronisation
        const duree = readlineSync.questionInt("Durée de base d'un évènement? (en millisecondes) ");
        //const duree = 1000; //dureee de base d'un evenement pour ELAN
        const nomFic=readlineSync.question("Nom de fichier csv? ");
        //const nomFic="testruc";
        fs.writeFileSync(nomFic+".csv", '');
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
        const epr_max = await collection.findOne({}, {sort: {etape: -1}});
        const t_max = epr_max.commandes.temps + offset_temps; //temps de la dernièreaction EPR (normalement SNP+SAVE)
        //console.log("MAX TERMPS", t_max)
        //traitement des lancements/arrêts
        const promise1=collection.aggregate(aggEPR).toArray().then(r => {
                //construction du temps de fin de l'action
                r.forEach((c, i, a) => {
                    if (c.annotation=='START' || c.annotation=='EPR' || c.annotation=='PAUSE') {
                        c.temps_fin = i + 1 < a.length ? a[i + 1].temps_adjust : t_max;
                    } else if (c.annotation=='ASK' || c.annotation=='ANSW') {
                       // console.log("YOUYOU",c)
                       c.annotation=c.annotation+" <<"+c.acteur+">>"
                        c.acteur="ENTRÉES"
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
                el.forEach(e=>{
                    const a=e.change.match(/.*(<<.*>>).*/); //pour ajout ancienne valeur a?a[1]:''
                    c.annotation='('+c.annotation+'): '+h2p(e.commande);
                    c.temps_fin=Math.min(c.temps_adjust+duree,t_max);
                    //traitement si on a une boucle: on recherche l'indice de la boucle et la tête de script
                    // version simple, sans prise en compte de boucles imbriquées (sinon tester conteneurBlock?)
                    if (e.commande.match(/répéter/)) {
                        let instruction = e;
                        let niveauCommande = 1;
                        let niveauBoucle = 1;
                        while (instruction.prevBlock != null) {
                            instruction = c.commandes.snap.find(d => d.JMLid == instruction.prevBlock);
                            niveauCommande += 1
                            if (instruction.commande.match(/répéter/)) niveauBoucle += 1;
                        }
                        c.annotation = "i" + niveauCommande + "b" + niveauBoucle + c.annotation+ (a?a[1]:'')
                        c.acteur = '(BOUCLE)'+h2p(instruction.commande)
                    }
                })
            });
            return r;
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
        })
        promise1.then(tocsvElan);
        promise2.then(tocsvElan);
        promise3.then(tocsvElan);
        promise3.then(tocsv("VAL"))
        //console.log("wiat to finish")
        await Promise.all([promise1,promise2,promise3])
        //console.log("finished")
    } finally {
        await client.close()
        console.log("Session closed.")

    }

}

run().catch(console.dir);