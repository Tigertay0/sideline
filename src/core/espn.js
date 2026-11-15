/* ESPN's public NFL feeds: the scoreboard (which games, which network) and a game summary (box score + plays).
   `get(url)` is injected and resolves parsed JSON, so the same code runs in the extension, a demo page and node tests. */
(function (root) {
  'use strict';
  const S = typeof require !== 'undefined' ? require('./scoring') : root.SL.scoring;

  const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
  // ESPN's "core" play feed lists a play about 13 s before the summary does (measured on seven live games, 15 Nov 2026).
  // It has who was on the play but no box score. Paged oldest first, 25 to a page: Sideline reads only the newest page.
  const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
  const CORE_PAGE = 25;
  const GAME_SECONDS = 3600;

  const secs = (display) => {
    const [m, s] = String(display || '0:0').split(':');
    return (+m || 0) * 60 + (+s || 0);
  };

  /** Share of regulation still to play: 1 before kickoff, 0 when final. */
  function fracLeft(state, period, clock) {
    if (state === 'pre') return 1;
    if (state === 'post') return 0;
    const left = period > 4 ? 300 : (4 - period) * 900 + secs(clock);
    return Math.max(0.01, left / GAME_SECONDS);
  }

  function competitors(comp) {
    return comp.competitors.map((c) => ({
      id: c.id, abbr: S.normTeam(c.team.abbreviation), score: +c.score || 0, home: c.homeAway === 'home',
    }));
  }

  function parseScoreboard(j) {
    const games = (j.events || []).map((e) => {
      const comp = e.competitions[0];
      const nets = [];
      for (const b of comp.broadcasts || []) for (const n of b.names || []) nets.push(n);
      for (const b of comp.geoBroadcasts || []) if (b.media && b.media.shortName) nets.push(b.media.shortName);
      return {
        id: e.id, name: e.shortName, start: Date.parse(e.date), state: e.status.type.state, detail: e.status.type.shortDetail,
        teams: competitors(comp), networks: [...new Set(nets)],
        fracLeft: fracLeft(e.status.type.state, e.status.period, e.status.displayClock),
      };
    });
    return { week: j.week && j.week.number, season: j.season && j.season.year, games };
  }

  function normPlay(p) {
    return {
      id: p.id, seq: +p.sequenceNumber || 0, type: p.type && p.type.text, text: p.text || '', scoring: !!p.scoringPlay,
      yds: p.statYardage || 0, turnover: !!p.isTurnover, off: p.start && p.start.team && p.start.team.id,
      t: Date.parse(p.wallclock) || null, period: p.period && p.period.number, clock: p.clock && p.clock.displayValue,
      down: p.start && p.start.downDistanceText,
      away: typeof p.awayScore === 'number' ? p.awayScore : null, home: typeof p.homeScore === 'number' ? p.homeScore : null,
    };
  }

  // Each team's total offensive yards (the other team's "yards allowed"), from the summary's team box.
  const teamYards = (j) => Object.fromEntries(((j.boxscore && j.boxscore.teams) || []).map((t) => [S.normTeam(t.team.abbreviation),
    +(((t.statistics || []).find((x) => x.name === 'totalYards') || {}).displayValue) || 0]));

  function parseSummary(j) {
    const comp = j.header.competitions[0];
    const status = comp.status;
    const drives = j.drives || {};
    const raw = [...(drives.previous || []), ...(drives.current ? [drives.current] : [])].flatMap((d) => d.plays || []);
    const plays = (raw.length ? raw : j.plays || []).map(normPlay).sort((a, b) => a.seq - b.seq);
    const state = status.type.state;
    const times = plays.map((p) => p.t).filter(Boolean);
    return {
      id: j.header.id, state, detail: status.type.shortDetail, teams: competitors(comp),
      box: S.parseBoxscore(j), plays, fgs: S.fieldGoals(plays), yards: teamYards(j),
      feedTime: times.length ? Math.max(...times) : null,
      fracLeft: fracLeft(state, status.period, status.displayClock),
    };
  }

  const fetchScoreboard = async (get) => parseScoreboard(await get(BASE + '/scoreboard'));
  const fetchGame = async (get, id) => parseSummary(await get(`${BASE}/summary?event=${encodeURIComponent(id)}`));
  // Each play with the ESPN ids of who ran, caught or threw it (participant roles: rusher, receiver, passer, ...).
  function parseCorePlays(j) {
    const plays = ((j && j.items) || []).map((p) => ({ ...normPlay(p), id: String(p.id),
      who: (p.participants || []).map((q) => ({ id: (/\/athletes\/(\d+)/.exec((q.athlete && q.athlete.$ref) || '') || [])[1], role: q.type })).filter((q) => q.id) }));
    return { count: +(j && j.count) || 0, pageCount: +(j && j.pageCount) || 0, plays };
  }
  const fetchCorePlays = async (get, id, page) => {
    const g = encodeURIComponent(id);
    return parseCorePlays(await get(`${CORE}/events/${g}/competitions/${g}/plays?limit=${CORE_PAGE}&page=${Math.max(1, page | 0)}`));
  };

  const api = { BASE, CORE, CORE_PAGE, fracLeft, parseScoreboard, parseSummary, fetchScoreboard, fetchGame, parseCorePlays, fetchCorePlays };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).espn = api;
})(typeof self !== 'undefined' ? self : globalThis);
