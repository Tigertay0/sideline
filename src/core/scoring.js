/* Fantasy points from ESPN box scores + play text, using a Sleeper-style scoring_settings object.
   Pure functions: no network, no DOM. Loaded as a content script (SL.scoring) or via require() in tests. */
(function (root) {
  'use strict';

  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  // Sleeper says WAS, ESPN says WSH; everything else matches.
  const TEAM_ALIAS = { WAS: 'WSH', LA: 'LAR', JAC: 'JAX' };
  const normTeam = (t) => TEAM_ALIAS[t] || t;

  /** ESPN summary -> { [athleteId]: { id, name, team, cats } }. Split keys ("23/33", "1-14") become two stats. */
  function parseBoxscore(summary) {
    const out = {};
    for (const t of (summary.boxscore && summary.boxscore.players) || []) {
      for (const cat of t.statistics || []) {
        for (const a of cat.athletes || []) {
          const id = a.athlete.id;
          const p = out[id] || (out[id] = { id, name: a.athlete.displayName, team: normTeam(t.team.abbreviation), cats: {} });
          const c = (p.cats[cat.name] = {});
          cat.keys.forEach((key, i) => {
            const sep = key.includes('/') ? '/' : key.includes('-') ? '-' : null;
            if (!sep) { c[key] = num(a.stats[i]); return; }
            const [k1, k2] = key.split(sep);
            const [v1, v2] = String(a.stats[i]).split(sep);
            c[k1] = num(v1); c[k2] = num(v2);
          });
        }
      }
    }
    return out;
  }

  const SUFFIX = /\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i;
  /** "Amon-Ra St. Brown" -> "A.St. Brown", the way ESPN play text writes it. */
  function abbrev(name) {
    const n = String(name).replace(SUFFIX, '').trim();
    const i = n.indexOf(' ');
    return i < 0 ? n : n[0] + '.' + n.slice(i + 1);
  }

  /** Field goal attempts found in play text: [{ who: 'D.Stevens', dist: 46, good: true }]. */
  function fieldGoals(plays) {
    const out = [];
    for (const p of plays) {
      const m = /([A-Z]\.[A-Za-z'’\-. ]+?)\s+(\d+)\s+yard field goal is (GOOD|NO GOOD|BLOCKED)/i.exec(p.text || '');
      if (m) out.push({ who: m[1].trim(), dist: +m[2], good: m[3].toUpperCase() === 'GOOD', playId: p.id });
    }
    return out;
  }

  /** Successful two-point conversions in play text: [{ who: 'P.Mahomes', role: 'pass' }, { who: 'T.Kelce', role: 'rec' }]. */
  function twoPoints(plays) {
    const out = [];
    for (const p of plays) {
      const m = /TWO-POINT CONVERSION ATTEMPT\.\s*(.+?)\.?\s*ATTEMPT SUCCEEDS/i.exec(p.text || '');
      if (!m) continue;
      const pass = /([A-Z]\.[A-Za-z'’\-. ]+?)\s+pass\b.*?\bto\s+([A-Z]\.[A-Za-z'’\-.]+(?: [A-Z][a-z]+)?)/i.exec(m[1]);
      if (pass) out.push({ who: pass[1].trim(), role: 'pass' }, { who: pass[2].trim(), role: 'rec' });
      else { const r = /^([A-Z]\.[A-Za-z'’\-.]+)/.exec(m[1].trim()); if (r) out.push({ who: r[1], role: 'rush' }); }
    }
    return out;
  }

  const FG_KEYS = [[19, 'fgm_0_19'], [29, 'fgm_20_29'], [39, 'fgm_30_39'], [49, 'fgm_40_49'], [59, 'fgm_50_59'], [Infinity, 'fgm_60p']];
  function fgValue(dist, sc) {
    const key = FG_KEYS.find(([max]) => dist <= max)[1];
    let v = sc[key];
    if (v === undefined && dist >= 50) v = sc.fgm_50p;        // older Sleeper leagues use one 50+ bucket
    if (v === undefined && dist >= 60) v = sc.fgm_60p;
    return (v || 0) + (sc.fgm_yds || 0) * dist;
  }

  const g = (cats, cat, key) => (cats[cat] && cats[cat][key]) || 0;

  function offenseStats(cats) {
    return {
      pass_yd: g(cats, 'passing', 'passingYards'), pass_td: g(cats, 'passing', 'passingTouchdowns'),
      pass_int: g(cats, 'passing', 'interceptions'), pass_cmp: g(cats, 'passing', 'completions'),
      pass_att: g(cats, 'passing', 'passingAttempts'), pass_sack: g(cats, 'passing', 'sacks'),
      rush_yd: g(cats, 'rushing', 'rushingYards'), rush_att: g(cats, 'rushing', 'rushingAttempts'), rush_td: g(cats, 'rushing', 'rushingTouchdowns'),
      rec: g(cats, 'receiving', 'receptions'), rec_yd: g(cats, 'receiving', 'receivingYards'),
      rec_td: g(cats, 'receiving', 'receivingTouchdowns'), rec_tgt: g(cats, 'receiving', 'receivingTargets'),
      fum_lost: g(cats, 'fumbles', 'fumblesLost'), fum: g(cats, 'fumbles', 'fumbles'),
      xpm: g(cats, 'kicking', 'extraPointsMade'), xpa: g(cats, 'kicking', 'extraPointAttempts'),
      ret_td: g(cats, 'kickReturns', 'kickReturnTouchdowns') + g(cats, 'puntReturns', 'puntReturnTouchdowns'),
    };
  }

  const PLAIN = ['pass_yd', 'pass_td', 'pass_int', 'pass_cmp', 'pass_att', 'pass_sack', 'rush_yd', 'rush_att', 'rush_td',
    'rec', 'rec_yd', 'rec_td', 'rec_tgt', 'fum_lost', 'fum', 'xpm', 'ret_td'];
  const BONUS = [['pass_yd', 300, 'bonus_pass_yd_300'], ['pass_yd', 400, 'bonus_pass_yd_400'], ['rush_yd', 100, 'bonus_rush_yd_100'],
    ['rush_yd', 200, 'bonus_rush_yd_200'], ['rec_yd', 100, 'bonus_rec_yd_100'], ['rec_yd', 200, 'bonus_rec_yd_200']];
  const POS_REC_BONUS = { TE: 'bonus_rec_te', RB: 'bonus_rec_rb', WR: 'bonus_rec_wr' };

  const TWO_PT = { pass: 'pass_2pt', rec: 'rec_2pt', rush: 'rush_2pt' };

  function scoreOffense(pos, cats, myFgs, sc, my2pt) {
    const st = offenseStats(cats);
    let pts = 0;
    for (const x of my2pt || []) pts += sc[TWO_PT[x.role]] || 0;
    const rr = st.rush_yd + st.rec_yd;                       // combined rushing + receiving yardage bonuses
    if (rr >= 100) pts += sc.bonus_rush_rec_yd_100 || 0;
    if (rr >= 200) pts += sc.bonus_rush_rec_yd_200 || 0;
    for (const k of PLAIN) pts += (sc[k] || 0) * st[k];
    pts += (sc.xpmiss || 0) * Math.max(0, st.xpa - st.xpm);
    for (const [stat, min, key] of BONUS) if (st[stat] >= min) pts += sc[key] || 0;
    if (POS_REC_BONUS[pos]) pts += (sc[POS_REC_BONUS[pos]] || 0) * st.rec;
    for (const f of myFgs) pts += f.good ? fgValue(f.dist, sc) : (sc.fgmiss || 0);
    return pts;
  }

  // What one play is worth to the player who ran, caught or threw it, from the play alone (the fast feed has no box score).
  // Yardage bonuses and stat corrections are left to the box score, which follows a few seconds later.
  function playPoints(role, yds, td, pos, sc) {
    const w = (k) => sc[k] || 0;
    if (role === 'rusher') return w('rush_att') + w('rush_yd') * yds + (td ? w('rush_td') : 0);
    if (role === 'receiver') return w('rec') + w('rec_tgt') + (POS_REC_BONUS[pos] ? w(POS_REC_BONUS[pos]) : 0) + w('rec_yd') * yds + (td ? w('rec_td') : 0);
    if (role === 'passer') return w('pass_att') + w('pass_cmp') + w('pass_yd') * yds + (td ? w('pass_td') : 0);
    return 0;
  }

  const PA_KEYS = [[0, 'pts_allow_0'], [6, 'pts_allow_1_6'], [13, 'pts_allow_7_13'], [20, 'pts_allow_14_20'],
    [27, 'pts_allow_21_27'], [34, 'pts_allow_28_34'], [Infinity, 'pts_allow_35p']];

  const YA_KEYS = [[99, 'yds_allow_0_100'], [199, 'yds_allow_100_199'], [299, 'yds_allow_200_299'], [349, 'yds_allow_300_349'],
    [399, 'yds_allow_350_399'], [449, 'yds_allow_400_449'], [499, 'yds_allow_450_499'], [549, 'yds_allow_500_549'], [Infinity, 'yds_allow_550p']];

  // Team defense. Sacks, takeaways, forced fumbles, safeties, blocked kicks and return touchdowns are team facts, read from play
  // text and the box score; points and yards allowed from the score and the other team's total yards.
  // shortcut: points allowed is the opponent's whole score (their defensive TDs are not subtracted); upgrade if a league cares.
  function scoreDst(team, game, sc) {
    const me = game.teams.find((t) => t.abbr === team);
    const opp = game.teams.find((t) => t.abbr !== team);
    if (!me || !opp) return 0;
    let sack = 0, int = 0, fumRec = 0, ff = 0, safe = 0, blk = 0;
    for (const p of game.plays) {
      if (p.off !== opp.id) continue;                      // only plays where the other team had the ball
      // ESPN can fold several into one play: "Sack Opp Fumble Recovery" is a sack, a forced fumble and a recovery.
      const type = p.type || '', text = p.text || '';
      if (/^sack/i.test(type)) sack += 1;
      if (/interception/i.test(type)) int += 1;
      if (/fumble recovery \(opponent\)|opp fumble recovery/i.test(type)) fumRec += 1;
      if (/FUMBLES \(|FUMBLES[^.]*?forced by/i.test(text)) ff += 1;
      if (/^safety$/i.test(p.type || '')) safe += 1;
      if (/^blocked/i.test(p.type || '')) blk += 1;         // Blocked Punt, Blocked Field Goal, Blocked PAT: their kick
    }
    let boxTd = 0, intTd = 0, stTd = 0;
    for (const a of Object.values(game.box)) if (a.team === team) {
      boxTd += g(a.cats, 'defensive', 'defensiveTouchdowns');
      intTd += g(a.cats, 'interceptions', 'interceptionTouchdowns');
      stTd += g(a.cats, 'kickReturns', 'kickReturnTouchdowns') + g(a.cats, 'puntReturns', 'puntReturnTouchdowns');
    }
    const defTd = Math.max(boxTd, intTd);                  // defensiveTouchdowns may already include INT returns: take the larger, never both
    // Points allowed: what their offense scored. Their return or defensive touchdowns were not this defense's doing, and Sleeper
    // leaves them out too. Read from the score after each play; without it, their whole score.
    let allowed = opp.score;
    if (game.plays.some((p) => p.away != null)) {
      allowed = 0;
      let prev = 0;
      for (const p of game.plays) {
        const s = opp.home ? p.home : p.away;
        if (s == null) continue;
        if (s > prev && p.off === opp.id) allowed += s - prev;
        prev = Math.max(prev, s);
      }
    }
    const pa = PA_KEYS.find(([max]) => allowed <= max)[1];
    const yards = game.yards && game.yards[opp.abbr];
    const ya = yards == null ? null : YA_KEYS.find(([max]) => yards <= max)[1];
    return (sc.sack || 0) * sack + (sc.int || 0) * int + (sc.fum_rec || 0) * fumRec + (sc.def_td || 0) * defTd + (sc[pa] || 0)
      + (sc.ff || 0) * ff + (sc.safe || 0) * safe + (sc.blk_kick || 0) * blk
      + (sc.def_st_td != null ? sc.def_st_td : sc.st_td || 0) * stTd + (ya ? sc[ya] || 0 : 0);
  }

  const plain = (s) => String(s).toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();

  /** The box-score entry for a starter. Sleeper leaves espn_id empty for many players (checked against its live
      directory: Jayden Daniels has none), so after the id comes the full name, then first initial + surname, on the same team. */
  function findAthlete(starter, box) {
    if (starter.espnId && box[starter.espnId]) return box[starter.espnId];
    const team = normTeam(starter.team);
    const mates = Object.values(box).filter((a) => a.team === team);
    const full = plain(starter.name);
    return mates.find((a) => plain(a.name) === full) || mates.find((a) => abbrev(a.name) === abbrev(starter.name)) || null;
  }

  /** Points for one starter. `game` is a parsed summary ({box, plays, teams}). Returns null when the game has no data. */
  function playerPoints(starter, game, sc) {
    if (!game) return null;
    if (starter.pos === 'DEF' || starter.pos === 'D/ST') return round(scoreDst(normTeam(starter.team), game, sc));
    const cats = (findAthlete(starter, game.box) || {}).cats || {};
    const mine = abbrev(starter.name);
    const fgs = starter.pos === 'K' ? game.fgs.filter((f) => f.who === mine) : [];
    const two = twoPoints(game.plays).filter((x) => x.who === mine);
    return round(scoreOffense(starter.pos, cats, fgs, sc, two));
  }

  const round = (n) => Math.round(n * 100) / 100;

  const api = { parseBoxscore, abbrev, fieldGoals, twoPoints, fgValue, findAthlete, playerPoints, playPoints, normTeam, round };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).scoring = api;
})(typeof self !== 'undefined' ? self : globalThis);
