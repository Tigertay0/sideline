/* Sample game for the "show a test" button: a lineup mid-game and one of each moment, so the box can be seen and
   positioned with no game on. Names and numbers are invented; nothing here is real data. */
(function (root) {
  'use strict';

  // Real ESPN ids for the invented lineup, so the sample shows the same headshots a live lineup does (a defense shows its team logo).
  const IMG = 'https://a.espncdn.com/combiner/i?img=/i/';
  const IDS = { 'A.J. Brown': 4047646, 'Jordan Love': 4036378, 'Josh Jacobs': 4047365, 'CeeDee Lamb': 4241389, 'Tucker Kraft': 4572680, 'Brandon Aubrey': 3953687 };
  const photoOf = (name, pos, team) => (pos === 'DEF' ? `${IMG}teamlogos/nfl/500/${team.toLowerCase()}.png&w=120&h=120` : IDS[name] ? `${IMG}headshots/nfl/players/full/${IDS[name]}.png&w=240&h=175` : '');
  const row = (key, name, pos, team, pts, state) => ({ key, espnId: null, name, pos, team, slot: pos, pts, state: state || 'in', photo: photoOf(name, pos, team),
    gameId: team === 'GB' ? 'S1' : 'S2', detail: team === 'GB' ? 'Q3 4:12' : 'Q2 9:40' });

  function frame() {
    return {
      at: Date.now(), syncing: false, live: true, games: [],
      leagues: [{
        id: 'sample:1', label: 'SAMPLE', name: 'Sample league', platform: 'sample',
        me: { name: 'Ball Knowers', total: 106.4, rows: [
          row('a', 'Jordan Love', 'QB', 'GB', 14.6), row('b', 'Josh Jacobs', 'RB', 'GB', 14.2), row('c', 'CeeDee Lamb', 'WR', 'DAL', 11.8),
          row('d', 'Tucker Kraft', 'TE', 'GB', 7.4), row('e', 'Brandon Aubrey', 'K', 'DAL', 4), row('f', 'DAL D/ST', 'DEF', 'DAL', 6) ] },
        opp: { name: 'Tank Szn', total: 108.9 }, winPct: 44,
      }],
    };
  }

  const CARDS = {
    td: { key: 'b', kind: 'td', title: 'TOUCHDOWN', line: '4-yd TD run', n: 6.4, who: 'Josh Jacobs', pos: 'RB', team: 'GB', ttl: 6000, play: { kind: 'td', yds: 4, down: '1st & goal' } },
    big: { key: 'c', kind: 'big', title: 'BIG PLAY', line: '38-yd catch', n: 4.8, who: 'CeeDee Lamb', pos: 'WR', team: 'DAL', ttl: 3800, play: { kind: 'big', yds: 38, down: '2nd & 7' } },
    fg: { key: 'e', kind: 'fg', title: 'FIELD GOAL', line: 'Good from 52', n: 5, who: 'Brandon Aubrey', pos: 'K', team: 'DAL', ttl: 3600 },
    play: { key: 'b', kind: 'play', title: null, line: '13-yd catch', n: 2.3, who: 'Josh Jacobs', pos: 'RB', team: 'GB', ttl: 3000 },
    bad: { key: 'a', kind: 'bad', title: 'TURNOVER', line: 'Interception thrown', n: -2, who: 'Jordan Love', pos: 'QB', team: 'GB', ttl: 3600 },
    opp: { key: 'z', kind: 'td', title: 'THEIR TOUCHDOWN', line: '22-yd TD catch', n: 8.2, who: 'A.J. Brown', pos: 'WR', team: 'PHI', ttl: 5000, side: 'opp', game: 'DAL at PHI', label: 'Tank Szn' },
  };

  function card(kind) {
    const c = CARDS[kind] || CARDS.td;
    return {
      id: 'test:' + Date.now(), kind: c.kind, title: c.title, line: c.line, value: { n: c.n, unit: 'pts' }, ttl_ms: c.ttl, data: c.play ? { play: c.play } : undefined,
      subject: { key: c.key, name: c.who, pos: c.pos, team: c.team, photo: photoOf(c.who, c.pos, c.team) }, chips: [{ label: c.label || 'SAMPLE', mine: !c.side, d: c.n }],
      side: c.side || 'me', game: c.game || (c.team === 'GB' ? 'GB at DAL' : 'DAL at GB'),
    };
  }

  const api = { frame, card };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).sample = api;
})(typeof self !== 'undefined' ? self : globalThis);
