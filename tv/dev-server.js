/* Development only: a stand-in for the TV app's RemoteServer (android/src/.../RemoteServer.java), so the TV pages can be
   opened in a desktop browser. Same routes and same pairing-code check; API requests are answered by the scripted demo
   game in demo/fakeapi.js instead of the internet, and /api/cmd answers with a canned state.
   Run from the sideline folder:  node tv/dev-server.js   then open http://127.0.0.1:8138/tv/home.html?k=TEST42 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PORT = 8138, CODE = 'TEST42';
const ROOT = path.resolve(__dirname, '..');
const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data: https://a.espncdn.com; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', png: 'image/png', woff2: 'font/woff2' };

// The demo game script is our own file: run it in a sandbox that looks like a page.
const sandbox = { setTimeout, URL, Date, JSON };
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'demo', 'fakeapi.js'), 'utf8'), sandbox);
const fake = sandbox.FakeApi;

let settings = { enabled: true, sleeperUser: 'demo', espnLeagues: [], stream: 'cable', nudge: -4, corner: 'bl', mvCorner: 'auto', size: 'M',
  view: 'live', photos: true, moments: { td: true, fg: true, big: true, bad: true, play: false }, mv: { layout: 'off', tiles: [] } };

const send = (res, code, type, body, extra) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(extra || {}) }); res.end(body); };
const json = (res, code, obj) => send(res, code, 'application/json', JSON.stringify(obj));

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // Same refusals as RemoteServer.java: IP-only Host (no DNS rebinding), same-origin, JSON-only POSTs.
  if (!/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(req.headers.host || '')) return json(res, 400, { ok: false, error: 'Open the TV by its address, like the QR code does' });
  if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return json(res, 400, { ok: false, error: 'Cross-site request' });
  if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json')) return json(res, 400, { ok: false, error: 'Send JSON' });
  if (url.pathname === '/') { res.writeHead(302, { Location: '/tv/remote.html' + url.search }); return res.end(); }
  if (!url.pathname.startsWith('/api/')) {
    if (!/^\/(tv|src)\/[A-Za-z0-9_./-]+$/.test(url.pathname) || url.pathname.includes('..')) return send(res, 404, 'text/plain', 'Not found');
    const file = path.join(ROOT, url.pathname);
    const type = TYPES[path.extname(file).slice(1)];
    if (!type || !fs.existsSync(file)) return send(res, 404, 'text/plain', 'Not found');
    return send(res, 200, type, fs.readFileSync(file), type.startsWith('text/html') ? { 'Content-Security-Policy': CSP } : {});
  }
  if (url.searchParams.get('k') !== CODE) return json(res, 403, { ok: false, error: 'Wrong or old code. Scan the QR code on the TV again.' });
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    if (url.pathname === '/api/info') return json(res, 200, { lanUrl: `http://127.0.0.1:${PORT}/?k=${CODE}`, configured: 'Sleeper @' + settings.sleeperUser });
    if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, 200, settings);
    if (url.pathname === '/api/settings' && req.method === 'POST') { settings = { ...settings, ...JSON.parse(body) }; return json(res, 200, settings); }
    if (url.pathname === '/api/cmd') {
      const board = await fake.get('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
      const games = board.events.map((e) => ({ id: e.id, name: e.shortName, state: 'in', detail: 'Q2 6:12', teams: [], networks: [] }));
      return json(res, 200, { ok: true, hidden: false, delaySec: 3, leagues: 1, tiles: [], games, myGames: ['G1'], errors: [] });
    }
    if (url.pathname === '/api/fetch') {
      const data = await fake.get(url.searchParams.get('url'));
      return send(res, 200, 'application/json', JSON.stringify(data), { 'X-Upstream-Date': new Date().toUTCString() });
    }
    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (e) { return json(res, 502, { ok: false, error: e.message }); }
}).listen(PORT, '127.0.0.1', () => process.stdout.write(`TV dev server on http://127.0.0.1:${PORT}/tv/home.html?k=${CODE}\n`));
