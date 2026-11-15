/* Demo harness: a scripted WSH @ NYG game served in ESPN's and Sleeper's response shapes. Real players, invented plays:
   a rushing TD, a field goal and a 38-yard catch arrive a few seconds apart so the delay logic can be watched live. */
(function () {
  'use strict';
  const PPR = { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, xpm: 1, fgm_40_49: 4, fgm_30_39: 3, fgm_50_59: 5,
    sack: 1, int: 2, fum_rec: 2, def_td: 6, pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0 };

  const SLEEPER = {
    '/state/nfl': { week: 10, league_season: '2026', season: '2026' },
    '/user/demo': { user_id: 'u1' },
    '/user/u1/leagues/nfl/2026': [{ league_id: 'L1', name: 'Harness League', scoring_settings: PPR, roster_positions: ['QB', 'RB', 'TE', 'K', 'DEF', 'BN'] }],
    '/league/L1/rosters': [{ roster_id: 1, owner_id: 'u1' }, { roster_id: 2, owner_id: 'u2' }],
    '/league/L1/matchups/10': [{ roster_id: 1, matchup_id: 1, starters: ['qb1', 'rb1', 'te1', 'k1', 'NYG'] }, { roster_id: 2, matchup_id: 1, starters: ['x1'] }],
    '/league/L1/users': [{ user_id: 'u1', display_name: 'me', metadata: { team_name: 'BALL KNOWERS' } }, { user_id: 'u2', display_name: 'TANK SZN' }],
    '/players/nfl': {
      qb1: { espn_id: 4426348, full_name: 'Jayden Daniels', position: 'QB', team: 'WAS' }, rb1: { espn_id: 4696981, full_name: 'Cam Skattebo', position: 'RB', team: 'NYG' },
      te1: { espn_id: 4361050, full_name: 'Isaiah Likely', position: 'TE', team: 'NYG' }, k1: { espn_id: 5081335, full_name: 'Drew Stevens', position: 'K', team: 'WAS' },
      x1: { espn_id: 2976212, full_name: 'Stefon Diggs', position: 'WR', team: 'WAS' },
    },
  };

  const state = { plays: [], rush: 0, rushTd: 0, rec: 0, recYds: 0, fg: 0 };
  let seq = 100;
  const push = (type, text, yds, scoring) => {
    seq += 100;
    state.plays.push({ id: 'DP' + seq, sequenceNumber: String(seq), type: { text: type }, text, scoringPlay: !!scoring, statYardage: yds,
      wallclock: new Date().toISOString(), start: { team: { id: '19' }, downDistanceText: '2nd & 7' } });
  };
  // The scripted game: seconds after page load -> what happens.
  const SCRIPT = [
    [3, () => { state.rush = 4; state.rushTd = 1; push('Rushing Touchdown', 'C.Skattebo right end for 4 yards, TOUCHDOWN.', 4, true); }],
    [13, () => { state.fg = 1; push('Field Goal Good', 'D.Stevens 46 yard field goal is GOOD, Center-T.Ott, Holder-T.Way.', 0, true); }],
    [23, () => { state.rec = 1; state.recYds = 38; push('Pass Reception', 'J.McCarthy pass deep left to I.Likely for 38 yards (K.Medrano).', 38, false); }],
  ];
  SCRIPT.forEach(([s, fn]) => setTimeout(fn, s * 1000));

  const comp = (id, abbr, home, score) => ({ id, homeAway: home ? 'home' : 'away', score: String(score), team: { abbreviation: abbr } });
  const event = (id, name, net, a, b) => ({ id, shortName: name, date: new Date().toISOString(), status: { type: { state: 'in', shortDetail: 'Q2 6:12' }, period: 2, displayClock: '6:12' },
    competitions: [{ broadcasts: [{ names: [net] }], competitors: [comp(a[0], a[1], false, 7), comp(b[0], b[1], true, 3)] }] });

  const board = () => ({ week: { number: 10 }, season: { year: 2026 }, events: [
    event('G1', 'WSH @ NYG', 'Fox', ['28', 'WSH'], ['19', 'NYG']), event('G2', 'KC @ ATL', 'CBS', ['12', 'KC'], ['1', 'ATL']),
    event('G3', 'SF @ DAL', 'NBC', ['25', 'SF'], ['6', 'DAL']), event('G4', 'LAC @ BAL', 'ESPN', ['24', 'LAC'], ['33', 'BAL']) ] });

  const athlete = (id, name, stats) => ({ athlete: { id, displayName: name }, stats });
  const summary = () => ({
    header: { id: 'G1', competitions: [{ status: { type: { state: 'in', shortDetail: 'Q2 6:12' }, period: 2, displayClock: '6:12' },
      competitors: [comp('19', 'NYG', true, 3 + state.rushTd * 6), comp('28', 'WSH', false, 7 + state.fg * 3)] }] },
    boxscore: { players: [
      { team: { abbreviation: 'NYG' }, statistics: [
        { name: 'rushing', keys: ['rushingAttempts', 'rushingYards', 'yardsPerRushAttempt', 'rushingTouchdowns', 'longRushing'],
          athletes: [athlete('4696981', 'Cam Skattebo', [String(state.rush ? 1 : 0), String(state.rush), '4.0', String(state.rushTd), String(state.rush)])] },
        { name: 'receiving', keys: ['receptions', 'receivingYards', 'yardsPerReception', 'receivingTouchdowns', 'longReception', 'receivingTargets'],
          athletes: [athlete('4361050', 'Isaiah Likely', [String(state.rec), String(state.recYds), '0', '0', String(state.recYds), String(state.rec)])] }] },
      { team: { abbreviation: 'WSH' }, statistics: [
        { name: 'kicking', keys: ['fieldGoalsMade/fieldGoalAttempts', 'fieldGoalPct', 'longFieldGoalMade', 'extraPointsMade/extraPointAttempts', 'totalKickingPoints'],
          athletes: [athlete('5081335', 'Drew Stevens', [`${state.fg}/${state.fg}`, '100', state.fg ? '46' : '0', '0/0', String(state.fg * 3)])] }] }] },
    drives: { previous: [{ plays: state.plays }] },
  });

  const clone = (x) => JSON.parse(JSON.stringify(x));
  async function get(url) {
    const u = new URL(url);
    if (u.hostname === 'api.sleeper.app') {
      const key = u.pathname.replace(/^\/v1/, '');
      if (SLEEPER[key]) return clone(SLEEPER[key]);
      throw new Error(`fake Sleeper has no ${key}`);
    }
    if (u.pathname.endsWith('/scoreboard')) return board();
    if (u.pathname.endsWith('/summary')) {
      const id = u.searchParams.get('event');
      if (id === 'G1') return summary();
      return { header: { id, competitions: [{ status: { type: { state: 'in', shortDetail: 'Q2' }, period: 2, displayClock: '6:12' }, competitors: [] }] }, boxscore: { players: [] }, drives: { previous: [] } };
    }
    throw new Error('fake API has no ' + url);
  }
  window.FakeApi = { get, state };
})();
