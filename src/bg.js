/* Service worker. Its one job: fetch the score and league APIs for the page's content script. Doing it here keeps the
   requests out of the streaming site's CSP and lets a private ESPN league use the viewer's own espn.com sign-in.
   Only our own extension contexts can message this worker (no externally_connectable), and it only talks to four score and league APIs
   plus ESPN's image host (headshots and team logos, by exact path shape). */
'use strict';

const API = {
  'site.api.espn.com': '/apis/site/v2/sports/football/nfl/',
  'sports.core.api.espn.com': '/v2/sports/football/leagues/nfl/',   // the fast play feed (src/core/espn.js, CORE)
  'api.sleeper.app': '/v1/',
  'lm-api-reads.fantasy.espn.com': '/apis/v3/games/ffl/',
};
const ESPN_FANTASY = 'lm-api-reads.fantasy.espn.com';

// Player photos and the box's font come back as base64, so the page never loads them itself: a streaming site's CSP can block both.
const IMAGES = { 'a.espncdn.com': /^\/combiner\/i\?img=\/i\/(headshots\/nfl\/players\/full\/\d{1,10}|teamlogos\/nfl\/500\/[a-z]{2,3})\.png&w=\d{2,3}&h=\d{2,3}$/ };
const MAX_ASSET = 400000;
const toBase64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };

function fetchAsset(msg, reply) {
  let url;
  if (msg.type === 'font') url = new URL(chrome.runtime.getURL('src/ui/fonts/archivo.woff2'));
  else {
    try { url = new URL(msg.url); } catch (e) { reply({ ok: false, error: 'Bad address' }); return; }
    const rule = IMAGES[url.hostname];
    if (url.protocol !== 'https:' || url.port || !rule || !rule.test(url.pathname + url.search)) { reply({ ok: false, error: 'Not an image Sideline asks for' }); return; }
  }
  fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) })
    .then(async (r) => {
      if (!r.ok) throw new Error(`${url.hostname} answered ${r.status}`);
      const type = msg.type === 'font' ? 'font/woff2' : (r.headers.get('content-type') || '').split(';')[0];
      if (msg.type !== 'font' && type !== 'image/png') throw new Error('Not a picture');
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > MAX_ASSET) throw new Error('Too large');
      reply({ ok: true, b64: toBase64(bytes), type });
    })
    .catch((e) => reply({ ok: false, error: e.message || String(e) }));
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && (msg.type === 'image' || msg.type === 'font')) { fetchAsset(msg, reply); return true; }
  if (!msg || msg.type !== 'fetch') return false;
  let url;
  try { url = new URL(msg.url); } catch (e) { reply({ ok: false, error: 'Bad address' }); return false; }
  const prefix = API[url.hostname];
  if (url.protocol !== 'https:' || url.port || !prefix || !url.pathname.startsWith(prefix)) {
    reply({ ok: false, error: `${url.hostname}${url.pathname} is not something Sideline asks for` });
    return false;
  }
  // Cookies go to ESPN Fantasy only, and only when the caller asked for the viewer's sign-in; a redirect is an error, not a detour.
  const credentials = url.hostname === ESPN_FANTASY && msg.opts && msg.opts.credentials === 'include' ? 'include' : 'omit';
  let date = null;
  // A hung request must not stall the poll loop. The Date header lets the page line its clock up with ESPN's play times.
  fetch(url, { credentials, redirect: 'error', signal: AbortSignal.timeout(10000) })
    .then((r) => { if (!r.ok) throw new Error(`${url.hostname} answered ${r.status}`); date = r.headers.get('date'); return r.json(); })
    .then((json) => reply({ ok: true, json, date }), (e) => reply({ ok: false, error: e.name === 'TimeoutError' ? `${url.hostname} took too long` : (e.message || String(e)) }));
  return true;                                                  // reply is async
});

chrome.runtime.onInstalled.addListener(({ reason }) => { if (reason === 'install') chrome.runtime.openOptionsPage(); });
