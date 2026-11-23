'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/core/scoring');
const E = require('../src/core/espn');
const Sleeper = require('../src/core/sleeper');
const EF = require('../src/core/espnfantasy');
const { createEngine, describe: describePlay, momentOf, phi } = require('../src/core/engine');

const summaryJson = require('./fixtures/wsh-nyg-summary.json');
const scoreboardJson = require('./fixtures/scoreboard.json');

// Sleeper's default "PPR" scoring, the numbers every other test is checked against by hand.
const PPR = { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2, xpm: 1,
  fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50_59: 5, fgm_60p: 5, fgmiss: -1,
  sack: 1, int: 2, fum_rec: 2, def_td: 6, pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.011, `${a} is not ${b}`);

test('scoreboard: week, games, networks', () => {
  const sb = E.parseScoreboard(scoreboardJson);
  assert.equal(sb.week, 10);
  assert.equal(sb.games.length, 14);
  const final = sb.games.find((g) => g.id === '401873052');
  assert.equal(final.state, 'post');
  assert.equal(final.fracLeft, 0);
  assert.ok(sb.games.some((g) => g.networks.includes('Fox')));
  assert.ok(sb.games.every((g) => g.teams.length === 2));
});

test('summary: plays are ordered, timestamped, and field goals are found in text', () => {
  const g = E.parseSummary(summaryJson);
  assert.equal(g.state, 'post');
  assert.equal(g.plays.length, 188);
  assert.ok(g.plays.every((p, i) => i === 0 || g.plays[i - 1].seq <= p.seq));
  assert.equal(g.feedTime, Date.parse('2026-11-13T04:19:27Z'));
  assert.deepEqual(g.fgs.map((f) => [f.who, f.dist, f.good]), [['D.Zvada', 33, false], ['D.Stevens', 46, true]]);
});

test('scoring: real WSH @ NYG box score under PPR, checked by hand', () => {
  const g = E.parseSummary(summaryJson);
  const pts = (id, name, pos, team) => S.playerPoints({ espnId: id, name, pos, team }, g, PPR);
  close(pts('4426348', 'Jayden Daniels', 'QB', 'WSH'), 249 * 0.04 + 3 * 4 - 2 * 2 + 28 * 0.1);       // 20.76
  close(pts('4361050', 'Isaiah Likely', 'TE', 'NYG'), 9 + 12.7 + 6);                                  // 27.7, fumble kept (not lost)
  close(pts('4696981', 'Cam Skattebo', 'RB', 'NYG'), 7.8 + 12 + 3 + 4.4);                             // 27.2
  close(pts('5081335', 'Drew Stevens', 'K', 'WSH'), 3 + 4);                                           // 3 XP + 46-yd FG
  close(pts('5082424', 'Dominic Zvada', 'K', 'NYG'), 3 - 1);                                          // 3 XP, missed 33-yd FG
});

test('scoring: team defense from plays and the opponent score', () => {
  const g = E.parseSummary(summaryJson);
  const dst = (team) => S.playerPoints({ pos: 'DEF', team }, g, PPR);
  close(dst('WSH'), 1 + 2 + 2 + 0);       // 1 sack, 1 INT, 1 fumble recovery; NYG scored 21 (21-27 bracket = 0)
  close(dst('NYG'), 1 + 2 * 2 + 0);       // 1 sack, 2 INTs; WSH scored 24 (same bracket = 0)
});

test('scoring: Sleeper abbreviations match ESPN play text', () => {
  assert.equal(S.abbrev('Amon-Ra St. Brown'), 'A.St. Brown');
  assert.equal(S.abbrev('Michael Pittman Jr.'), 'M.Pittman');
  assert.equal(S.abbrev("Ja'Marr Chase"), 'J.Chase');
  assert.equal(S.abbrev('D.J. Moore'), 'D.Moore');
  assert.equal(S.normTeam('WAS'), 'WSH');
});

test('scoring: bonuses, TE premium and long field goals', () => {
  const g = { box: { 1: { team: 'DET', cats: { receiving: { receptions: 8, receivingYards: 120, receivingTouchdowns: 0 } } } }, fgs: [], plays: [], teams: [] };
  const sc = { rec: 1, rec_yd: 0.1, bonus_rec_yd_100: 3, bonus_rec_te: 0.5 };
  close(S.playerPoints({ espnId: '1', name: 'A B', pos: 'TE', team: 'DET' }, g, sc), 8 + 12 + 3 + 4);
  assert.equal(S.fgValue(55, PPR), 5);
  assert.equal(S.fgValue(55, { fgm_50p: 5 }), 5);
});

