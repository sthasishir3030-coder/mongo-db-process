'use strict';
/**
 * lib/database.js - the data layer (MongoDB).
 * Every read/write of stored data happens here.
 *
 * Collections (database name: MONGODB_DB, default "portfolio"):
 *   admin     -> one document: the admin account (hashed password)
 *   visitors  -> people who signed in / were added by the admin
 *   sessions  -> login tokens (hashed). Expire automatically via a TTL index
 *   projects  -> project content (only served to approved people)
 *   limits    -> admin login attempt counters (TTL, works across serverless instances)
 */
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const SEED_PROJECTS = require('../data/projects.json'); // used only to fill an empty projects collection

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;

/* ---------- helpers ---------- */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function checkPassword(password, record) {
  const test = crypto.scryptSync(String(password), record.salt, 64);
  const real = Buffer.from(record.hash, 'hex');
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const keyOf = (name, school) => `${clean(name).toLowerCase()}|${clean(school).toLowerCase()}`;

/* ---------- connection (cached, so warm serverless calls reuse it) ---------- */
const cache = (globalThis.__portfolioMongo ??= { promise: null });

function getDb() {
  if (!cache.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set. Connect MongoDB in Vercel (Storage tab) or add it to .env.local.');
    const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    cache.promise = client
      .connect()
      .then((c) => setup(c.db(process.env.MONGODB_DB || 'portfolio')))
      .catch((err) => { cache.promise = null; throw err; }); // retry on next request
  }
  return cache.promise;
}

/** Runs once per cold start: indexes + first-time seeding. Safe to run repeatedly. */
async function setup(db) {
  const c = {
    admin: db.collection('admin'),
    visitors: db.collection('visitors'),
    sessions: db.collection('sessions'),
    projects: db.collection('projects'),
    limits: db.collection('limits'),
  };

  await Promise.all([
    c.visitors.createIndex({ key: 1 }, { unique: true }),
    c.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    c.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.sessions.createIndex({ visitorId: 1 }),
    c.limits.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
  ]);

  if (!(await c.admin.findOne({ _id: 'admin' }))) {
    const usingEnvPassword = Boolean(process.env.ADMIN_PASSWORD);
    await c.admin.updateOne(
      { _id: 'admin' },
      {
        $setOnInsert: {
          username: process.env.ADMIN_USERNAME || 'sishir',
          ...hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
          isDefaultPassword: !usingEnvPassword,
        },
      },
      { upsert: true }
    );
  }

  if ((await c.projects.estimatedDocumentCount()) === 0) {
    await c.projects.bulkWrite(
      SEED_PROJECTS.map((p) => ({
        updateOne: { filter: { _id: p.id }, update: { $setOnInsert: p }, upsert: true },
      }))
    );
  }
  return c;
}

/* ---------- validation ---------- */
function validateVisitor(input) {
  const name = clean(input?.name);
  const school = clean(input?.school);
  const age = Number(input?.age);

  if (name.length < 2 || name.length > 60) return { error: 'Please enter your full name (2-60 characters).' };
  if (school.length < 2 || school.length > 80) return { error: 'Please enter your school name (2-80 characters).' };
  if (!Number.isInteger(age) || age < 5 || age > 100) return { error: 'Please enter a valid age (5-100).' };
  return { value: { name, school, age } };
}

/* ---------- visitors ---------- */
const publicVisitor = (v) => ({
  id: v._id, name: v.name, school: v.school, age: v.age,
  hasAccess: v.hasAccess, createdAt: v.createdAt, lastLoginAt: v.lastLoginAt,
});

/** Visitor signs in. Same name + school = same person, so approval is remembered. */
async function loginVisitor(input) {
  const { error, value } = validateVisitor(input);
  if (error) return { error };
  const { visitors } = await getDb();

  const now = new Date().toISOString();
  const visitor = await visitors.findOneAndUpdate(
    { key: keyOf(value.name, value.school) },
    {
      $set: { age: value.age, lastLoginAt: now },
      $setOnInsert: {
        _id: crypto.randomUUID(), name: value.name, school: value.school,
        hasAccess: false, addedByAdmin: false, createdAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return { visitor: publicVisitor(visitor) };
}

async function listVisitors() {
  const { visitors } = await getDb();
  const all = await visitors.find().sort({ createdAt: -1 }).toArray();
  return all.map(publicVisitor);
}

async function addVisitor(input) {
  const { error, value } = validateVisitor(input);
  if (error) return { error };
  const { visitors } = await getDb();

  const now = new Date().toISOString();
  const visitor = await visitors.findOneAndUpdate(
    { key: keyOf(value.name, value.school) },
    {
      $set: { age: value.age, hasAccess: true },
      $setOnInsert: {
        _id: crypto.randomUUID(), name: value.name, school: value.school,
        addedByAdmin: true, createdAt: now, lastLoginAt: null,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return { visitor: publicVisitor(visitor) };
}

async function setAccess(id, hasAccess) {
  const { visitors } = await getDb();
  const v = await visitors.findOneAndUpdate(
    { _id: String(id) }, { $set: { hasAccess: Boolean(hasAccess) } }, { returnDocument: 'after' }
  );
  return v ? publicVisitor(v) : null;
}

async function removeVisitor(id) {
  const { visitors, sessions } = await getDb();
  const { deletedCount } = await visitors.deleteOne({ _id: String(id) });
  await sessions.deleteMany({ visitorId: String(id) });
  return deletedCount > 0;
}

/* ---------- admin ---------- */
async function verifyAdmin(username, password) {
  const { admin } = await getDb();
  const a = await admin.findOne({ _id: 'admin' });
  const userOk = clean(username).toLowerCase() === a.username.toLowerCase();
  const passOk = checkPassword(password, a); // always run, so timing doesn't leak the username
  return userOk && passOk;
}

async function changeAdminPassword(current, next) {
  const { admin, sessions } = await getDb();
  const a = await admin.findOne({ _id: 'admin' });
  if (!checkPassword(current, a)) return { error: 'Current password is incorrect.' };
  if (String(next).length < 8) return { error: 'New password must be at least 8 characters.' };
  await admin.updateOne({ _id: 'admin' }, { $set: { ...hashPassword(next), isDefaultPassword: false } });
  await sessions.deleteMany({ role: 'admin' }); // sign out other admin sessions
  return { ok: true };
}

/* ---------- admin login rate limit (stored in MongoDB so it works on serverless) ---------- */
async function tooManyAttempts(ip) {
  const { limits } = await getDb();
  const rec = await limits.findOne({ _id: String(ip), expireAt: { $gt: new Date() } });
  return Boolean(rec) && rec.count >= MAX_LOGIN_FAILURES;
}

async function noteFailure(ip) {
  const { limits } = await getDb();
  const id = String(ip);
  const res = await limits.updateOne({ _id: id, expireAt: { $gt: new Date() } }, { $inc: { count: 1 } });
  if (res.matchedCount === 0) {
    await limits.replaceOne(
      { _id: id }, { _id: id, count: 1, expireAt: new Date(Date.now() + LOGIN_WINDOW_MS) }, { upsert: true }
    );
  }
}

/* ---------- sessions ---------- */
async function createSession(role, visitorId = null) {
  const { sessions } = await getDb();
  const token = crypto.randomBytes(32).toString('hex');
  await sessions.insertOne({
    tokenHash: sha256(token), role, visitorId, expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

/** Returns the signed-in user for a token, or null. */
async function getUserByToken(token) {
  if (!token) return null;
  const { sessions, admin, visitors } = await getDb();
  const s = await sessions.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
  if (!s) return null;
  if (s.role === 'admin') {
    const a = await admin.findOne({ _id: 'admin' });
    return { role: 'admin', name: a.username, hasAccess: true, isDefaultPassword: Boolean(a.isDefaultPassword) };
  }
  const v = await visitors.findOne({ _id: s.visitorId });
  return v ? { role: 'visitor', ...publicVisitor(v) } : null;
}

async function destroySession(token) {
  if (!token) return;
  const { sessions } = await getDb();
  await sessions.deleteOne({ tokenHash: sha256(token) });
}

/* ---------- projects ---------- */
async function getProjects() {
  const { projects } = await getDb();
  return projects.find({}, { projection: { _id: 0 } }).sort({ id: 1 }).toArray();
}

module.exports = {
  loginVisitor, listVisitors, addVisitor, setAccess, removeVisitor,
  verifyAdmin, changeAdminPassword,
  tooManyAttempts, noteFailure,
  createSession, getUserByToken, destroySession, getProjects,
};
