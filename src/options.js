/* Options page. Every control saves as it changes; the box on an open streaming tab picks the change up at once. */
(async function () {
  'use strict';
  const SL = self.SL;
  const $ = (id) => document.getElementById(id);
  let cfg = await SL.settings.load();

  // Extension pages may call these hosts directly (host_permissions); a private ESPN league sends the viewer's own cookies.
  // The phone remote for the TV app (tv/remote.html) supplies SL_GET, which goes through the TV's own proxy instead.
  const get = self.SL_GET || async function (url, opts) {
    const r = await fetch(url, { credentials: opts && opts.credentials === 'include' ? 'include' : 'omit' });
    if (!r.ok) throw new Error(`${new URL(url).hostname} answered ${r.status}`);
    return r.json();
  };
  const memory = new Map();
  const store = { get: async (k) => memory.get(k), set: async (k, v) => { memory.set(k, v); } };
  const say = (id, text, cls) => { const n = $(id); n.textContent = text; n.className = cls || 'mute'; };
  const save = async (patch) => { cfg = { ...cfg, ...patch }; await SL.settings.save(patch); };

  /* ---- segmented controls ---- */
  function seg(id, options, current, onPick, type = 'radio') {
    const wrap = $(id);
    wrap.replaceChildren(...options.map(([value, label]) => {
      const input = Object.assign(document.createElement('input'), { type, name: id, value, checked: type === 'radio' ? current === value : !!current[value] });
      input.addEventListener('change', () => onPick(value, input.checked));
      const l = document.createElement('label');
      l.append(input, ' ' + label);
      return l;
    }));
  }
  const corners = [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']];
  seg('corner', corners, cfg.corner, (v) => save({ corner: v }));
  seg('mvCorner', [['auto', 'Auto'], ...corners], cfg.mvCorner, (v) => save({ mvCorner: v }));
  seg('size', [['S', 'Small'], ['M', 'Medium'], ['L', 'Large']], cfg.size, (v) => save({ size: v }));
  seg('view', [['live', 'Only players whose game is on'], ['all', 'All starters']], cfg.view, (v) => save({ view: v }));
  seg('moments', [['td', 'Touchdowns'], ['fg', 'Field goals'], ['big', 'Big plays'], ['bad', 'Turnovers'], ['play', 'Every scoring play'], ['opp', "Opponent's TDs and big plays"], ['full', 'My touchdowns fill the screen']], cfg.moments,
    (v, on) => save({ moments: { ...cfg.moments, [v]: on } }), 'checkbox');
  $('photos').checked = cfg.photos; $('photos').addEventListener('change', (e) => save({ photos: e.target.checked }));
  $('enabled').checked = cfg.enabled; $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));

  /* ---- stream and delay ---- */
  const stream = $('stream');
  stream.replaceChildren(...Object.entries(SL.settings.PRESETS).map(([k, [name, s]]) => Object.assign(document.createElement('option'), { value: k, textContent: `${name} · about ${s} s` })));
  stream.value = cfg.stream;
  const paintDelay = () => { $('delay').textContent = SL.settings.delaySecOf(cfg) + ' s'; };
  stream.addEventListener('change', async () => { await save({ stream: stream.value, nudge: 0 }); paintDelay(); });
  $('minus').addEventListener('click', async () => { await save({ nudge: cfg.nudge - 5 }); paintDelay(); });
  $('plus').addEventListener('click', async () => { await save({ nudge: cfg.nudge + 5 }); paintDelay(); });
  $('reset').addEventListener('click', async () => { await save({ nudge: 0 }); paintDelay(); });
  paintDelay();

  /* ---- Sleeper ---- */
  $('sleeper').value = cfg.sleeperUser;
  $('sleeperGo').addEventListener('click', async () => {
    const name = $('sleeper').value.trim();
    if (!name) return say('sleeperMsg', 'Type your Sleeper username first.', 'err');
    say('sleeperMsg', 'Looking…');
    try {
      const r = await SL.leagues.buildLeagues(get, { sleeperUser: name, espnLeagues: [] }, store);
      if (r.errors.length) return say('sleeperMsg', r.errors.join(' '), 'err');
      await save({ sleeperUser: name });
      say('sleeperMsg', r.models.length ? `Found ${r.models.length} league${r.models.length > 1 ? 's' : ''} with a game this week: ${r.models.map((m) => m.name).join(', ')}.`
        : 'Username works, but no league has a matchup this week yet.', 'ok');
    } catch (e) { say('sleeperMsg', e.message, 'err'); }
  });

  /* ---- ESPN ---- */
  let pendingRef = null;
  const paintEspn = () => {
    $('espnList').replaceChildren(...cfg.espnLeagues.map((ref, i) => {
      const li = document.createElement('li');
      const b = Object.assign(document.createElement('button'), { textContent: 'Remove' });
      b.addEventListener('click', async () => { await save({ espnLeagues: cfg.espnLeagues.filter((_, n) => n !== i) }); paintEspn(); });
      li.append(Object.assign(document.createElement('span'), { textContent: `${ref.label || 'ESPN'} · league ${ref.leagueId}` }), b);
      return li;
    }));
  };
  $('espnGo').addEventListener('click', async () => {
    try {
      const ref = SL.espnFantasy.parseLeagueUrl($('espnUrl').value);
      say('espnMsg', 'Looking…');
      const state = await get(SL.sleeper.API + '/state/nfl');
      const season = ref.season || state.league_season;
      const found = await SL.espnFantasy.listTeams(get, ref.leagueId, season, state.week);
      pendingRef = { ...ref, season, label: found.name.slice(0, 8).toUpperCase() };
      $('espnTeam').replaceChildren(...found.teams.map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: t.name })));
      if (ref.teamId) $('espnTeam').value = ref.teamId;
      $('espnPick').hidden = false;
      say('espnMsg', `${found.name}: pick your team, then add it.`, 'ok');
    } catch (e) {
      say('espnMsg', /\b40[13]\b/.test(e.message) ? (self.SL_PRIVATE_HINT || 'ESPN says that league is private. Sign in to espn.com in this Chrome, then try again.') : e.message, 'err');
    }
  });
  $('espnAdd').addEventListener('click', async () => {
    if (!pendingRef) return;
    const ref = { ...pendingRef, teamId: $('espnTeam').value };
    await save({ espnLeagues: [...cfg.espnLeagues.filter((x) => x.leagueId !== ref.leagueId), ref] });
    $('espnPick').hidden = true; $('espnUrl').value = ''; pendingRef = null;
    say('espnMsg', 'Added.', 'ok'); paintEspn();
  });
  paintEspn();
})();
