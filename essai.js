var MongoClient = require("mongodb").MongoClient;
const url = 'mongodb://localhost:27017'
const dbName = 'sierpinski_db';
const coll = 'reconstructions';
const {parse} = require('json2csv');
const fs = require('fs');
var readlineSync = require('readline-sync');
const h2p = require('html2plaintext')
//const fields = ['field1', 'field2', 'field3'];
//const opts = { fields };

const client = new MongoClient(url);


async function run() {
    try {
        console.log("ok1")
        await client.connect();
        const database = client.db(dbName);
        const collection = database.collection(coll);
        const filter={session_key: '9t2dta3yr5ft495kbpye61jl0fetalf8','commandes.evt.type':/VAL/}
        collection.find(filter,{sort:{time:1}}).toArray().then(result=>{
            //console.log('ok',result)
            result.forEach(r=>{
                const i=r.commandes.evt.detail;
                //const el=r.commandes.snap.filter(s=>(s.JMLid==i) || (s.truc!= null && s.truc.match(/me/)))
                const el=r.commandes.snap.filter(s=> (s.change!=null && s.change.match(/val_/)))
                el.forEach(e=>{
                    const a=e.change.match(/.*(<<.*>>).*/)
                    console.log(r.etape,r.commandes.temps,h2p(e.commande),a?a[1]:'',e.change)
                    if (e.commande.match(/répéter/)) {
                        console.log("trouver l'origine")
                        // on remonte simplement (pa de prise en compte de boucle imbriquées
                        let instruction=e;
                        let niveauCommande=1;
                        let niveauBoucle=1;
                        while (instruction.prevBlock!= null) {
                            instruction=r.commandes.snap.find(d=>d.JMLid==instruction.prevBlock);
                            niveauCommande+=1
                            if (instruction.commande.match(/répéter/)) niveauBoucle+=1;
                        }
                        console.log('tete',instruction,'niveau',niveauCommande,'boucle',niveauBoucle)
                        /*let tetes=r.commandes.snap.filter(d=>d.commande
                            && ((d.conteneurBlock==null && d.prevBlock==null)
                                ||
                                (d.conteneurBlock!=null && d.conteneurBlock.indexOf('SCRIPT')!=-1 )))
                        console.log("tetes",tetes)*/
                    }
                })
                //e.change.replace(/(.*)(<<.*>>).*/,"XX $2 XX")
            })

        })

    } finally {
        await client.close()

    }
}

run().catch(console.dir);