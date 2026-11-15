/* Development only: static server for the demo harness plus an ESPN proxy that identifies itself honestly as Sideline, the way the
   TV app's own proxy does (ESPN refuses headless-browser user agents, and a test harness should not pretend to be a real browser).
   Run from the sideline folder:  node demo/live-server.js   then open http://127.0.0.1:8137/demo/multiview.html?live */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', png: 'image/png' };
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/';

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/espn') {
    const target = url.searchParams.get('url') || '';
    if (!target.startsWith(ESPN)) { res.writeHead(400); return res.end('only ESPN NFL feeds'); }
    try {
      const r = await fetch(target, { headers: { 'User-Agent': 'Sideline/0.1 (demo harness)' } });
      res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(502); return res.end(e.message); }
  }
  const rel = decodeURIComponent(url.pathname);
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).slice(1)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  return res.end(fs.readFileSync(file));
}).listen(8137, '127.0.0.1', () => process.stdout.write('demo server on http://127.0.0.1:8137\n'));
