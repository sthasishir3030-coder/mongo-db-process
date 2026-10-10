'use strict';
/**
 * lib/handleApi.js - all /api/* routes.
 * Used by BOTH the Vercel function (api/[...path].js) and the local server (server.js).
 */
const store = require('./database');

/* ---------- tiny helpers ---------- */
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const badRequest = (message) => Object.assign(new Error(message), { expose: true });

function readJson(req) {
  // Vercel has already parsed the body for us.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    try { return Promise.resolve(JSON.parse(String(req.body) || '{}')); }
    catch { return Promise.reject(badRequest('Invalid JSON')); }
  }
  // Local Node server: read the stream.
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10_000) { reject(badRequest('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(badRequest('Invalid JSON')); }
    });
  });
}

const getToken = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
const getIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

/* ---------- API ---------- */
async function handleApi(req, res) {
  const method = req.method;
  const pathname = new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '');

  try {
    const ip = getIp(req);
    const token = getToken(req);
    const user = await store.getUserByToken(token);

    // --- sign in / out ---
    if (method === 'POST' && pathname === '/api/login/visitor') {
      const { error, visitor } = await store.loginVisitor(await readJson(req));
      if (error) return send(res, 400, { error });
      const newToken = await store.createSession('visitor', visitor.id);
      return send(res, 200, { token: newToken, user: await store.getUserByToken(newToken) });
    }

    if (method === 'POST' && pathname === '/api/login/admin') {
      if (await store.tooManyAttempts(ip)) return send(res, 429, { error: 'Too many attempts. Try again in 10 minutes.' });
      const { username, password } = await readJson(req);
      if (!(await store.verifyAdmin(username, password))) {
        await store.noteFailure(ip);
        return send(res, 401, { error: 'Wrong username or password.' });
      }
      const newToken = await store.createSession('admin');
      return send(res, 200, { token: newToken, user: await store.getUserByToken(newToken) });
    }

    if (method === 'POST' && pathname === '/api/logout') {
      await store.destroySession(token);
      return send(res, 200, { ok: true });
    }

    // --- everything below needs a signed-in user ---
    if (!user) return send(res, 401, { error: 'Please sign in.' });

    if (method === 'GET' && pathname === '/api/me') return send(res, 200, { user });

    if (method === 'GET' && pathname === '/api/projects') {
      if (!user.hasAccess) return send(res, 403, { error: 'Project access has not been granted yet.' });
      return send(res, 200, { projects: await store.getProjects() });
    }

    // --- admin only ---
    if (pathname.startsWith('/api/admin/')) {
      if (user.role !== 'admin') return send(res, 403, { error: 'Admins only.' });

      if (method === 'GET' && pathname === '/api/admin/visitors') {
        return send(res, 200, { visitors: await store.listVisitors() });
      }
      if (method === 'POST' && pathname === '/api/admin/visitors') {
        const { error, visitor } = await store.addVisitor(await readJson(req));
        return error ? send(res, 400, { error }) : send(res, 201, { visitor });
      }
      const match = pathname.match(/^\/api\/admin\/visitors\/([\w-]+)$/);
      if (match && method === 'PATCH') {
        const body = await readJson(req);
        const visitor = await store.setAccess(match[1], body.hasAccess);
        return visitor ? send(res, 200, { visitor }) : send(res, 404, { error: 'Person not found.' });
      }
      if (match && method === 'DELETE') {
        return (await store.removeVisitor(match[1]))
          ? send(res, 200, { ok: true })
          : send(res, 404, { error: 'Person not found.' });
      }
      if (method === 'POST' && pathname === '/api/admin/password') {
        const { current, next } = await readJson(req);
        const result = await store.changeAdminPassword(current, next);
        if (result.error) return send(res, 400, { error: result.error });
        const newToken = await store.createSession('admin'); // keep this admin signed in
        return send(res, 200, { ok: true, token: newToken });
      }
    }

    return send(res, 404, { error: 'Not found.' });
  } catch (err) {
    if (err.expose) return send(res, 400, { error: err.message });
    console.error('API error:', err); // visible in Vercel logs; never shown to visitors
    return send(res, 500, { error: 'Server error. Please try again.' });
  }
}

module.exports = handleApi;