test('describe: plays read like a broadcast chyron', () => {
  assert.equal(describePlay({ type: 'Rushing Touchdown', yds: 4, text: '' }, { pos: 'RB' }), '4-yd TD run');
  assert.equal(describePlay({ type: 'Passing Touchdown', yds: 1, text: '' }, { pos: 'TE' }), '1-yd TD catch');
  assert.equal(describePlay({ type: 'Passing Touchdown', yds: 1, text: '' }, { pos: 'QB' }), '1-yd TD pass');
  assert.equal(describePlay({ type: 'Field Goal Good', yds: 0, text: 'B.Aubrey 52 yard field goal is GOOD' }, { pos: 'K' }), 'Good from 52');
  assert.equal(describePlay({ type: 'Sack', yds: -7, text: '' }, { pos: 'DEF' }), 'Sack');
  assert.equal(describePlay({ type: 'Rush', yds: -3, text: '' }, { pos: 'RB' }), '3-yd loss');
  assert.equal(describePlay({ type: 'Pass Reception', yds: -2, text: '' }, { pos: 'WR' }), '2-yd loss');
  assert.equal(describePlay({ type: 'Pass Reception', yds: 20, text: '' }, { pos: 'QB' }), '20-yd pass');
  close(phi(0), 0.5);
  assert.ok(phi(2) > 0.97);
});

test('moments: lost yards and sacks are plays; only an interception or a lost fumble is a turnover', () => {
  assert.equal(momentOf({ type: 'Rush', yds: -3, text: 'J.Jacobs right end to GB 22 for -3 yards' }, { pos: 'RB' }, -0.3), 'play');
  assert.equal(momentOf({ type: 'Sack', yds: -7, text: 'J.Love sacked at GB 18 for -7 yards' }, { pos: 'QB' }, -0.5), 'play');
  assert.equal(momentOf({ type: 'Pass Reception', yds: -2, text: 'J.Love pass short left to T.Kraft for -2 yards' }, { pos: 'TE' }, -0.2), 'play');
  assert.equal(momentOf({ type: 'Pass Interception Return', yds: 0, text: 'J.Love pass deep left INTERCEPTED by X' }, { pos: 'QB' }, -2), 'bad');
  assert.equal(momentOf({ type: 'Fumble Recovery (Opponent)', yds: 4, text: 'J.Jacobs FUMBLES, RECOVERED by DAL' }, { pos: 'RB' }, -2), 'bad');
  assert.equal(momentOf({ type: 'Fumble Recovery (Own)', yds: 1, text: 'J.Jacobs FUMBLES, recovered by GB' }, { pos: 'RB' }, -0.9), 'play');
});

/* ---------------- engine, driven by a fake clock and hand-built ESPN payloads ---------------- */

function fakeTimers(clock) {
  let id = 0; let list = [];
  return {
    set: (fn, ms) => { id += 1; list.push({ id, at: clock.t + ms, fn }); return id; },
    clear: (i) => { list = list.filter((x) => x.id !== i); },
    advance(ms) {
      const end = clock.t + ms;
      for (;;) {
        const due = list.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        list = list.filter((x) => x !== due);
        clock.t = Math.max(clock.t, due.at); due.fn();
      }
      clock.t = end;
    },
  };
}

const W = Date.parse('2026-11-15T18:10:00Z');                 // wall-clock time of the touchdown, in the game feed

function sbPayload(state) {
  return { week: { number: 10 }, season: { year: 2026 }, events: [{ id: 'G1', shortName: 'DET @ NE', date: '2026-11-15T14:30Z',
    status: { type: { state, shortDetail: 'Q1 8:00' }, period: 1, displayClock: '8:00' },
    competitions: [{ broadcasts: [{ names: ['CBS'] }], competitors: [
      { id: '8', homeAway: 'away', score: '0', team: { abbreviation: 'DET' } }, { id: '17', homeAway: 'home', score: '0', team: { abbreviation: 'NE' } }] }] }] };
}

function summaryPayload({ plays = [], rec = null }) {
  const athletes = rec ? [{ athlete: { id: '77', displayName: 'Sam Receiver' }, stats: rec }] : [];
  return {
    header: { id: 'G1', competitions: [{ status: { type: { state: 'in', shortDetail: 'Q1' }, period: 1, displayClock: '8:00' }, competitors: [
      { id: '8', homeAway: 'away', score: '0', team: { abbreviation: 'DET' } }, { id: '17', homeAway: 'home', score: '0', team: { abbreviation: 'NE' } }] }] },
    boxscore: { players: [{ team: { abbreviation: 'DET' }, statistics: [{ name: 'receiving',
      keys: ['receptions', 'receivingYards', 'receivingTouchdowns'], athletes }] }] },
    drives: { previous: [{ plays }] },
  };
}

const tdPlay = { id: 'P1', sequenceNumber: '100', type: { text: 'Passing Touchdown' }, text: 'J.Goff pass short right to S.Receiver for 12 yards, TOUCHDOWN.',
  scoringPlay: true, statYardage: 12, wallclock: new Date(W).toISOString(), start: { team: { id: '8' }, downDistanceText: '2nd & 10' } };

function rig({ delaySec = 45 } = {}) {
  const clock = { t: W - 600000 };
  const timers = fakeTimers(clock);
  const served = { board: sbPayload('pre'), summary: summaryPayload({}) };
  const cards = []; const frames = [];
  const cfg = { delaySec, moments: { td: true } };
  const league = { id: 'sleeper:1', platform: 'sleeper', source: 'box', label: 'ABL', name: 'Test League', scoring: PPR,
    me: { name: 'Me', starters: [{ key: 'p77', espnId: '77', name: 'Sam Receiver', pos: 'WR', team: 'DET', slot: 'WR' }] }, opp: { name: 'Them', starters: [] } };
  const engine = createEngine({
    get: async (url) => (url.includes('sports.core') ? (served.core || { items: [] }) : url.includes('/scoreboard') ? served.board : served.summary),
    now: () => clock.t, timer: timers, settings: () => cfg, onFrame: (f) => frames.push(f), onCard: (c) => cards.push(c),
  });
  engine.setLeagues([league]);
  return { engine, clock, timers, served, cards, frames, cfg };
}

