/* Wires the engine to the overlay. Runs as the Chrome content script (top frame only) and, unchanged, inside the
   Google TV app's WebView, where tv-host.js stands in for the chrome.* APIs and supplies multiview tiles. */
(function () {
  'use strict';
  if (window.top !== window || window.__sidelineLoaded) return;
  window.__sidelineLoaded = true;
  const SL = self.SL;
  const host = SL.host || {};                                     // set by tv-host.js on the TV; empty in Chrome

  let cfg = SL.settings.merge({});
  let overlay = null, engine = null, tracker = null, built = null;
  let tiles = [], lastFrame = null, assigned = {}, tileSig = '', weekReloadAt = 0;
  let skew = 0;                                                   // ESPN's clock minus ours: play times are ESPN's

  const get = (url, opts) => new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: 'fetch', url, opts }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res || !res.ok) return reject(new Error((res && res.error) || 'Request failed'));
        const theirs = Date.parse(res.date || '');
        if (Number.isFinite(theirs) && /espn\.com/.test(url)) {
          const s = theirs - Date.now();
          skew = Math.abs(s) > 2000 ? s : 0;                      // the header has 1 s resolution: ignore jitter, fix real drift
        }
        return resolve(res.json);
      });
    } catch (e) { reject(new Error('Sideline was updated: reload this page')); }   // extension context invalidated
  });
  // Photos and the font come through the service worker as base64 (the streaming site's CSP may block ESPN's image host). The TV's page has no such CSP.
  const asset = (msg) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError || !r || !r.ok ? null : r)); } catch (e) { resolve(null); }
  });
  const photos = new Map();
  const loadImage = (url) => {
    if (!photos.has(url)) photos.set(url, asset({ type: 'image', url }).then((r) => { if (!r) photos.delete(url); return r ? `data:${r.type};base64,${r.b64}` : ''; }));
    return photos.get(url);
  };
  function loadFont() {
    if (host.tv || !self.FontFace) return;                        // the TV page declares its own @font-face
    asset({ type: 'font' }).then((r) => {
      if (!r) return;
      const bytes = Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0));
      const face = new FontFace('SidelineArchivo', bytes.buffer, { weight: '100 900', stretch: '62% 125%' });
      return face.load().then(() => document.fonts.add(face));
    }).catch(() => {});                                           // no font: the box falls back to the system UI font
  }
  const store = {
    get: async (k) => (await chrome.storage.local.get(k))[k],
    set: (k, v) => chrome.storage.local.set({ [k]: v }),
  };

  const delaySec = () => SL.settings.delaySecOf(cfg);
  const mineTeams = () => new Set(lastFrame ? lastFrame.leagues.flatMap((L) => L.me.rows.map((r) => r.team)) : []);
  const resolved = () => SL.multiview.resolveTiles(tiles, lastFrame ? lastFrame.games : [], assigned, mineTeams());
  const tileOf = (card) => { const t = card.gameId && resolved().find((x) => x.gameId === card.gameId); return t ? t.index : null; };

  // What the pill should say. Setup and league-loading problems can only be fixed in settings, so the engine's
  // routine "ok" or "retrying" must not wipe them.
  const statusOf = (s) => {
    if (!built) return { ok: true, setup: true };
    return built.errors.length ? { ok: false, config: true, error: built.errors.join(' ') } : s;
  };

  async function loadLeagues() {
    if (!cfg.sleeperUser && !(cfg.espnLeagues || []).length) {
      built = null; engine.setLeagues([]); overlay.setStatus(statusOf({ ok: true }));
      return;
    }
    try {
      const next = await SL.leagues.buildLeagues(get, cfg, store);
      // A rebuild that found nothing because of errors must not wipe leagues that were working a minute ago.
      if (!next.models.length && next.errors.length && built && built.models.length) built = { ...built, errors: next.errors };
      else { built = next; engine.setLeagues(next.models); }
    } catch (e) {
      built = built && built.models.length ? { ...built, errors: [e.message] } : { models: [], errors: [e.message], refreshLeague: () => Promise.resolve(null) };
      if (!built.models.length) engine.setLeagues([]);
    }
    overlay.setStatus(statusOf({ ok: true }));
  }

  function onFrame(f) {
    lastFrame = f;
    const sig = resolved().map((t) => t.gameId).join(',');
    if (sig !== tileSig) { tileSig = sig; overlay.setTiles(resolved()); }   // a tile just got matched to its game
    overlay.update(f);
    // A tab left open into the next week: rebuild lineups for the new week (at most twice an hour, in case the
    // sources disagree about which week it is for a while).
    if (f.week && built && built.week && f.week > built.week && Date.now() - weekReloadAt > 30 * 60000) {
      weekReloadAt = Date.now();
      loadLeagues();
    }
  }

  async function boot() {
    cfg = await SL.settings.load();
    loadFont();
    overlay = SL.overlay.createOverlay({ doc: document, win: window, getConfig: () => cfg, tv: !!host.tv, loadImage: host.tv ? null : loadImage });
    const makeTracker = host.createTracker || SL.multiview.createTracker;
    tracker = makeTracker({ doc: document, win: window, getConfig: () => cfg, onChange: (t) => { tiles = t; overlay.setTiles(resolved()); } });
    engine = SL.engine.createEngine({
      get, now: () => Date.now() + skew, settings: () => ({ delaySec: delaySec(), moments: cfg.moments }),
      onFrame,
      onCard: (c) => overlay.card(c, tileOf(c)),
      onStatus: (s) => overlay.setStatus(statusOf(s)),
      refreshLeague: (L) => (built ? built.refreshLeague(L) : Promise.resolve(null)),
    });
    tracker.start();
    await loadLeagues();
    engine.start();
    // A network blip at page load must not leave the box stuck on an error: try the leagues again every minute.
    window.setInterval(() => { if (built && built.errors.length) loadLeagues(); }, 60000);
  }

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync' || !overlay) return;
    const accounts = changes.sleeperUser || changes.espnLeagues;
    cfg = await SL.settings.load();
    if (accounts) await loadLeagues();
    if (tracker.rescan) tracker.rescan();                         // the TV's multiview layout lives in settings
    engine.retime();                                              // a new delay moves cards already waiting
    overlay.refresh();
  });

  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (!overlay) { reply({ ok: false }); return false; }
    if (m.type === 'state') {
      reply({ ok: true, hidden: overlay.isHidden(), delaySec: delaySec(), leagues: built ? built.models.length : 0,
        tiles: resolved(), games: lastFrame ? lastFrame.games : [], errors: built ? built.errors : [],
        myGames: lastFrame ? [...new Set(lastFrame.leagues.flatMap((L) => L.me.rows.map((r) => r.gameId)).filter(Boolean))] : [] });
    } else if (m.type === 'test') {
      overlay.test(SL.sample.frame(), SL.sample.card(m.kind)); reply({ ok: true });
    } else if (m.type === 'toggle') {
      overlay.setHidden(!overlay.isHidden()); reply({ ok: true, hidden: overlay.isHidden() });
    } else if (m.type === 'assign') {
      assigned = { ...assigned, [m.index]: m.gameId }; overlay.setTiles(resolved()); reply({ ok: true });
    } else return false;
    return false;
  });

  boot().catch((e) => { if (overlay) overlay.setStatus({ ok: false, error: e.message }); });
})();
