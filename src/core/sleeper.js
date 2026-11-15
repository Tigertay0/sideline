/* Sleeper leagues: username -> leagues -> my lineup and my opponent's lineup for the week.
   Sleeper's API is public and read-only, so there is nothing to sign in to. */
(function (root) {
  'use strict';
  const S = typeof require !== 'undefined' ? require('./scoring') : root.SL.scoring;

  const API = 'https://api.sleeper.app/v1';
  const BENCH = new Set(['BN', 'IR', 'TAXI']);

  const label = (name) => {
    const n = String(name).trim();
    if (n.length <= 8) return n.toUpperCase();
    return n.split(/\s+/).map((w) => w[0]).join('').slice(0, 5).toUpperCase();
  };

  async function findLeagues(get, username, season) {
    const user = await get(`${API}/user/${encodeURIComponent(username.trim())}`);
    if (!user || !user.user_id) throw new Error('That Sleeper username was not found. Use the @name under your picture, not your team name.');
    const leagues = await get(`${API}/user/${user.user_id}/leagues/nfl/${season}`);
    return { userId: user.user_id, leagues: leagues || [] };
  }

  /** `meta` is a { sleeperPlayerId: { espnId, name, pos, team } } cache the caller keeps. Missing ids trigger one big download. */
  async function fillMeta(get, pids, meta) {
    const need = pids.filter((p) => p && !meta[p] && !/^[A-Z]{2,3}$/.test(p));
    if (!need.length) return meta;
    const all = await get(`${API}/players/nfl`);
    const next = { ...meta };
    for (const pid of need) {
      const p = all[pid];
      if (p) next[pid] = { espnId: p.espn_id ? String(p.espn_id) : null, name: p.full_name || `${p.first_name} ${p.last_name}`, pos: p.position, team: p.team };
    }
    return next;
  }

  function starterOf(pid, slot, meta) {
    if (/^[A-Z]{2,3}$/.test(pid)) {                          // team defenses are keyed by team abbreviation
      const team = S.normTeam(pid);
      return { key: pid, espnId: null, name: `${team} D/ST`, pos: 'DEF', team, slot };
    }
    const m = meta[pid] || {};
    return { key: pid, espnId: m.espnId || null, name: m.name || pid, pos: m.pos || slot, team: S.normTeam(m.team || ''), slot };
  }

  function lineup(roster, matchup, positions, meta) {
    const slots = positions.filter((p) => !BENCH.has(p));
    const starters = (matchup.starters || []).map((pid, i) => ({ pid, slot: slots[i] || 'FLEX' })).filter((s) => s.pid && s.pid !== '0');
    // Sleeper's own live points for each starter: the league's number, every scoring rule included (engine.js calibrate()).
    const pp = matchup.players_points || {};
    return starters.map((s) => ({ ...starterOf(s.pid, s.slot, meta), official: typeof pp[s.pid] === 'number' ? pp[s.pid] : null }));
  }

  /** Build one league model for this week. Returns { model, pids } where pids still need metadata. */
  async function loadLeague(get, userId, league, week, meta) {
    const id = league.league_id;
    const [rosters, matchups, users] = await Promise.all([
      get(`${API}/league/${id}/rosters`), get(`${API}/league/${id}/matchups/${week}`), get(`${API}/league/${id}/users`),
    ]);
    const mine = (rosters || []).find((r) => r.owner_id === userId || (r.co_owners || []).includes(userId));
    if (!mine) return null;
    const mm = (matchups || []).find((m) => m.roster_id === mine.roster_id);
    if (!mm) return null;                                    // bye week or no matchup set yet
    // matchup_id is null for teams out of the playoffs: two nulls are not an opponent
    const oo = mm.matchup_id == null ? null : matchups.find((m) => m.matchup_id === mm.matchup_id && m.roster_id !== mine.roster_id);
    const teamName = (r) => {
      const u = users.find((x) => x.user_id === (r && r.owner_id));
      return (u && ((u.metadata && u.metadata.team_name) || u.display_name)) || 'Opponent';
    };
    const oppRoster = oo && rosters.find((r) => r.roster_id === oo.roster_id);
    const allPids = [...(mm.starters || []), ...((oo && oo.starters) || [])];
    const full = await fillMeta(get, allPids, meta);
    const positions = league.roster_positions || [];
    return {
      meta: full,
      model: {
        id: 'sleeper:' + id, platform: 'sleeper', source: 'box', label: label(league.name), name: league.name,
        scoring: league.scoring_settings || {}, week,
        me: { name: teamName(mine), starters: lineup(mine, mm, positions, full) },
        opp: oo ? { name: teamName(oppRoster), starters: lineup(oppRoster, oo, positions, full) } : null,
      },
    };
  }

  const api = { API, label, findLeagues, fillMeta, loadLeague };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).sleeper = api;
})(typeof self !== 'undefined' ? self : globalThis);
