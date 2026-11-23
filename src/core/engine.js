/* The engine: poll live games, keep a points ledger per starter, turn changes into moment cards, and hold everything
   back by the viewer's stream delay so the box never shows a play before the stream does.

   Time model: an observation is stamped with the wall-clock time of the new plays that caused it, or with "now" when
   the box score moved before the play feed did (never earlier: early is a spoiler, late is only late). A card is
   released at that time + delay, and the lineup shows each starter's points "as of" now - delay. `now` should be
   corrected to ESPN's clock (see content.js), because play times come from ESPN's servers. */
(function (root) {
  'use strict';
  const need = (path, key) => (typeof require !== 'undefined' ? require(path) : root.SL[key]);
  const S = need('./scoring', 'scoring');
  const E = need('./espn', 'espn');

  // A Sleeper lineup is read again each minute: its own live points are what calibrate() lines the box up with.
  const POLL_LIVE = 8000, POLL_IDLE = 45000, BOARD_TTL = 30000, LINEUP_TTL = 60000, POINTS_TTL = 20000, STABLE_MS = 120000;
  const FRAME_MS = 1000, STALE_MS = 90000, RECENT_PLAY_MS = 120000;

  const MOMENT = {
    td: { prio: 9, ttl: 6000, title: 'TOUCHDOWN' }, bad: { prio: 5, ttl: 3600, title: 'TURNOVER' }, fg: { prio: 4, ttl: 3600, title: 'FIELD GOAL' },
    big: { prio: 3, ttl: 3800, title: 'BIG PLAY' }, play: { prio: 1, ttl: 3000, title: null },
  };
  const RANK = { td: 5, bad: 4, fg: 3, big: 2, play: 1 };
  const MEAN = { QB: 17, RB: 11, WR: 11, TE: 8, K: 8, DEF: 8, FLEX: 10, OP: 17 };   // rough weekly averages for the win-chance estimate

  // Ids and team codes come from third-party APIs: only digits and letters may reach the image address. ESPN's resizer
  // serves a 240 px headshot at about 45 KB instead of the 250 KB original.
  const IMG = 'https://a.espncdn.com/combiner/i?img=/i/';
  const photo = (st, id) => {
    const pid = String(id || st.espnId || '');
    if (/^\d{1,10}$/.test(pid)) return `${IMG}headshots/nfl/players/full/${pid}.png&w=240&h=175`;
    const team = String(st.team).toLowerCase();
    return /^[a-z]{2,3}$/.test(team) ? `${IMG}teamlogos/nfl/500/${team}.png&w=120&h=120` : '';
  };

  function erf(x) {                                          // Abramowitz-Stegun 7.1.26
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }
  const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

  function describe(p, st) {
    const y = Math.abs(p.yds);
    if (st.pos === 'DEF' && p.scoring) return 'Defensive TD';
    switch (p.type) {
      case 'Passing Touchdown': return st.pos === 'QB' ? `${y}-yd TD pass` : `${y}-yd TD catch`;
      case 'Rushing Touchdown': return `${y}-yd TD run`;
      case 'Pass Reception': return p.yds < 0 ? `${y}-yd loss` : st.pos === 'QB' ? `${y}-yd pass` : `${y}-yd catch`;
      case 'Rush': return p.yds < 0 ? `${y}-yd loss` : `${y}-yd run`;
      case 'Field Goal Good': { const m = /(\d+) yard field goal/i.exec(p.text); return m ? `Good from ${m[1]}` : 'Field goal'; }
      case 'Sack': return st.pos === 'DEF' ? 'Sack' : 'Sacked';
      case 'Pass Interception Return': return st.pos === 'DEF' ? 'Interception' : 'Interception thrown';
      default: return /fumble/i.test(p.type || '') ? 'Fumble' : p.text.replace(/\s*\(.*?\)/g, '').slice(0, 40);
    }
  }

  const turnover = (p) => /interception/i.test(p.type || '') || /fumble recovery \(opponent\)/i.test(p.type || '') || /\bINTERCEPTED\b/.test(p.text || '');

  function momentOf(p, st, dv) {
    if (st.pos === 'K') return /field goal is GOOD/i.test(p.text) ? 'fg' : 'play';
    if (st.pos === 'DEF') return p.scoring ? 'td' : 'big';
    if (p.scoring && /TOUCHDOWN/.test(p.text)) return 'td';
    // Only a real turnover is a "Turnover": a loss of yards or a sack also costs points, but it is just a play.
    if (dv < 0) return turnover(p) ? 'bad' : 'play';
    return p.yds >= 20 ? 'big' : 'play';
  }

  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRes = new Map();
  /** "J.Smith" must not match "J.Smith-Njigba". */
  const nameRe = (name) => {
    const ab = S.abbrev(name);
    if (!nameRes.has(ab)) nameRes.set(ab, new RegExp(`(^|[^A-Za-z.])${reEsc(ab)}(?![A-Za-z'’-])`));
    return nameRes.get(ab);
  };

  function mentions(p, st, game) {
    if (st.pos === 'DEF') {
      const opp = game.teams.find((t) => t.abbr !== st.team);
      return !!opp && p.off === opp.id && /^(Sack|Pass Interception Return|Fumble Recovery \(Opponent\))$/.test(p.type || '');
    }
    return nameRe(st.name).test(p.text);
  }

  // A gain can't take points off and a loss can't add them: a change that runs against the play's yards is ESPN correcting
  // an earlier number (13 yards made 12), not that play happening again.
  const against = (p, st, dv) => st.pos !== 'DEF' && st.pos !== 'K' && !turnover(p) && ((dv < 0 && p.yds > 0) || (dv > 0 && p.yds < 0));

  function pickPlay(st, dv, game, plays, used) {
    let best = null;
    for (const p of plays) {
      if ((used && used.has(p.id)) || !mentions(p, st, game) || against(p, st, dv)) continue;
      const kind = momentOf(p, st, dv);
      if (!best || RANK[kind] > RANK[best.kind]) best = { play: p, kind };
    }
    return best;
  }

  /** Call a host callback without letting its exception kill the loop that called it. */
  let hostBugLogged = false;
  function safe(fn, arg) {
    try {
      if (fn) fn(arg);
    } catch (e) {
      // The host's own bug: the engine keeps running, but say it once so it is findable (every frame would flood the console).
      if (!hostBugLogged) { hostBugLogged = true; console.error('Sideline: a host callback threw', e); }
    }
  }

  /**
   * @param {{ get: Function, now?: Function, timer?: {set: Function, clear: Function}, settings: () => {delaySec: number, moments: object},
   *           onFrame: Function, onCard: Function, onStatus?: Function, refreshLeague?: Function }} o
   */
  function createEngine(o) {
    const get = o.get, now = o.now || Date.now, settings = o.settings;
    const T = o.timer || { set: (f, ms) => setTimeout(f, ms), clear: (id) => clearTimeout(id) };
    let leagues = [], board = null, started = 0, running = false, loopTimer = null, frameTimer = null;
    const games = new Map(), finalized = new Set(), preSeenAt = new Map(), lastSeq = new Map(), emitted = new Set();
    const last = new Map(), hist = new Map(), refreshedAt = new Map(), resolvedId = new Map();
    const addedAt = new Map(), usedPlays = new Map(), leagueErrors = new Map(), changedAt = new Map(), offsets = new Map();
    let pending = [], issues = [];

    const delayMs = () => Math.max(0, +settings().delaySec || 0) * 1000;
    const sides = (L) => [...L.me.starters.map((st) => [st, true]), ...(L.opp ? L.opp.starters.map((st) => [st, false]) : [])];
    const rosteredTeams = () => new Set(leagues.flatMap((L) => sides(L).map(([st]) => st.team)).filter(Boolean));
    // The week is part of the key, so next week's lineup never measures itself against last week's totals.
    const keyOf = (L, st) => `${L.id}|${L.week || 0}|${st.key}`;
    const gameOf = (team) => {
      for (const g of games.values()) if (g.teams.some((t) => t.abbr === team)) return g;
      return board && board.games.find((g) => g.teams.some((t) => t.abbr === team));
    };

    /* ---- ledger ---- */
    function observe(L, st, value, t, game, plays, agg, mine) {
      if (value === null || value === undefined) return;
      const k = keyOf(L, st);
      const h = hist.get(k) || [];
      hist.set(k, h);
      let prev = last.get(k);
      last.set(k, value);
      if (prev === undefined) {
        // From zero only when we watched this game start after this league arrived; otherwise the points so far are the
        // baseline, not a moment (joining mid-game, or adding a league during a game).
        const fromZero = !!game && (preSeenAt.get(game.id) || -1) >= (addedAt.get(L.id) || 0);
        prev = fromZero ? 0 : value;
        h.push({ t: 0, v: prev });
        if (!fromZero) return;
      }
      if (value === prev) return;
      changedAt.set(k, now());
      h.push({ t, v: value });
      collect(agg, L, st, S.round(value - prev), value, game, plays, mine);
    }

    function collect(agg, L, st, dv, value, game, plays, mine) {
      const ukey = L.id + '|' + st.key;
      const used = usedPlays.get(ukey) || new Set();
      usedPlays.set(ukey, used);
      let hit = game ? pickPlay(st, dv, game, plays, used) : null;
      if (!hit && game) {
        // ESPN's box score can update a tick after the play that caused it, and ESPN posts plays about a minute late:
        // look back three minutes (by the clock, not by the feed) over plays not yet used.
        const since = now() - RECENT_PLAY_MS - 60000;
        hit = pickPlay(st, dv, game, game.plays.filter((p) => p.t && p.t >= since), used);
      }
      // The opponent's side: only their touchdowns and big plays, the moments worth knowing about.
      if (!mine && !(hit && dv > 0 && (hit.kind === 'td' || hit.kind === 'big'))) return;
      if (hit) used.add(hit.play.id);
      const id = `${mine ? '' : 'opp:'}${st.key}:${hit ? hit.play.id : 'p' + value + ':' + L.week}`;
      const e = agg.get(id) || { id, st, hit, game, dv, chips: [], mine };
      e.chips.push({ label: mine ? L.label : (L.opp && L.opp.name) || L.label, mine, d: dv });
      agg.set(id, e);
    }

    // "CAR at NO": which game a card is from, for the ones you aren't watching.
    function gameName(game) {
      if (!game) return '';
      const g = board && board.games.find((x) => x.id === game.id);
      return String((g && g.name) || game.name || '').replace(' @ ', ' at ');
    }

    function buildCard(e) {
      const kind = e.hit ? e.hit.kind : 'play';                 // no play to read: a points change, never called a turnover
      const m = MOMENT[kind];
      const line = e.hit ? describe(e.hit.play, e.st) : (e.dv < 0 ? 'Points taken off' : 'Points added');
      const baseT = (e.hit && e.hit.play.t) || now();           // no play to time it by: now, never an older play's time
      return {
        id: e.id, kind, layer: 'fantasy', prio: m.prio, ttl_ms: m.ttl,
        title: e.mine === false ? 'THEIR ' + m.title : kind === 'big' && e.st.pos === 'DEF' ? line.toUpperCase() : m.title, line, value: { n: e.dv, unit: 'pts' },
        side: e.mine === false ? 'opp' : 'me', game: gameName(e.game),
        subject: { key: e.st.key, espnId: e.st.espnId, name: e.st.name, pos: e.st.pos, team: e.st.team, photo: photo(e.st, resolvedId.get(e.st.key)) },
        chips: e.chips, gameId: e.game && e.game.id, base_t: baseT, show_at: baseT + delayMs(), via: e.via || 'box',
        data: e.hit ? { play: { kind, yds: e.hit.play.yds, down: e.hit.play.down } } : undefined,
      };
    }

    /* ---- release cards at play time + delay ---- */
    function release(entry) {
      pending = pending.filter((x) => x !== entry);
      // Points going down with no play to explain them are a stat correction: the score moves, but there is no moment.
      if (!entry.card.data && entry.card.value.n < 0) return;
      const wanted = settings().moments || {};
      if (entry.card.side === 'opp' && wanted.opp === false) return;
      if (wanted[entry.card.kind] !== false && (entry.card.kind !== 'play' || wanted.play)) safe(o.onCard, entry.card);
    }
    function schedule(entry) {
      entry.card.show_at = entry.card.base_t + delayMs();
      entry.timer = T.set(() => release(entry), Math.max(0, entry.card.show_at - now()));
    }
    function queue(card) {
      if (emitted.has(card.id)) return;
      if (card.base_t + delayMs() < now() - STALE_MS) return;     // older than the viewer can care about (not marked: never a silent loss)
      emitted.add(card.id);
      const entry = { card, timer: null };
      pending.push(entry);
      schedule(entry);
    }

    /* ---- the fast play feed: touchdown and big-play cards a few seconds before the box score has them ---- */
    // The card's points come from the play and the league's scoring (S.playPoints). When the box score catches up, its change
    // finds the same play, so the card id repeats and queue() drops it: one card, and the row's points follow the box score.
    const SKILL = new Set(['QB', 'RB', 'WR', 'TE']), CARRY = new Set(['rusher', 'receiver', 'passer']);
    // ESPN posts a play first and fills it in after (the touchdown flag, the final yards), so a play counts as fresh when it is
    // new or when what it says has changed since the last look.
    const coreState = new Map();                                    // game id -> { count, sigs: play id -> what it said }
    const sigOf = (p) => `${p.scoring ? 1 : 0}|${p.yds}|${p.text.length}`;
    async function freshPlays(gid) {
      const s = coreState.get(gid);
      let page = s ? Math.max(1, Math.ceil(s.count / E.CORE_PAGE)) : 1;
      let r = await E.fetchCorePlays(get, gid, page);
      if (r.pageCount > page) { page = r.pageCount; r = await E.fetchCorePlays(get, gid, page); }   // first look, or a new page began
      let plays = r.plays;
      if (plays.length < 10 && page > 1) plays = (await E.fetchCorePlays(get, gid, page - 1)).plays.concat(plays);   // keep the last minutes in view
      coreState.set(gid, { count: r.count, sigs: new Map(plays.map((p) => [p.id, sigOf(p)])) });
      return s ? plays.filter((p) => s.sigs.get(p.id) !== sigOf(p)) : [];   // the first look only learns what is already there
    }
    function earlyCards(g, plays, out) {
      for (const p of plays) {
        if (/no play/i.test(p.text) || /penalty|timeout/i.test(p.type || '')) continue;
        const td = p.scoring && /TOUCHDOWN/i.test(p.text);
        if (!td && !(p.yds >= 20)) continue;
        for (const L of leagues) {
          if (L.source !== 'box') continue;                        // ESPN leagues score with ESPN's own points: they wait for them
          for (const [st, mine] of sides(L)) {
            if (!SKILL.has(st.pos) || !g.teams.some((t) => t.abbr === st.team)) continue;
            const pid = String(resolvedId.get(st.key) || st.espnId || '');
            const q = pid && (p.who || []).find((x) => x.id === pid && CARRY.has(x.role));
            if (!q) continue;
            const dv = S.round(S.playPoints(q.role, p.yds, td, st.pos, L.scoring || {}));
            const kind = dv > 0 ? momentOf(p, st, dv) : null;
            if (kind !== 'td' && kind !== 'big') continue;
            const id = `${mine ? '' : 'opp:'}${st.key}:${p.id}`;
            const e = out.get(id) || { id, st, hit: { play: p, kind }, game: g, dv, chips: [], mine, via: 'fast' };
            e.chips.push({ label: mine ? L.label : (L.opp && L.opp.name) || L.label, mine, d: dv });
            out.set(id, e);
          }
        }
      }
    }

    /* ---- polling ---- */
    function processGame(game, agg) {
      games.set(game.id, game);
      const seq0 = lastSeq.has(game.id) ? lastSeq.get(game.id) : -1;
      const plays = game.plays.filter((p) => p.seq > seq0);
      const times = plays.map((p) => p.t).filter(Boolean);
      const t = times.length ? Math.max(...times) : now();
      for (const L of leagues) {
        if (L.source !== 'box') continue;
        for (const [st, mine] of sides(L)) {
          if (!game.teams.some((tm) => tm.abbr === st.team)) continue;
          const a = st.pos === 'DEF' ? null : S.findAthlete(st, game.box);
          if (a) resolvedId.set(st.key, a.id);                    // remembered for the headshot when Sleeper had no ESPN id
          observe(L, st, S.playerPoints(st, game, L.scoring), t, game, plays, agg, mine);
        }
      }
      if (game.plays.length) lastSeq.set(game.id, game.plays[game.plays.length - 1].seq);
    }

    function observePoints(L, agg) {
      for (const [st, mine] of sides(L)) {
        const game = gameOf(st.team);
        const recent = game && game.feedTime ? game.plays.filter((p) => p.t && p.t > game.feedTime - RECENT_PLAY_MS) : [];
        observe(L, st, st.pts, now(), game, recent, agg, mine);
      }
    }

    /* ---- the league's own number ---- */
    // Sideline builds points from ESPN's box score with the league's scoring settings, which can't see every rule (a league's
    // yards-allowed tiers, return yardage, first downs, ...). Sleeper's live points are the league's truth: once a player's
    // ESPN-built points have stood still for two minutes, the gap to Sleeper becomes an adjustment on that row. Only a settled
    // number is adjusted, so the box never runs ahead of the stream or counts a play twice while the two feeds catch up.
    function calibrate(L) {
      for (const [st] of sides(L)) {
        const k = keyOf(L, st), ours = last.get(k);
        if (typeof st.official !== 'number' || ours == null) continue;
        if (now() - (changedAt.get(k) || 0) < STABLE_MS) continue;
        const d = S.round(st.official - ours);
        if (Math.abs(d) < 0.05) offsets.delete(k); else offsets.set(k, d);
      }
    }

    async function refreshLeagues(agg) {
      if (!o.refreshLeague) return;
      for (const L of [...leagues]) {
        const every = L.source === 'points' ? POINTS_TTL : LINEUP_TTL;
        if (now() - (refreshedAt.get(L.id) || 0) < every) continue;
        try {
          const fresh = await o.refreshLeague(L);
          refreshedAt.set(L.id, now());
          leagueErrors.delete(L.id);
          const i = leagues.indexOf(L);                           // setLeagues may have run while we waited
          if (fresh && i >= 0) { leagues[i] = fresh; if (fresh.source === 'points') observePoints(fresh, agg); else calibrate(fresh); }
          // fresh === null means no matchup this week any more: keep the lineup we have rather than blank the box
        } catch (err) { leagueErrors.set(L.id, `${L.label}: ${err.message || err}`); }   // retried next tick; others go on
      }
    }

    async function tick() {
      const t0 = now();
      issues = [];
      if (!leagues.length) return emitFrame();                    // nothing to watch yet: no point asking ESPN anything
      if (!board || t0 - board.at > BOARD_TTL) {
        try {
          board = { ...(await E.fetchScoreboard(get)), at: t0 };
          for (const g of board.games) if (g.state === 'pre') preSeenAt.set(g.id, t0);
        } catch (err) {
          if (!board) throw err;
          issues.push('Scoreboard: ' + (err.message || err));     // keep polling games off the board we already have
        }
      }
      const teams = rosteredTeams();
      const live = board.games.filter((g) => g.state !== 'pre' && !finalized.has(g.id) && g.teams.some((t) => teams.has(t.abbr)));
      const [results, fast] = await Promise.all([
        Promise.allSettled(live.map((g) => E.fetchGame(get, g.id))),
        Promise.allSettled(live.filter((g) => g.state === 'in').map((g) => freshPlays(g.id).then((plays) => ({ g, plays })))),
      ]);
      // First the fast feed's cards, so the box score's card for the same play is the duplicate that gets dropped. A fast feed
      // that fails costs nothing but speed: those cards come from the box score as before.
      const early = new Map();
      for (const r of fast) if (r.status === 'fulfilled') earlyCards(r.value.g, r.value.plays, early);
      for (const e of early.values()) queue(buildCard(e));
      const agg = new Map();
      results.forEach((r, i) => {
        if (r.status === 'rejected') { issues.push(`${live[i].name}: ${(r.reason && r.reason.message) || r.reason}`); return; }
        processGame(r.value, agg);
        if (r.value.state === 'post') finalized.add(r.value.id);
      });
      await refreshLeagues(agg);
      issues.push(...leagueErrors.values());
      for (const e of agg.values()) queue(buildCard(e));
      emitFrame();
    }

    function anyLive() {
      const teams = rosteredTeams();
      return !!board && board.games.some((g) => g.state === 'in' && g.teams.some((t) => teams.has(t.abbr)));
    }

    async function loop() {
      if (!running) return;
      let wait = POLL_IDLE / 3;
      try {
        await tick();
        safe(o.onStatus, issues.length ? { ok: false, error: issues.join(' · ') } : { ok: true });
        wait = anyLive() ? POLL_LIVE : POLL_IDLE;
      } catch (err) {
        safe(o.onStatus, { ok: false, error: err.message || String(err) });
      } finally {
        if (running) loopTimer = T.set(loop, wait);
      }
    }

    /* ---- the frame the overlay draws ---- */
    const valueAt = (k, cutoff) => {
      const h = hist.get(k);
      if (!h) return 0;
      for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= cutoff) return h[i].v;
      return h[0].v;
    };
    const stateOf = (team) => { const g = gameOf(team); return g ? g.state : 'bye'; };
    const leftOf = (team) => { const g = gameOf(team); return g ? g.fracLeft : 0; };

    // Each starter still to play adds his remaining average and its swing (a week's fantasy score swings by about 80% of its
    // average, more than a bell curve's tails admit, so the answer stays between 1 and 99 while any game is on).
    function winPct(rows, oppRows, myNow, oppNow) {
      const spread = (rs) => rs.reduce((a, r) => {
        const m = MEAN[r.pos] || 9, left = leftOf(r.team);
        return { mu: a.mu + m * left, v: a.v + (0.8 * m) ** 2 * left };
      }, { mu: 0, v: 0 });
      const a = spread(rows), b = spread(oppRows);
      if (!a.v && !b.v) return myNow > oppNow ? 100 : myNow < oppNow ? 0 : 50;   // nothing left to play: decided
      const p = Math.round(100 * phi((myNow + a.mu - oppNow - b.mu) / Math.sqrt(a.v + b.v)));
      return Math.min(99, Math.max(1, p));
    }

    function frame() {
      const cutoff = now() - delayMs();
      const rowsOf = (L, side) => side.starters.map((st) => {
        const g = gameOf(st.team);
        return {
          key: st.key, espnId: st.espnId, name: st.name, pos: st.pos, team: st.team, slot: st.slot,
          pts: S.round(valueAt(keyOf(L, st), cutoff) + (offsets.get(keyOf(L, st)) || 0)), state: g ? g.state : 'bye', detail: g ? g.detail : '', gameId: g ? g.id : null,
          photo: photo(st, resolvedId.get(st.key)),
        };
      });
      const sum = (rs) => S.round(rs.reduce((a, r) => a + r.pts, 0));
      const live = anyLive();
      return {
        at: now(), week: board ? board.week : null, syncing: live && now() < started + delayMs(), live,
        games: board ? board.games.map((g) => ({ id: g.id, name: g.name, state: g.state, detail: g.detail, teams: g.teams, networks: g.networks })) : [],
        leagues: leagues.map((L) => {
          const rows = rowsOf(L, L.me), oppRows = L.opp ? rowsOf(L, L.opp) : [];
          const my = sum(rows), their = sum(oppRows);
          return {
            id: L.id, label: L.label, name: L.name, platform: L.platform, week: L.week, me: { name: L.me.name, total: my, rows },
            opp: L.opp ? { name: L.opp.name, total: their } : null, winPct: L.opp ? winPct(rows, oppRows, my, their) : null,
          };
        }),
      };
    }
    const emitFrame = () => safe(o.onFrame, frame());

    /* ---- public ---- */
    return {
      setLeagues(next) {
        const added = next.some((L) => !addedAt.has(L.id));
        for (const L of next) if (!addedAt.has(L.id)) addedAt.set(L.id, now());
        leagues = next;
        refreshedAt.clear(); leagueErrors.clear();
        // A new league may have starters in games we already closed. Reloading the same leagues (the error retry runs every
        // minute) must not reopen them, or finished games are fetched again for nothing.
        if (added) finalized.clear();
      },
      start() {
        if (running) return;
        running = true; started = now();
        loop();
        const beat = () => {
          if (!running) return;
          try { emitFrame(); } finally { frameTimer = T.set(beat, FRAME_MS); }
        };
        beat();
      },
      stop() { running = false; T.clear(loopTimer); T.clear(frameTimer); pending.forEach((p) => T.clear(p.timer)); pending = []; },
      /** The viewer nudged their delay: pending cards move with it. */
      retime() { pending.forEach((p) => { T.clear(p.timer); schedule(p); }); emitFrame(); },
      tick, frame, pendingCount: () => pending.length,
    };
  }

  const api = { createEngine, describe, momentOf, pickPlay, phi, MOMENT };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).engine = api;
})(typeof self !== 'undefined' ? self : globalThis);
