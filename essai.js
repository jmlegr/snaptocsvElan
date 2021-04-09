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
        console.log("ok1",new Date('2018-03-20T00:00:00'))
        await client.connect();
        const database = client.db(dbName);
        const collection = database.collection(coll);
        const filter={session_key: 'wq2cu9duflxspderesgz57qr8t05w8jf','commandes.evt.type':/VAL/}
        const filter0={session_key: 'wq2cu9duflxspderesgz57qr8t05w8jf',commandes:{'$exists':false}}
        const filter1={ 'commandes':{'$exists': false}}
        const filter2={
            'commandes': {
                '$exists': false
            },
            '$expr': {
                '$gte': [
                    {
                        '$dateFromString': {
                            'dateString': '$infos.date'
                        }
                    }, new Date('Mon, 19 Mar 2018 23:00:00 GMT')
                ]
            }
        }
        const t=collection.find(filter2).toArray().then(r=>{r.forEach(e=>console.log(e.infos.date)); console.log('tot',r.length)})tex
        await t
        console.log("ok2")
        const aggVar=[
            {
                '$match':{'session_key': 'wq2cu9duflxspderesgz57qr8t05w8jf','commandes.snap.selector':/Var/,'commandes.snap.truc':/me/}
            }, {
                '$addFields': {
                    'temps_adjust': {
                        '$add': [
                            '$commandes.temps', 1000
                        ]
                    },
                    'truc': {
                        '$concat': [
                            '$commandes.epr.type', '--', '$commandes.epr.detail'
                        ]
                    },
                    'acteur':'VARIABLE',
                    'annotation':'$commandes.evt.type'
                }
            }, {
                '$sort':{time:1}
            }


        ]
        const chercheTete=(s,el)=>{
            let i=el
            let conteneur=i.conteneurBlock
            let nb=1
            let boucle=0
            while (i.prevBlock != null) {
                nb+=1
                i=s.find(d => d.JMLid == i.prevBlock)
                conteneur=i.conteneurBlock
                }
            if (conteneur!=null && !conteneur.match(/SCRIPT/)) {
                //on est dans une boucle, on cherche laquelle, on ne prend pas en compte les boucles imbriquée)
                i=s.find(d => d.JMLid == conteneur)
                console.log("find",i,conteneur)
                boucle=1
                if (i.selector != 'doRepeat') console.log('ERREUR PAS DANS UNE BOUCLE REPEAT')
                while  (i.prevBlock!=null) {
                    i=s.find(d => d.JMLid == i.prevBlock)
                    if (i.selector=='doRepeat') boucle+=1
                }
            }
            return {tete:i,contenu:conteneur?!conteneur.match(/SCRIPT/):false,nb:nb,boucle:boucle}
        }
        const prom=collection.aggregate(aggVar).toArray().then(r=>{
            r.forEach(e=>{
                e.commandes.snap.forEach(c=>{
                    if (c.selector !=null && c.selector.match(/Var/) && c.truc.match(/me/)) {
                        const o=chercheTete(e.commandes.snap,c)
                        const a=c.truc.match(/.*(<<.*>>).*/)
                        console.log(o, h2p(c.commande), a?a[1]:"",c.truc.match(/me (.*)/)[1])
                        console.log(o.contenu?"contenu b"+o.boucle:"","i"+o.nb)
                        e.acteur='(VARIABLE)'+h2p(o.tete.commande)
                        e.annotation=(o.contenu?"(b"+o.boucle:"(")+"i"+o.nb+") "+ h2p(c.commande)+" ["+c.truc.match(/me (.*)/)[1]+"]"
                    }
                })
            })
            return r
        }).then(r=>console.log(r))
        await prom


} finally {
        await client.close()

    }
}

run().catch(console.dir);