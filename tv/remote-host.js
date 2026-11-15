/* Phone remote host. The page is served by the TV app on your home network; this points the shared settings page
   (src/options.js) at the TV: settings are read and saved on the TV, league lookups go through the TV's proxy. */
(function () {
  'use strict';
  const KEY = 'sideline-tv-code';
  let token = new URLSearchParams(location.search).get('k') || '';
  try { if (token) localStorage.setItem(KEY, token); else token = localStorage.getItem(KEY) || ''; } catch (e) { /* private mode: the link keeps working */ }
  const api = (path, opts) => fetch(path + (path.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(token), opts);
  const JSON_HEADERS = { 'Content-Type': 'application/json' };
  const pick = (o, k) => (k === null || k === undefined ? { ...o } : typeof k === 'string' ? { [k]: o[k] } : Object.fromEntries(k.map((x) => [x, o[x]])));

  async function ok(r) {
    if (r.status === 403) throw new Error('This link has an old code. Scan the QR code on the TV again.');
    if (!r.ok) {
      let error = 'The TV answered ' + r.status;
      try { error = (await r.json()).error || error; } catch (e) { /* keep the status line */ }
      throw new Error(error);
    }
    return r;
  }

  window.chrome = {
    storage: {
      sync: {
        get: async (k) => pick(await (await ok(await api('/api/settings'))).json(), k),
        set: async (patch) => { await ok(await api('/api/settings', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(patch) })); },
      },
      onChanged: { addListener() {} },
    },
  };
  self.SL_GET = async (url) => JSON.parse(await (await ok(await api('/api/fetch?url=' + encodeURIComponent(url)))).text());
  self.SL_PRIVATE_HINT = 'ESPN says that league is private. The TV can only read public ESPN leagues: in ESPN, League Manager → '
    + 'make the league viewable to the public, or use the Sideline Chrome extension on a computer.';
  self.SL_REMOTE = { cmd: async (msg) => (await ok(await api('/api/cmd', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(msg) }))).json() };
})();
