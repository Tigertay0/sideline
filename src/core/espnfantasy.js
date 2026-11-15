/* ESPN Fantasy leagues. Public leagues need nothing; a private league works when you are signed in to espn.com in this
   browser (the extension's requests carry your own cookies, so there is no two-minute computer step).
   ESPN scores the lineup itself, so this source hands the engine finished points instead of scoring rules.
   NOTE: the response shape below follows ESPN's v3 fantasy API as documented by the community; it is exercised by
   a fixture in test/, not yet against a live league. */
(function (root) {
  'use strict';
  const S = typeof require !== 'undefined' ? require('./scoring') : root.SL.scoring;

  const API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
  const PRO_TEAMS = { 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC',
    13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
    25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU' };
  const POSITIONS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
  const SLOTS = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 7: 'OP', 16: 'DEF', 17: 'K', 23: 'FLEX' };
  const NOT_STARTING = new Set([20, 21]);                    // bench, injured reserve

  /** Accepts any fantasy.espn.com league or team link. */
  function parseLeagueUrl(url) {
    let u;
    try { u = new URL(url.trim()); } catch (e) { throw new Error('Paste the address of your league from fantasy.espn.com.'); }
    const leagueId = u.searchParams.get('leagueId');
    if (!/(^|\.)espn\.com$/.test(u.hostname)) throw new Error('That is not an ESPN address. Open your league on fantasy.espn.com and copy the address bar.');
    if (!leagueId) throw new Error('That address has no leagueId. Open your league on fantasy.espn.com (not the app) and copy the address bar.');
    const teamId = u.searchParams.get('teamId'), season = u.searchParams.get('seasonId');
    // These go into a request path that carries the viewer's ESPN cookies: digits only.
    if (!/^\d{1,12}$/.test(leagueId) || (teamId && !/^\d{1,3}$/.test(teamId)) || (season && !/^\d{4}$/.test(season))) {
      throw new Error('That address has an odd leagueId, teamId or seasonId. Copy it straight from the address bar on fantasy.espn.com.');
    }
    return { leagueId, teamId, season };
  }

  const url = (id, season, week, views) =>
    `${API}/seasons/${season}/segments/0/leagues/${id}?scoringPeriodId=${week}&` + views.map((v) => 'view=' + v).join('&');

  async function listTeams(get, leagueId, season, week) {
    const j = await get(url(leagueId, season, week, ['mTeam', 'mSettings']), { credentials: 'include' });
    return { name: (j.settings && j.settings.name) || 'ESPN league', teams: (j.teams || []).map((t) => ({ id: t.id, name: t.name || `${t.location} ${t.nickname}`.trim() })) };
  }

  function starters(side) {
    const roster = side && (side.rosterForCurrentScoringPeriod || side.rosterForMatchupPeriod);
    return ((roster && roster.entries) || []).filter((e) => !NOT_STARTING.has(e.lineupSlotId)).map((e) => {
      const pe = e.playerPoolEntry || {};
      const p = pe.player || {};
      const pos = POSITIONS[p.defaultPositionId] || 'FLEX';
      const team = PRO_TEAMS[p.proTeamId] || '';
      const defense = pos === 'DEF';
      return {
        key: 'espn' + (e.playerId || pe.id), espnId: defense ? null : String(e.playerId || pe.id), name: defense ? `${team} D/ST` : p.fullName,
        pos, team: S.normTeam(team), slot: SLOTS[e.lineupSlotId] || pos, pts: Math.round((pe.appliedStatTotal || 0) * 100) / 100,
      };
    });
  }

  /** Build one league model. `ref` = { leagueId, teamId, season }. Also used to refresh points. */
  async function loadLeague(get, ref, week, labelText) {
    const j = await get(url(ref.leagueId, ref.season, week, ['mBoxscore', 'mMatchupScore', 'mTeam', 'mSettings']), { credentials: 'include' });
    const me = Number(ref.teamId);
    const m = (j.schedule || []).find((s) => s.matchupPeriodId === week && ((s.home && s.home.teamId === me) || (s.away && s.away.teamId === me)));
    if (!m) return null;
    const mine = m.home.teamId === me ? m.home : m.away;
    const theirs = mine === m.home ? m.away : m.home;
    const name = (id) => { const t = (j.teams || []).find((x) => x.id === id); return (t && (t.name || `${t.location} ${t.nickname}`.trim())) || 'Team ' + id; };
    return {
      id: 'espn:' + ref.leagueId, platform: 'espn', source: 'points', label: labelText || ((j.settings && j.settings.name) || 'ESPN').slice(0, 8).toUpperCase(),
      name: (j.settings && j.settings.name) || 'ESPN league', scoring: null, week,
      me: { name: name(mine.teamId), starters: starters(mine) },
      opp: theirs ? { name: name(theirs.teamId), starters: starters(theirs) } : null,
    };
  }

  const api = { parseLeagueUrl, listTeams, loadLeague, starters };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).espnFantasy = api;
})(typeof self !== 'undefined' ? self : globalThis);
