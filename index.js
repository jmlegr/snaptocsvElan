var MongoClient = require("mongodb").MongoClient;
const url = 'mongodb://localhost:27017'
const dbName = 'sierpinski_db';
const coll = 'reconstructions';
const {parse} = require('json2csv');
const fs = require('fs');
const h2p = require('html2plaintext');
var readlineSync = require('readline-sync');
//const fields = ['field1', 'field2', 'field3'];
//const opts = { fields };

const client = new MongoClient(url);

async function run() {
    try {

        await client.connect();
        const database = client.db(dbName);
        const collection = database.collection(coll);

        const filter = {session_key: 'wq2cu9duflxspderesgz57qr8t05w8jf', 'commandes.epr': {$ne: null}}
        //const offset_temps=readlineSync.questionInt("Offset de décalage (en millisecondes)? ");
        const offset_temps = 1000000; //décalage temporel pour synchronisation
        //const duree = readlineSync.questionInt("Durée de base d'un évènement? (en millisecondes) ");
        const duree = 1000; //dureee de base d'un evenement pour ELAN
        //const nomFic=readlineSync.question("Nom de fichier csv? ");
        const nomFic="testruc";
        fs.writeFileSync(nomFic+".csv", '');
        const aggENV = [
            {
                '$match': {
                    'session_key': 'iptrff5x17betctynr3xuwi19duaphy2',
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
                    'session_key': 'iptrff5x17betctynr3xuwi19duaphy2',
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
                '$match':{'session_key': 'iptrff5x17betctynr3xuwi19duaphy2','commandes.evt.type':/VAL/}
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
                   // if (c.commandes.epr.type == "START" || c.commandes.epr.type == "REPR" || c.commandes.epr.type == "PAUSE") {
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
                    //const a=e.change.match(/.*(<<.*>>).*/); //pour ajout ancienne valeur a?a[1]:''
                    c.annotation='('+c.annotation+'): '+h2p(e.commande);
                    c.temps_fin=Math.min(c.temps_adjust+duree,t_max)
                })
            });
            return r;
        })
        const tocsv=result => {
            try {
                const csv = parse(result, {
                    fields: ["acteur",
                        "temps_adjust", "temps_fin",
                        "annotation"],
                    header: false,
                });
                //fs.writeFileSync(nomFic+".csv", csv);
                fs.appendFileSync(nomFic+".csv", csv+'\n');
                //console.log(csv);
            } catch (err) {
                console.error(err);
            }
        };
        promise1.then(tocsv);
        promise2.then(tocsv);
        promise3.then(tocsv)
    } finally {
        await client.close()

    }

    /*
    db.collection("reconstructions").aggregate(agg).toArray(function (err,result) {

        if (err) throw err;
        console.log("ok",result);
        const fs=require('fs');
        try {
            const csv = parse(result,{fields:["commandes.temps","commandes.epr"]});
            fs.writeFileSync("testcsv.csv",csv);
            console.log(csv);
        } catch (err) {
            console.error(err);
        }
    })
*/
}

run().catch(console.dir);