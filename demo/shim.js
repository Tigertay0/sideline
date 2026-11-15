/* Demo harness: a stand-in for the chrome.* APIs so the real content script runs unmodified in a plain page.
   Config comes from window.__cfg; network requests are answered by fakeapi.js (no internet needed). */
(function () {
  'use strict';
  const listeners = { runtime: [], storage: [] };
  const sync = { ...(window.__cfg || {}) };
  const local = {};
  const pick = (o, k) => (k === null || k === undefined ? { ...o } : typeof k === 'string' ? { [k]: o[k] } : Object.fromEntries(k.map((x) => [x, o[x]])));

  window.chrome = {
    storage: {
      sync: { get: async (k) => pick(sync, k), set: async (patch) => {
        const changes = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { oldValue: sync[k], newValue: v }]));
        Object.assign(sync, patch);
        listeners.storage.forEach((f) => f(changes, 'sync'));
      } },
      local: { get: async (k) => pick(local, k), set: async (patch) => { Object.assign(local, patch); } },
      onChanged: { addListener: (f) => listeners.storage.push(f) },
    },
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        Promise.resolve().then(() => window.FakeApi.get(msg.url)).then((json) => cb({ ok: true, json }), (e) => cb({ ok: false, error: e.message }));
      },
      onMessage: { addListener: (f) => listeners.runtime.push(f) },
    },
  };

  /** What the popup does: ask the content script something and wait for its reply. */
  window.__ask = (msg) => new Promise((resolve) => {
    let replied = false;
    listeners.runtime.forEach((f) => f(msg, {}, (r) => { replied = true; resolve(r); }));
    setTimeout(() => { if (!replied) resolve(undefined); }, 200);
  });
  window.__setCfg = (patch) => window.chrome.storage.sync.set(patch);
})();