test('engine: a touchdown is held until play time + delay, and the points move with the card', async () => {
  const r = rig({ delaySec: 45 });
  await r.engine.tick();                                         // game still 'pre': nothing to fetch
  r.clock.t = W - 120000; r.served.board = sbPayload('in');
  await r.engine.tick();                                         // game started, nobody has scored
  assert.equal(r.cards.length, 0);

  r.clock.t = W + 12000;                                         // ESPN shows the play 12 s after it happened
  r.served.summary = summaryPayload({ plays: [tdPlay], rec: ['1', '12', '1'] });
  await r.engine.tick();
  assert.equal(r.engine.pendingCount(), 1);
  assert.equal(r.cards.length, 0, 'not shown yet: the viewer is still 33 s behind');
  assert.equal(r.engine.frame().leagues[0].me.rows[0].pts, 0, 'lineup must not spoil the score either');

  r.timers.advance(33000 - 1);
  assert.equal(r.cards.length, 0);
  r.timers.advance(1);                                           // clock reaches W + 45 s
  assert.equal(r.cards.length, 1);
  const c = r.cards[0];
  assert.equal(c.kind, 'td');
  assert.equal(c.title, 'TOUCHDOWN');
  assert.equal(c.line, '12-yd TD catch');
  close(c.value.n, 1 + 1.2 + 6);
  assert.deepEqual(c.chips.map((x) => x.label), ['ABL']);
  close(r.engine.frame().leagues[0].me.rows[0].pts, 8.2);

  await r.engine.tick();                                         // same data again: no duplicate moment
  assert.equal(r.engine.pendingCount(), 0);
  assert.equal(r.cards.length, 1);
});

test('engine: ESPN correcting a 13-yard catch to 12 changes the points quietly, with no "-0.1" card on the play', async () => {
  const r = rig({ delaySec: 0 });
  r.cfg.moments = { td: true, big: true, bad: true, play: true };
  await r.engine.tick();
  r.clock.t = W - 120000; r.served.board = sbPayload('in');
  await r.engine.tick();
  const catch13 = { id: 'P2', sequenceNumber: '120', type: { text: 'Pass Reception' }, text: 'J.Goff pass short right to S.Receiver for 13 yards.',
    statYardage: 13, wallclock: new Date(W).toISOString(), start: { team: { id: '8' }, downDistanceText: '1st & 10' } };
  r.clock.t = W + 5000;
  r.served.summary = summaryPayload({ plays: [catch13], rec: ['1', '13', '0'] });
  await r.engine.tick(); r.timers.advance(1);
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].line, '13-yd catch');

  const catch12 = { ...catch13, text: 'J.Goff pass short right to S.Receiver for 12 yards.', statYardage: 12 };
  r.clock.t = W + 30000;
  r.served.summary = summaryPayload({ plays: [catch12], rec: ['1', '12', '0'] });
  await r.engine.tick(); r.timers.advance(1);
  assert.equal(r.cards.length, 1, 'a correction is not a moment');
  close(r.engine.frame().leagues[0].me.rows[0].pts, 2.2);
});

test("engine: the opponent's touchdown gets its own card, named for them and from its game; turning it off hides it", async () => {
  const run = async (moments) => {
    const clock = { t: W - 600000 };
    const timers = fakeTimers(clock);
    const served = { board: sbPayload('pre'), summary: summaryPayload({}) };
    const cards = [];
    const league = { id: 'sleeper:1', platform: 'sleeper', source: 'box', label: 'ABL', name: 'Test League', scoring: PPR,
      me: { name: 'Me', starters: [{ key: 'q1', espnId: '99', name: 'My Quarterback', pos: 'QB', team: 'NE', slot: 'QB' }] },
      opp: { name: 'Them', starters: [{ key: 'p77', espnId: '77', name: 'Sam Receiver', pos: 'WR', team: 'DET', slot: 'WR' }] } };
    const engine = createEngine({ get: async (url) => (url.includes('/scoreboard') ? served.board : served.summary),
      now: () => clock.t, timer: timers, settings: () => ({ delaySec: 0, moments }), onFrame: () => {}, onCard: (c) => cards.push(c) });
    engine.setLeagues([league]);
    await engine.tick();
    clock.t = W - 120000; served.board = sbPayload('in');
    await engine.tick();
    clock.t = W + 5000;
    served.summary = summaryPayload({ plays: [tdPlay], rec: ['1', '12', '1'] });
    await engine.tick(); timers.advance(1);
    return cards;
  };
  const shown = await run({ td: true, big: true });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].side, 'opp');
  assert.equal(shown[0].title, 'THEIR TOUCHDOWN');
  assert.equal(shown[0].game, 'DET at NE');
  assert.deepEqual(shown[0].chips.map((x) => x.label), ['Them']);
  assert.equal((await run({ td: true, big: true, opp: false })).length, 0);
});

