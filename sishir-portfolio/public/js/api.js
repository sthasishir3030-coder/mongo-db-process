/**
 * api.js - shared helper that talks to the Node server (server.js).
 * Works when the page is served by the server (http://localhost:3000)
 * and also when opened through VS Code Live Server or a file.
 */
const isLocalDev = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const API_BASE = isLocalDev && location.port !== '3000' ? 'http://localhost:3000' : '';
const TOKEN_KEY = 'sishir_portfolio_token';

const Auth = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set token(value) {
    try { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
  },
};

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(Auth.token ? { Authorization: 'Bearer ' + Auth.token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('Cannot reach the server. Start it with:  node server.js');
    err.network = true;
    throw err;
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Run an async action on a button: shows a spinner and blocks double clicks.
async function withBusy(button, action) {
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add('is-busy');
  try { return await action(); }
  finally { button.disabled = false; button.classList.remove('is-busy'); }
}
