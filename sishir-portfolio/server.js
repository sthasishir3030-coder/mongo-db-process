'use strict';
/**
 * server.js - LOCAL development server (Vercel doesn't use this file).
 *   npm install
 *   vercel env pull .env.local      # gets MONGODB_URI from your Vercel project
 *   npm run dev                     # -> http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const handleApi = require('./lib/handleApi');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  // Allow the page to be opened from VS Code Live Server (localhost:5501) too.
  const origin = req.headers.origin || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (pathname.startsWith('/api/')) return handleApi(req, res);
  return serveStatic(res, pathname);
}).listen(PORT, () => {
  console.log(`\n  Portfolio running at  http://localhost:${PORT}`);
  if (!process.env.MONGODB_URI) console.log('  ! MONGODB_URI is not set. Run:  vercel env pull .env.local');
  console.log('');
});
