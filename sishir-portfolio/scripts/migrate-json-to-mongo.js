'use strict';
/**
 * One-time import of the OLD data/db.json (admin + visitors) into MongoDB.
 *   npm run migrate
 * Safe to run more than once. Sessions are not copied (everyone just signs in again).
 */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

(async () => {
  const file = path.join(__dirname, '..', 'data', 'db.json');
  if (!fs.existsSync(file)) return console.log('No data/db.json found - nothing to migrate.');
  if (!process.env.MONGODB_URI) return console.log('MONGODB_URI is not set (run: vercel env pull .env.local).');

  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  const client = await new MongoClient(process.env.MONGODB_URI).connect();
  const db = client.db(process.env.MONGODB_DB || 'portfolio');
  const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

  if (old.admin) {
    await db.collection('admin').replaceOne({ _id: 'admin' }, { _id: 'admin', ...old.admin }, { upsert: true });
    console.log('Admin account copied (same password as before).');
  }
  let count = 0;
  for (const v of old.visitors || []) {
    const { id, ...rest } = v;
    await db.collection('visitors').updateOne(
      { key: `${clean(v.name)}|${clean(v.school)}` },
      { $setOnInsert: { _id: id, ...rest } },
      { upsert: true }
    );
    count += 1;
  }
  console.log(`${count} visitor(s) imported.`);
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
