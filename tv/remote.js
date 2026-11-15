/* Phone remote: test moments, hide/show, and multiview (layout + which game is in each tile). The settings sections
   below it are the shared src/options.js, pointed at the TV by remote-host.js. */
(async function () {
  'use strict';
  const SL = self.SL;
  const R = self.SL_REMOTE;
  const $ = (id) => document.getElementById(id);
  const LAYOUTS = SL.layouts.LAYOUTS;
  const say = (text, cls) => { $('tvState').textContent = text; $('tvState').className = cls || 'mute'; };

  let cfg;
  try { cfg = await SL.settings.load(); } catch (e) { say(e.message, 'err'); return; }
  let state = null;
  const save = async (patch) => { cfg = { ...cfg, ...patch }; await SL.settings.save(patch); };
  const mv = () => ({ layout: 'off', tiles: [], ...(cfg.mv || {}) });

  async function refresh() {
    try {
      state = await R.cmd({ type: 'state' });
      if (!state || !state.ok) {
        say('The box is not running on the TV yet. On the TV, open Sideline and turn on "Display over other apps".', 'err');
      } else {
        const n = state.leagues;
        say(`Connected, ${n} league${n === 1 ? '' : 's'}, ${state.delaySec} s behind live${state.errors.length ? '. ' + state.errors.join(' ') : ''}`,
          state.errors.length ? 'err' : 'ok');
        $('toggle').textContent = state.hidden ? 'Show the box' : 'Hide the box';
      }
    } catch (e) { say(e.message, 'err'); }
    paintTiles();
  }

  const test = (kind) => R.cmd({ type: 'test', kind }).catch((e) => say(e.message, 'err'));
  $('testTd').addEventListener('click', () => test('td'));
  $('testFg').addEventListener('click', () => test('fg'));
  $('testBig').addEventListener('click', () => test('big'));
  $('toggle').addEventListener('click', async () => {
    try { const r = await R.cmd({ type: 'toggle' }); $('toggle').textContent = r.hidden ? 'Show the box' : 'Hide the box'; } catch (e) { say(e.message, 'err'); }
  });

  /* ---- multiview ---- */
  function paintLayout() {
    const wrap = $('mvLayout');
    const options = [['off', 'Off'], ...Object.entries(LAYOUTS).map(([k, v]) => [k, v.name])];
    wrap.replaceChildren(...options.map(([value, label]) => {
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'mvLayout', value, checked: mv().layout === value });
      input.addEventListener('change', async () => { await save({ mv: { ...mv(), layout: value } }); paintTiles(); });
      const l = document.createElement('label');
      l.append(input, ' ' + label);
      return l;
    }));
  }

  function gameOptions(selected) {
    const games = state && state.games ? state.games : [];
    const order = { in: 0, pre: 1, post: 2 };
    const sorted = [...games].sort((a, b) => (order[a.state] ?? 3) - (order[b.state] ?? 3));
    const opt = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text, selected: value === selected });
    return [opt('', 'Not set'), ...sorted.map((g) => opt(g.id, `${g.name} · ${g.state === 'in' ? g.detail : g.state === 'pre' ? 'later' : 'final'}`))];
  }

  function paintTiles() {
    const m = mv();
    const layout = LAYOUTS[m.layout];
    const map = $('mvMap');
    map.replaceChildren();
    $('mvTiles').replaceChildren();
    $('mvAutoRow').hidden = !layout;
    if (!layout) return;
    layout.rects(100, 100).forEach((r, i) => {
      const b = document.createElement('b');
      b.textContent = String(i + 1);
      b.className = m.tiles[i] ? 'set' : '';
      b.style.cssText = `left:${r.left}%;top:${r.top}%;width:${r.width}%;height:${r.height}%`;
      map.appendChild(b);
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `Game in tile ${i + 1}`);
      sel.append(...gameOptions(m.tiles[i] || ''));
      sel.addEventListener('change', async () => {
        const tiles = [...m.tiles]; tiles[i] = sel.value;
        await save({ mv: { ...mv(), tiles } });
        paintTiles();
      });
      const label = document.createElement('label');
      label.className = 'f';
      label.append(Object.assign(document.createElement('span'), { textContent: `Tile ${i + 1}` }), sel);
      $('mvTiles').appendChild(label);
    });
  }

  $('mvAuto').addEventListener('click', async () => {
    const m = mv();
    const count = LAYOUTS[m.layout] ? LAYOUTS[m.layout].rects(1, 1).length : 0;
    const live = new Set((state && state.games ? state.games : []).filter((g) => g.state === 'in').map((g) => g.id));
    const mine = (state && state.myGames ? state.myGames : []).filter((id) => live.has(id));
    if (!mine.length) { say('None of your players are in a live game right now.', 'err'); return; }
    await save({ mv: { ...m, tiles: Array.from({ length: count }, (_, i) => mine[i] || m.tiles[i] || '') } });
    paintTiles();
  });

  paintLayout();
  await refresh();
  setInterval(refresh, 10000);
})();
