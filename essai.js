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
        /*
         * Requires the MongoDB Node.js Driver
         * https://mongodb.github.io/node-mongodb-native
         */

        const agg = [
            {
                '$project': {
                    'sel': {
                        '$reduce': {
                            'input': '$commandes.snap.selector',
                            'initialValue': [],
                            'in': {
                                '$concatArrays': [
                                    '$$value', [
                                        '$$this'
                                    ]
                                ]
                            }
                        }
                    }
                }
            }, {
                '$unwind': {
                    'path': '$sel'
                }
            }, {
                '$group': {
                    '_id': null,
                    'sel': {
                        '$addToSet': '$sel'
                    }
                }
            }
        ];
        collection.aggregate(agg).toArray().then(r=>console.log(r))



} finally {
        await client.close()

    }
}

run().catch(console.dir);