test('scoring: one play is worth what the league pays for it', () => {
  close(S.playPoints('receiver', 22, true, 'WR', PPR), 1 + 2.2 + 6);
  close(S.playPoints('rusher', 2, true, 'RB', PPR), 0.2 + 6);
  close(S.playPoints('passer', 30, true, 'QB', { pass_yd: 0.04, pass_td: 4 }), 1.2 + 4);
  close(S.playPoints('receiver', 25, false, 'TE', { rec: 1, rec_yd: 0.1, bonus_rec_te: 0.5 }), 1 + 0.5 + 2.5);
  assert.equal(S.playPoints('tackler', 5, false, 'WR', PPR), 0);
});

// ESPN's fast "core" feed: the same play, listed with who was on it (participant roles) and no box score.
const corePayload = (plays) => ({ count: plays.length, pageCount: plays.length ? 1 : 0, items: plays.map((p) => ({ ...p,
  participants: [{ athlete: { $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/athletes/77?lang=en' }, type: 'receiver' }] })) });

test('engine: a touchdown in the fast feed shows before the box score has it, and the box score does not repeat it', async () => {
  const r = rig({ delaySec: 0 });
  await r.engine.tick();
  r.clock.t = W - 120000; r.served.board = sbPayload('in'); r.served.core = corePayload([]);
  await r.engine.tick();                                          // first look at the fast feed: learns where "now" is
  r.clock.t = W + 30000;                                          // the fast feed has the touchdown; the summary does not yet
  r.served.core = corePayload([tdPlay]);
  await r.engine.tick(); r.timers.advance(1);
  assert.equal(r.cards.length, 1, 'shown from the fast feed');
  assert.equal(r.cards[0].kind, 'td');
  assert.equal(r.cards[0].line, '12-yd TD catch');
  close(r.cards[0].value.n, 1 + 1.2 + 6);
  r.clock.t = W + 43000;                                          // 13 s later the summary and box score catch up
  r.served.summary = summaryPayload({ plays: [tdPlay], rec: ['1', '12', '1'] });
  await r.engine.tick(); r.timers.advance(1);
  assert.equal(r.cards.length, 1, 'the same play is not shown twice');
  close(r.engine.frame().leagues[0].me.rows[0].pts, 8.2);
});

test('engine: ESPN posts a play first and adds the touchdown after: the touchdown still comes from the fast feed', async () => {
  const r = rig({ delaySec: 0 });
  await r.engine.tick();
  r.clock.t = W - 120000; r.served.board = sbPayload('in'); r.served.core = corePayload([]);
  await r.engine.tick();
  const bare = { ...tdPlay, text: 'J.Goff pass short right to S.Receiver for 12 yards.', scoringPlay: false };
  r.clock.t = W + 25000; r.served.core = corePayload([bare]);
  await r.engine.tick(); r.timers.advance(1);
  assert.equal(r.cards.length, 0, 'a 12-yard catch is not a moment on its own');
  r.clock.t = W + 33000; r.served.core = corePayload([tdPlay]);
  await r.engine.tick(); r.timers.advance(1);
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].kind, 'td');
  assert.equal(r.cards[0].via, 'fast');
});

test("scoring: a league's defense rules: forced fumbles, safeties, blocked kicks, return TDs and yards allowed", () => {
  const sc = { sack: 1, int: 2, fum_rec: 2, ff: 1, safe: 2, blk_kick: 2, def_st_td: 6, st_td: 6, pts_allow_1_6: 4,
    yds_allow_0_100: 5, yds_allow_100_199: 3, yds_allow_200_299: 2 };
  const game = {
    teams: [{ abbr: 'IND', id: '11', score: 17 }, { abbr: 'MIA', id: '15', score: 3 }],
    plays: [
      { off: '15', type: 'Rush', text: 'D.Achane FUMBLES, forced by Z.Franklin, RECOVERED by MIA.' },
      { off: '15', type: 'Safety', text: 'T.Tagovailoa sacked in the end zone, SAFETY.' },
      { off: '15', type: 'Blocked Punt', text: 'Punt is BLOCKED.' },
      { off: '11', type: 'Rush', text: 'J.Taylor FUMBLES, forced by J.Phillips.' },     // their defense, not ours
    ],
    box: { r1: { team: 'IND', cats: { kickReturns: { kickReturnTouchdowns: 1 } } } },
    yards: { MIA: 180, IND: 330 },
  };
  close(S.playerPoints({ pos: 'DEF', team: 'IND' }, game, sc), 1 + 2 + 2 + 6 + 4 + 3);   // ff, safety, block, return TD (counted once), PA 1-6, 100-199 yards
});

test('scoring: two-point conversions and a combined rushing + receiving bonus, from the league settings', () => {
  const plays = [{ text: 'J.Goff pass short right to S.LaPorta for 2 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. J.Goff pass to A.St. Brown is complete. ATTEMPT SUCCEEDS.' },
    { text: 'TWO-POINT CONVERSION ATTEMPT. J.Gibbs rushes up the middle. ATTEMPT FAILS.' }];
  const game = { plays, fgs: [], box: { a1: { name: 'Amon-Ra St. Brown', team: 'DET', cats: { receiving: { receptions: 1, receivingYards: 150 }, rushing: { rushingYards: 55 } } } } };
  const sc = { rec: 1, rec_yd: 0.1, rush_yd: 0.1, rec_2pt: 2, rush_2pt: 2, bonus_rush_rec_yd_200: 3 };
  close(S.playerPoints({ pos: 'WR', name: 'Amon-Ra St. Brown', team: 'DET' }, game, sc), 1 + 15 + 5.5 + 2 + 3);
  close(S.playerPoints({ pos: 'RB', name: 'Jahmyr Gibbs', team: 'DET' }, game, sc), 0, 'a failed attempt is worth nothing');
});

test("engine: once a player's points settle, the box shows the league's own number from Sleeper", async () => {
  const clock = { t: W - 600000 };
  const timers = fakeTimers(clock);
  const served = { board: sbPayload('pre'), summary: summaryPayload({}) };
  const league = (official) => ({ id: 'sleeper:1', platform: 'sleeper', source: 'box', label: 'ABL', name: 'Test League', scoring: PPR,
    me: { name: 'Me', starters: [{ key: 'p77', espnId: '77', name: 'Sam Receiver', pos: 'WR', team: 'DET', slot: 'WR', official }] }, opp: null });
  let official = null;
  const engine = createEngine({ get: async (url) => (url.includes('/scoreboard') ? served.board : url.includes('sports.core') ? { items: [] } : served.summary),
    now: () => clock.t, timer: timers, settings: () => ({ delaySec: 0, moments: {} }), onFrame: () => {}, onCard: () => {},
    refreshLeague: async () => league(official) });
  engine.setLeagues([league(null)]);
  await engine.tick();
  clock.t = W - 120000; served.board = sbPayload('in');
  await engine.tick();
  clock.t = W + 5000; served.summary = summaryPayload({ plays: [tdPlay], rec: ['1', '12', '1'] });
  await engine.tick();
  close(engine.frame().leagues[0].me.rows[0].pts, 8.2);              // built from ESPN with the league's settings
  official = 9.7;                                                     // Sleeper counts something ESPN's box can't show
  clock.t = W + 70000; await engine.tick();
  close(engine.frame().leagues[0].me.rows[0].pts, 8.2, 'not yet: the points moved under two minutes ago');
  clock.t = W + 200000; await engine.tick();
  close(engine.frame().leagues[0].me.rows[0].pts, 9.7);
  close(engine.frame().leagues[0].me.total, 9.7);
});

test('engine: plays already in the fast feed when Sideline starts are not moments', async () => {
  const r = rig({ delaySec: 0 });
  await r.engine.tick();
  r.clock.t = W + 30000; r.served.board = sbPayload('in'); r.served.core = corePayload([tdPlay]);
  await r.engine.tick(); r.timers.advance(1);
  assert.equal(r.cards.length, 0);
});

test('engine: nudging the delay moves a pending card', async () => {
  const r = rig({ delaySec: 45 });
  await r.engine.tick();
  r.clock.t = W - 120000; r.served.board = sbPayload('in');
  await r.engine.tick();
  r.clock.t = W + 5000;
  r.served.summary = summaryPayload({ plays: [tdPlay], rec: ['1', '12', '1'] });
  await r.engine.tick();
  r.cfg.delaySec = 10; r.engine.retime();                        // user presses -5 s a few times
  r.timers.advance(5000);
  assert.equal(r.cards.length, 1, 'with a 10 s delay the card is due at W + 10 s');
});

test('engine: joining mid-game seeds a baseline instead of replaying old points as moments', async () => {
  const r = rig({ delaySec: 45 });
  r.clock.t = W + 600000; r.served.board = sbPayload('in');       // engine first sees the game already in progress
  r.served.summary = summaryPayload({ plays: [tdPlay], rec: ['1', '12', '1'] });
  await r.engine.tick();
  assert.equal(r.engine.pendingCount(), 0);
  assert.equal(r.cards.length, 0);
  close(r.engine.frame().leagues[0].me.rows[0].pts, 8.2);        // the score so far is just there
});

test('engine: turned-off moments are never shown', async () => {
  const r = rig({ delaySec: 0 });
  r.cfg.moments = { td: false };
  await r.engine.tick();
  r.clock.t = W - 120000; r.served.board = sbPayload('in');
  await r.engine.tick();
  r.clock.t = W + 1000;
  r.served.summary = summaryPayload({ plays: [tdPlay], rec: ['1', '12', '1'] });
  await r.engine.tick();
  r.timers.advance(1000);
  assert.equal(r.cards.length, 0);
});

test('engine: win chance leans toward the leader and is bounded', async () => {
  const r = rig({ delaySec: 0 });
  await r.engine.tick();
  const f = r.engine.frame().leagues[0];
  assert.ok(f.winPct >= 0 && f.winPct <= 100);
});

test('engine: win chance never says 100% while a game is still on, and does once it is decided', async () => {
  const r = rig({ delaySec: 0 });
  r.clock.t = W - 120000; r.served.board = sbPayload('in');
  r.served.summary = summaryPayload({ rec: ['10', '400', '3'] });   // a 68-point lead over an empty lineup
  await r.engine.tick();
  assert.equal(r.engine.frame().leagues[0].winPct, 99);
  r.served.board = sbPayload('post');
  r.served.summary = summaryPayload({ rec: ['10', '400', '3'] });
  r.served.summary.header.competitions[0].status.type.state = 'post';
  r.clock.t += 60000;
  await r.engine.tick();
  assert.equal(r.engine.frame().leagues[0].winPct, 100);
});

/* ---------------- league sources ---------------- */

test('sleeper: lineup, slots, defenses and team names from the public API', async () => {
  const urls = [];
  const data = {
    '/league/L1/rosters': [{ roster_id: 1, owner_id: 'u1' }, { roster_id: 2, owner_id: 'u2' }],
    '/league/L1/matchups/10': [{ roster_id: 1, matchup_id: 5, starters: ['100', 'DAL', '0'] }, { roster_id: 2, matchup_id: 5, starters: ['200', 'KC', '0'] }],
    '/league/L1/users': [{ user_id: 'u1', display_name: 'me', metadata: { team_name: 'BALL KNOWERS' } }, { user_id: 'u2', display_name: 'rival' }],
    '/players/nfl': { 100: { espn_id: 4242, full_name: 'Josh Jacobs', position: 'RB', team: 'GB' }, 200: { espn_id: 5, full_name: 'Their Guy', position: 'WR', team: 'WAS' } },
  };
  const get = async (url) => { urls.push(url); return data[url.replace(Sleeper.API, '')]; };
  const league = { league_id: 'L1', name: 'Baller Dynasty League', scoring_settings: PPR, roster_positions: ['RB', 'DEF', 'BN'] };
  const { model } = await Sleeper.loadLeague(get, 'u1', league, 10, {});
  assert.equal(model.label, 'BDL');
  assert.equal(model.me.name, 'BALL KNOWERS');
  assert.equal(model.opp.name, 'rival');
  assert.deepEqual(model.me.starters.map((s) => [s.name, s.pos, s.espnId, s.team]), [['Josh Jacobs', 'RB', '4242', 'GB'], ['DAL D/ST', 'DEF', null, 'DAL']]);
  assert.equal(model.opp.starters[0].team, 'WSH', 'Sleeper WAS is ESPN WSH');
});

test('espn fantasy: league links, lineup and points', async () => {
  assert.deepEqual(EF.parseLeagueUrl('https://fantasy.espn.com/football/team?leagueId=123&teamId=4&seasonId=2026'), { leagueId: '123', teamId: '4', season: '2026' });
  assert.throws(() => EF.parseLeagueUrl('https://example.com/?leagueId=1'), /fantasy\.espn\.com/);
  const entry = (id, slot, name, pos, team, pts) => ({ playerId: id, lineupSlotId: slot, playerPoolEntry: { id, appliedStatTotal: pts, player: { fullName: name, defaultPositionId: pos, proTeamId: team } } });
  const j = { settings: { name: 'Office League' }, teams: [{ id: 4, name: 'Mine' }, { id: 7, name: 'Theirs' }], schedule: [{ matchupPeriodId: 10,
    home: { teamId: 4, rosterForCurrentScoringPeriod: { entries: [entry(1, 2, 'Back One', 2, 9, 14.26), entry(2, 20, 'Bench Guy', 3, 12, 99), entry(3, 16, 'Packers', 16, 9, 7)] } },
    away: { teamId: 7, rosterForCurrentScoringPeriod: { entries: [entry(9, 4, 'Wide Nine', 3, 28, 3)] } } }] };
  const model = await EF.loadLeague(async () => j, { leagueId: '123', teamId: '4', season: '2026' }, 10);
  assert.equal(model.source, 'points');
  assert.deepEqual(model.me.starters.map((s) => [s.name, s.pos, s.team, s.pts, s.slot]), [['Back One', 'RB', 'GB', 14.26, 'RB'], ['GB D/ST', 'DEF', 'GB', 7, 'DEF']]);
  assert.equal(model.opp.starters[0].team, 'WSH');
  assert.equal(model.opp.name, 'Theirs');
});

test('scoring: a starter Sleeper has no ESPN id for is found by name and team', () => {
  const g = E.parseSummary(summaryJson);
  const daniels = { espnId: null, name: 'Jayden Daniels', pos: 'QB', team: 'WSH' };
  close(S.playerPoints(daniels, g, PPR), 20.76);
  assert.equal(S.findAthlete(daniels, g.box).id, '4426348');
  close(S.playerPoints({ espnId: null, name: 'J. Daniels Jr.', pos: 'QB', team: 'WAS' }, g, PPR), 20.76);   // initial + surname, Sleeper's WAS
  assert.equal(S.playerPoints({ espnId: null, name: 'Jayden Daniels', pos: 'QB', team: 'NYG' }, g, PPR), 0, 'same name on the other team is not him');
});

/* ---------------- regressions from the error-handling review ---------------- */

test('engine: box score moving before the play feed is timed by now, never by an older play (no spoiler)', async () => {
  const r = rig({ delaySec: 45 });
  r.cfg.moments = { td: true, play: true };
  await r.engine.tick();
  r.clock.t = W - 120000; r.served.board = sbPayload('in');
  const old = { ...tdPlay, id: 'P0', sequenceNumber: '50', type: { text: 'Rush' }, text: 'A.Nobody up the middle for 2 yards.', scoringPlay: false,
    wallclock: new Date(W - 60000).toISOString() };
  r.served.summary = summaryPayload({ plays: [old] });
  await r.engine.tick();
  r.clock.t = W + 5000;
  r.served.summary = summaryPayload({ plays: [old], rec: ['1', '12', '0'] });   // stats moved, the play has not arrived
  await r.engine.tick();
  assert.equal(r.engine.pendingCount(), 1);
  r.timers.advance(44000);
  assert.equal(r.cards.length, 0, 'an older play time would have released this already');
  assert.equal(r.engine.frame().leagues[0].me.rows[0].pts, 0);
  r.timers.advance(1000);
  assert.equal(r.cards.length, 1);
  close(r.engine.frame().leagues[0].me.rows[0].pts, 2.2);
});

test('engine: one game failing to load does not blank the others', async () => {
  const clock = { t: W };
  const board = sbPayload('in');
  board.events.push({ ...board.events[0], id: 'G2', shortName: 'KC @ ATL', competitions: [{ broadcasts: [], competitors: [
    { id: '12', homeAway: 'away', score: '0', team: { abbreviation: 'KC' } }, { id: '1', homeAway: 'home', score: '0', team: { abbreviation: 'ATL' } }] }] });
  const statuses = [];
  const league = { id: 'x', label: 'X', name: 'X', source: 'box', scoring: PPR, week: 10,
    me: { name: 'Me', starters: [{ key: 'p77', espnId: '77', name: 'Sam Receiver', pos: 'WR', team: 'DET' }, { key: 'kc', espnId: '99', name: 'Kay Cee', pos: 'WR', team: 'KC' }] }, opp: null };
  const e = createEngine({
    get: async (url) => { if (url.includes('scoreboard')) return board; if (url.includes('G2')) throw new Error('boom'); return summaryPayload({ plays: [tdPlay], rec: ['1', '12', '1'] }); },
    now: () => clock.t, timer: fakeTimers(clock), settings: () => ({ delaySec: 0, moments: {} }), onFrame: () => {}, onCard: () => {}, onStatus: (s) => statuses.push(s),
  });
  e.setLeagues([league]);
  await e.tick();
  close(e.frame().leagues[0].me.rows[0].pts, 8.2);
});

test('engine: a host callback that throws does not stop the poll loop or the frame beat', async () => {
  const clock = { t: W };
  const timers = fakeTimers(clock);
  let statuses = 0, frames = 0;
  const e = createEngine({
    get: async (url) => (url.includes('scoreboard') ? sbPayload('in') : summaryPayload({})),
    now: () => clock.t, timer: timers, settings: () => ({ delaySec: 0, moments: {} }),
    onFrame: () => { frames += 1; throw new Error('host bug'); }, onCard: () => {}, onStatus: () => { statuses += 1; throw new Error('host bug'); },
  });
  e.setLeagues([{ id: 'x', label: 'X', name: 'X', source: 'box', scoring: PPR, week: 10, me: { name: 'Me', starters: [{ key: 'a', espnId: '77', name: 'Sam Receiver', pos: 'WR', team: 'DET' }] }, opp: null }]);
  e.start();
  for (let i = 0; i < 3; i++) { await new Promise((res) => setImmediate(res)); timers.advance(9000); }
  await new Promise((res) => setImmediate(res));
  e.stop();
  assert.ok(statuses >= 3, `loop kept going (${statuses} statuses)`);
  assert.ok(frames >= 10, `frame beat kept going (${frames} frames)`);
});

test('engine: a league added during a game starts from its current points, not from zero', async () => {
  const r = rig({ delaySec: 0 });
  await r.engine.tick();                                            // league A sees the game before kickoff
  r.clock.t = W - 120000; r.served.board = sbPayload('in');
  await r.engine.tick();
  r.clock.t = W + 1000;
  r.served.summary = summaryPayload({ plays: [tdPlay], rec: ['1', '12', '1'] });
  await r.engine.tick();
  r.timers.advance(1000);
  assert.equal(r.cards.length, 1);
  const b = { id: 'sleeper:2', platform: 'sleeper', source: 'box', label: 'LATE', name: 'Late league', scoring: PPR, week: 10,
    me: { name: 'Me', starters: [{ key: 'p77', espnId: '77', name: 'Sam Receiver', pos: 'WR', team: 'DET' }] }, opp: null };
  r.clock.t = W + 60000;
  r.engine.setLeagues([r.engine.frame().leagues.length && { id: 'sleeper:1', platform: 'sleeper', source: 'box', label: 'ABL', name: 'Test League', scoring: PPR,
    me: { name: 'Me', starters: [{ key: 'p77', espnId: '77', name: 'Sam Receiver', pos: 'WR', team: 'DET', slot: 'WR' }] }, opp: { name: 'Them', starters: [] } }, b]);
  await r.engine.tick();
  r.timers.advance(1000);
  assert.equal(r.cards.length, 1, 'no "points added" card for the late league');
  close(r.engine.frame().leagues[1].me.rows[0].pts, 8.2);
});

test('engine: "J.Smith" is not "J.Smith-Njigba"', () => {
  const { pickPlay } = require('../src/core/engine');
  const game = { teams: [] };
  const st = { name: 'Jaxon Smith', pos: 'WR' };
  assert.equal(pickPlay(st, 2, game, [{ id: 1, text: 'S.Darnold pass short to J.Smith-Njigba for 12 yards', yds: 12 }]), null);
  assert.equal(pickPlay(st, 2, game, [{ id: 2, text: 'S.Darnold pass short to J.Smith for 5 yards', yds: 5 }]).play.id, 2);
});

test('sleeper: a team out of the playoffs (matchup_id null) has no opponent', async () => {
  const data = {
    '/league/L1/rosters': [{ roster_id: 1, owner_id: 'u1' }, { roster_id: 2, owner_id: 'u2' }],
    '/league/L1/matchups/16': [{ roster_id: 1, matchup_id: null, starters: ['DAL'] }, { roster_id: 2, matchup_id: null, starters: ['KC'] }],
    '/league/L1/users': [{ user_id: 'u1', display_name: 'me' }],
  };
  const { model } = await Sleeper.loadLeague(async (url) => data[url.replace(Sleeper.API, '')], 'u1', { league_id: 'L1', name: 'L', roster_positions: ['DEF'] }, 16, {});
  assert.equal(model.opp, null);
});

test('espn fantasy: ids pasted from a link must be plain numbers', () => {
  assert.throws(() => EF.parseLeagueUrl('https://fantasy.espn.com/football/team?leagueId=1/../../x&teamId=4'), /odd leagueId/);
  assert.throws(() => EF.parseLeagueUrl('https://evil.example/football/team?leagueId=1'), /not an ESPN address/);
});

test('engine: box score updating a tick AFTER its play still gets the touchdown card, timed by the play', async () => {
  const r = rig({ delaySec: 45 });
  await r.engine.tick();
  r.clock.t = W - 120000; r.served.board = sbPayload('in');
  await r.engine.tick();
  r.clock.t = W + 20000;
  r.served.summary = summaryPayload({ plays: [tdPlay] });                    // the play is published, the stats are not yet
  await r.engine.tick();
  assert.equal(r.engine.pendingCount(), 0);
  r.clock.t = W + 28000;
  r.served.summary = summaryPayload({ plays: [tdPlay], rec: ['1', '12', '1'] });   // next tick: the box score catches up
  await r.engine.tick();
  assert.equal(r.engine.pendingCount(), 1);
  r.timers.advance(17000 - 1);
  assert.equal(r.cards.length, 0, 'due at the play time + 45 s, not at detection + 45 s');
  r.timers.advance(1);
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].kind, 'td');
  assert.equal(r.cards[0].line, '12-yd TD catch');
});

test('engine: an unrelated old play is not borrowed for a later change', async () => {
  const r = rig({ delaySec: 0 });
  r.cfg.moments = { td: true, play: true };
  await r.engine.tick();
  r.clock.t = W - 120000; r.served.board = sbPayload('in');
  await r.engine.tick();
  const old = { ...tdPlay, id: 'OLD', sequenceNumber: '10', type: { text: 'Pass Incompletion' }, text: 'J.Goff pass incomplete intended for S.Receiver.', scoringPlay: false, statYardage: 0,
    wallclock: new Date(W - 600000).toISOString() };                          // ten minutes ago: far outside the look-back window
  r.clock.t = W + 500;
  r.served.summary = summaryPayload({ plays: [old] });                       // the old play is seen (and used up) in an earlier tick
  await r.engine.tick();
  r.clock.t = W + 1000;
  r.served.summary = summaryPayload({ plays: [old], rec: ['1', '5', '0'] });
  await r.engine.tick();
  r.timers.advance(10);
  assert.equal(r.cards[0].line, 'Points added', 'no recent play to describe it, so it stays generic');
});

test('engine: reloading the same leagues does not reopen a game that is already final', async () => {
  const clock = { t: W };
  const summary = summaryPayload({});
  summary.header.competitions[0].status.type.state = 'post';
  let fetched = 0;
  const starters = [{ key: 'p77', espnId: '77', name: 'Sam Receiver', pos: 'WR', team: 'DET', slot: 'WR' }];
  const league = (id) => ({ id, platform: 'sleeper', source: 'box', label: id, name: id, scoring: PPR, week: 10,
    me: { name: 'Me', starters }, opp: null });
  const engine = createEngine({
    get: async (url) => {
      if (url.includes('sports.core')) return { items: [] };
      if (url.includes('/scoreboard')) return sbPayload('in');
      fetched += 1;
      return summary;
    },
    now: () => clock.t, timer: fakeTimers(clock), settings: () => ({ delaySec: 0, moments: {} }),
    onFrame: () => {}, onCard: () => {},
  });
  engine.setLeagues([league('sleeper:1')]);
  await engine.tick();
  assert.equal(fetched, 1, 'the game is read once, and comes back final');
  await engine.tick();
  assert.equal(fetched, 1, 'a final game is not read again');

  engine.setLeagues([league('sleeper:1')]);                       // the 60 s error retry reloads the same leagues
  await engine.tick();
  assert.equal(fetched, 1, 'reloading the same leagues leaves it closed');

  engine.setLeagues([league('sleeper:1'), league('sleeper:2')]);   // a new league may have starters in that game
  await engine.tick();
  assert.equal(fetched, 2, 'a league that was just added reopens it once');
});
