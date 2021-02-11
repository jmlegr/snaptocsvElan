var MongoClient = require("mongodb").MongoClient;
const url = 'mongodb://localhost:27017'
const dbName = 'sierpinski_db';
const coll = 'reconstructions';
const {parse} = require('json2csv');
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
        const offset_temps=readlineSync.questionInt("Offset de décalage (en millisecondes)? ");
        //const offset_temps = 1000000; //décalage temporel pour synchronisation
        const duree = readlineSync.questionInt("Durée de base d'un évènement? (en millisecondes) ");
        //const duree = 1000; //dureee de base d'un evenement pour ELAN
        const nomFic=readlineSync.question("Nom de fichier csv? ");
        const agg = [
            {
                '$match': {
                    'session_key': 'wq2cu9duflxspderesgz57qr8t05w8jf',
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
                    }
                }
            }
        ];
        const epr_max = await collection.findOne({}, {sort: {etape: -1}});
        const t_max = epr_max.commandes.temps + offset_temps; //temps de la dernièreaction EPR (normalement SNP+SAVE)
        //console.log("MAX TERMPS", t_max)
        collection.aggregate(agg).toArray().then(r => {
                //construction du temps de fin de l'action
                r.forEach((c, i, a) => {
                    if (c.commandes.epr.type == "START" || c.commandes.epr.type == "REPR" || c.commandes.epr.type == "PAUSE") {
                        c.temps_fin = i + 1 < a.length ? a[i + 1].temps_adjust : t_max;
                    } else {
                        c.temps_fin = Math.min(c.temps_adjust + duree, i < a.length ? a[i + 1].temps_adjust : t_max);
                    }
                    console.log(c.etape, c.commandes.epr.type, c.temps_adjust, c.temps_fin)
                });
                return r;
            }
        ).then(result => {
            const fs = require('fs');
            try {
                const csv = parse(result, {
                    fields: ["commandes.epr.detail",
                        "temps_adjust", "temps_fin",
                        "commandes.epr.type"]
                });
                fs.writeFileSync(nomFic+".csv", csv);
                console.log(csv);
            } catch (err) {
                console.error(err);
            }
        })

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