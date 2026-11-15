/* Turns the saved accounts (Sleeper username, ESPN league links) into league models for the engine.
   `get` fetches JSON, `store` is a small async key/value cache (chrome.storage.local in the extension). */
(function (root) {
  'use strict';
  const need = (path, key) => (typeof require !== 'undefined' ? require(path) : root.SL[key]);
  const Sleeper = need('./sleeper', 'sleeper');
  const EF = need('./espnfantasy', 'espnFantasy');

  const META_TTL = 24 * 3600 * 1000;                         // trades and signings move players between teams

  async function buildLeagues(get, cfg, store, nowMs = Date.now()) {
    const state = await get(Sleeper.API + '/state/nfl');
    const week = state.week, season = state.league_season || state.season;
    const models = [], errors = [], raw = new Map();
    const cached = await store.get('slMeta');
    const stale = !cached || !cached.at || nowMs - cached.at > META_TTL;
    let meta = stale ? {} : cached.players || {};
    const metaAt = stale ? nowMs : cached.at;

    if (cfg.sleeperUser) {
      try {
        const { userId, leagues } = await Sleeper.findLeagues(get, cfg.sleeperUser, season);
        for (const lg of leagues) {
          try {
            const r = await Sleeper.loadLeague(get, userId, lg, week, meta);
            if (!r) continue;                                   // no matchup this week (bye, or out of the playoffs)
            meta = r.meta;
            models.push(r.model);
            raw.set(r.model.id, () => Sleeper.loadLeague(get, userId, lg, week, meta).then((x) => { if (x) meta = x.meta; return x && x.model; }));
          } catch (e) { errors.push(`Sleeper "${lg.name}": ${e.message}`); }   // one broken league must not hide the others
        }
      } catch (e) { errors.push('Sleeper: ' + e.message); }
      await store.set('slMeta', { at: metaAt, players: meta });
    }

    for (const ref of cfg.espnLeagues || []) {
      try {
        const m = await EF.loadLeague(get, ref, week, ref.label);
        if (!m) continue;
        models.push(m);
        raw.set(m.id, () => EF.loadLeague(get, ref, week, ref.label));
      } catch (e) {
        const priv = /\b40[13]\b/.test(e.message) ? ' (private league: sign in to espn.com in this browser, then reload)' : '';
        errors.push(`ESPN ${ref.leagueId}: ${e.message}${priv}`);
      }
    }

    return { models, errors, week, season, refreshLeague: (L) => (raw.has(L.id) ? raw.get(L.id)() : Promise.resolve(null)) };
  }

  const api = { buildLeagues };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).leagues = api;
})(typeof self !== 'undefined' ? self : globalThis);
