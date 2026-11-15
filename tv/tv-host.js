/* Google TV host. Stands in for the chrome.* APIs inside the TV app's overlay WebView, so content.js, the engine and the
   box run unchanged. Everything goes through the app's own local server (same origin, token-checked):
   settings live in the app, API requests go through its proxy, and the phone remote's commands arrive via __slHost.

   Multiview: YouTube TV composes the grid on its servers and sends the TV one picture, so no app on the TV can see where
   the tiles are. The layout and which game sits in each tile come from the phone remote, and these rectangles follow the
   layouts YouTube TV uses for 2, 3 and 4 streams (pick the one that matches what you see). */
(function () {
  'use strict';
  const token = new URLSearchParams(location.search).get('k') || '';
  const api = (path, opts) => fetch(path + (path.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(token), opts);
  const pick = (o, k) => (k === null || k === undefined ? { ...o } : typeof k === 'string' ? { [k]: o[k] } : Object.fromEntries(k.map((x) => [x, o[x]])));
  const LOCAL = 'sideline-local';
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL) || '{}'); } catch (e) { return {}; } };

  let settings = {};
  const storageListeners = [], messageListeners = [];

  async function loadSettings() {
    const r = await api('/api/settings');
    if (!r.ok) throw new Error('The TV app did not answer (' + r.status + ')');
    settings = await r.json();
    return settings;
  }

  window.chrome = {
    storage: {
      sync: {
        get: async (k) => pick(await loadSettings(), k),
        set: async (patch) => { await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); },
      },
      local: {
        get: async (k) => pick(readLocal(), k),
        set: async (patch) => {
          try { localStorage.setItem(LOCAL, JSON.stringify({ ...readLocal(), ...patch })); }
          catch (e) { /* a full or blocked store only costs a re-download of the player list later */ }
        },
      },
      onChanged: { addListener: (f) => storageListeners.push(f) },
    },
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        if (!msg || msg.type !== 'fetch') { cb({ ok: false, error: 'Unknown request' }); return; }
        const cred = msg.opts && msg.opts.credentials === 'include' ? '&cred=1' : '';
        api('/api/fetch?url=' + encodeURIComponent(msg.url) + cred)
          .then(async (r) => {
            const body = await r.text();
            if (!r.ok) {
              let error = 'The TV app answered ' + r.status;
              try { error = JSON.parse(body).error || error; } catch (e) { /* not JSON: keep the status line */ }
              return cb({ ok: false, error });
            }
            return cb({ ok: true, json: JSON.parse(body), date: r.headers.get('X-Upstream-Date') });
          })
          .catch((e) => cb({ ok: false, error: e.message || String(e) }));
      },
      onMessage: { addListener: (f) => messageListeners.push(f) },
    },
  };

  /** Called by the app (Java) when the phone saved settings, and with a command from the phone remote. */
  window.__slHost = {
    settingsChanged(next) {
      const changes = {};
      for (const k of new Set([...Object.keys(settings), ...Object.keys(next)])) {
        if (JSON.stringify(settings[k]) !== JSON.stringify(next[k])) changes[k] = { oldValue: settings[k], newValue: next[k] };
      }
      settings = next;
      storageListeners.forEach((f) => f(changes, 'sync'));
    },
    command(id, msg) {
      let done = false;
      const reply = (r) => {
        if (done) return;
        done = true;
        if (window.SidelineAndroid) window.SidelineAndroid.reply(id, JSON.stringify(r || { ok: false }));
      };
      messageListeners.forEach((f) => f(msg, {}, reply));
      setTimeout(() => reply({ ok: false, error: 'No answer from the box' }), 1500);
    },
  };

  const LAYOUTS = self.SL.layouts.LAYOUTS;                      // tv/layouts.js, shared with the phone remote

  function createTracker({ win, getConfig, onChange }) {
    let sig = '';
    let tiles = [];
    const rescan = () => {
      const mv = getConfig().mv || {};
      const rects = LAYOUTS[mv.layout] ? LAYOUTS[mv.layout].rects(win.innerWidth, win.innerHeight) : [];
      const next = rects.map((rect, index) => ({ index, rect, network: null, assign: (mv.tiles || [])[index] || '' }));
      const s = JSON.stringify(next);
      if (s === sig) return;
      sig = s; tiles = next; onChange(next);
    };
    return { start() { rescan(); win.addEventListener('resize', rescan); }, stop() { win.removeEventListener('resize', rescan); }, rescan, tiles: () => tiles };
  }

  (self.SL = self.SL || {}).host = { tv: true, createTracker };
})();
