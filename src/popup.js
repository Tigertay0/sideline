/* Toolbar popup: hide/show, test moments, delay nudge, and (in multiview) which game each tile is showing. */
(async function () {
  'use strict';
  const SL = self.SL;
  const app = document.getElementById('app');
  const sub = document.getElementById('sub');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let cfg = await SL.settings.load();

  const el = (tag, attrs, ...kids) => {
    const n = Object.assign(document.createElement(tag), attrs || {});
    n.append(...kids.filter((k) => k !== null && k !== undefined));
    return n;
  };
  // A tab with no Sideline on it has no receiver; that is the "not running here" answer, not an error to surface.
  const ask = (msg) => new Promise((resolve) => chrome.tabs.sendMessage(tab.id, msg, (r) => { void chrome.runtime.lastError; resolve(r); }));
  const btn = (text, onclick, cls) => el('button', { textContent: text, onclick, className: cls || '' });

  async function nudge(delta) {
    cfg = { ...cfg, nudge: delta === 0 ? 0 : cfg.nudge + delta };
    await SL.settings.save({ nudge: cfg.nudge });
    paint(await ask({ type: 'state' }));
  }

  function delayRow() {
    const [name] = SL.settings.PRESETS[cfg.stream] || SL.settings.PRESETS.youtubetv;
    return el('div', { className: 'delay' },
      el('div', {}, el('div', { className: 'big', textContent: SL.settings.delaySecOf(cfg) + ' s' }), el('div', { className: 'mute', textContent: `${name} behind live` })),
      el('div', {}, btn('−5', () => nudge(-5)), ' ', btn('+5', () => nudge(5)), ' ', btn('Reset', () => nudge(0))));
  }

  function tilesPanel(state) {
    if (!state.tiles || state.tiles.length < 2) return null;
    const live = state.games.filter((g) => g.state === 'in');
    return el('section', { className: 'card' }, el('h2', { textContent: `Multiview · ${state.tiles.length} tiles` }),
      ...state.tiles.map((t) => {
        const sel = el('select', { onchange: () => ask({ type: 'assign', index: t.index, gameId: sel.value }) },
          el('option', { value: '', textContent: t.network ? `Auto (${t.network})` : 'Auto' }),
          el('option', { value: 'none', textContent: 'No game' }),
          ...live.map((g) => el('option', { value: g.id, textContent: g.name })));
        sel.value = t.manual ? (t.gameId || 'none') : '';
        return el('label', { className: 'f' }, el('span', { textContent: `Tile ${t.index + 1}${t.gameId ? ' · matched' : ' · not matched'}` }), sel);
      }));
  }

  function paint(state) {
    app.replaceChildren();
    if (!state || !state.ok) {
      sub.textContent = 'not running here';
      app.append(el('p', { textContent: 'Sideline is not running on this tab. It starts by itself on YouTube TV, Hulu, Fubo, Sling, DirecTV, Peacock, Prime Video, NFL+ and ESPN.' }),
        btn('Show on this tab', async () => {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: chrome.runtime.getManifest().content_scripts[0].js });
          setTimeout(async () => paint(await ask({ type: 'state' })), 600);
        }, 'primary'), ' ', btn('Settings', () => chrome.runtime.openOptionsPage()));
      return;
    }
    sub.textContent = state.leagues ? `${state.leagues} league${state.leagues > 1 ? 's' : ''}` : 'no leagues yet';
    app.append(
      el('div', { className: 'grid' },
        btn('Test TD', () => ask({ type: 'test', kind: 'td' }), 'primary'), btn('Test FG', () => ask({ type: 'test', kind: 'fg' })), btn('Test big play', () => ask({ type: 'test', kind: 'big' }))),
      delayRow(),
      tilesPanel(state),
      state.errors.length ? el('p', { className: 'err', textContent: state.errors.join(' ') }) : null,
      el('div', { className: 'row' },
        btn(state.hidden ? 'Show the box' : 'Hide the box', async () => paint({ ...state, hidden: (await ask({ type: 'toggle' })).hidden })),
        btn('Settings', () => chrome.runtime.openOptionsPage())));
  }

  paint(await ask({ type: 'state' }));
})();
