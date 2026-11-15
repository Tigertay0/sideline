/* Demo harness, live mode (?live in multiview.html): the Sleeper side is simulated with a league made of REAL players from a game
   that is on right now (demo/live-lineup.json, written by a helper script), while every ESPN request goes to ESPN for real.
   It exercises the actual content script, overlay and engine against a live game without needing anyone's account. */
(function () {
  'use strict';
  const real = window.FakeApi.get;
  const PPR = { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2, xpm: 1, fgm_0_19: 3, fgm_20_29: 3,
    fgm_30_39: 3, fgm_40_49: 4, fgm_50_59: 5, sack: 1, int: 2, fum_rec: 2, def_td: 6, pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1,
    pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4 };
  let cached = null;
  const lineup = async () => cached || (cached = await (await fetch('live-lineup.json')).json());

  async function sleeper(path) {
    const L = (await lineup()).starters;
    const pid = (s, i) => (s.pos === 'DEF' ? s.team : 'p' + i);
    const half = L.slice(0, Math.ceil(L.length / 2));            // first half is "me", the rest is the opponent
    const rest = L.slice(half.length);
    const players = {};
    L.forEach((s, i) => { if (s.pos !== 'DEF') players[pid(s, i)] = { espn_id: i % 2 ? null : Number(s.espnId), full_name: s.name, position: s.pos === 'WR' ? 'WR' : s.pos, team: s.team === 'WSH' ? 'WAS' : s.team }; });   // odd ones have no ESPN id, like Sleeper's real data
    const ids = (arr) => arr.map((s) => pid(s, L.indexOf(s)));
    const routes = {
      '/state/nfl': { week: 10, league_season: '2026', season: '2026' },
      '/user/demo': { user_id: 'u1' },
      '/user/u1/leagues/nfl/2026': [{ league_id: 'L1', name: 'Live Game League', scoring_settings: PPR, roster_positions: L.map((s) => (s.pos === 'DEF' ? 'DEF' : s.pos)) }],
      '/league/L1/rosters': [{ roster_id: 1, owner_id: 'u1' }, { roster_id: 2, owner_id: 'u2' }],
      '/league/L1/matchups/10': [{ roster_id: 1, matchup_id: 1, starters: ids(half) }, { roster_id: 2, matchup_id: 1, starters: ids(rest) }],
      '/league/L1/users': [{ user_id: 'u1', display_name: 'me', metadata: { team_name: 'LIVE TEST' } }, { user_id: 'u2', display_name: 'RIVAL' }],
      '/players/nfl': players,
    };
    if (!routes[path]) throw new Error('live harness has no ' + path);
    return routes[path];
  }

  window.FakeApi.get = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.sleeper.app') return sleeper(u.pathname.replace(/^\/v1/, ''));
    const r = await fetch('/espn?url=' + encodeURIComponent(url));   // ESPN: the real feed, through demo/live-server.js
    if (!r.ok) throw new Error(u.hostname + ' answered ' + r.status);
    return r.json();
  };
  window.FakeApi.real = real;
})();
