/* One animation per scene, played by the real overlay code (src/ui/overlay.js) over a stand-in picture, looping.
   ?scene=td|big|fg|bad|play|roll|win|tabs|tile  &size=S|M|L  &corner=bl|br|tl|tr  &photos=0   Used by animations.html. */
(function () {
  'use strict';
  const SL = self.SL;
  const q = new URLSearchParams(location.search);
  const scene = q.get('scene') || 'td';
  const cfg = { enabled: true, corner: q.get('corner') || 'bl', mvCorner: 'auto', size: q.get('size') || 'M', view: 'all', photos: q.get('photos') !== '0' };
  const overlay = SL.overlay.createOverlay({ doc: document, win: window, getConfig: () => cfg });

  const base = () => { const f = JSON.parse(JSON.stringify(SL.sample.frame())); f.leagues[0].week = 10; return f; };
  const row = (f, key) => f.leagues[0].me.rows.find((r) => r.key === key);
  const bump = (f, key, d, win) => { row(f, key).pts = Math.round((row(f, key).pts + d) * 10) / 10; f.leagues[0].me.total = Math.round((f.leagues[0].me.total + d) * 10) / 10; f.leagues[0].winPct = win; return f; };
  const later = (fn, ms) => setTimeout(fn, ms);
  const moment = (kind, tile) => overlay.card(SL.sample.card(kind), tile == null ? null : tile);

  // The lineup keeps its running state between loops so each loop is a fresh change, never a reset.
  let cur = base();
  const SCENES = {
    td: { len: 11400, run() { overlay.update(cur); later(() => moment('td'), 600); } },
    big: { len: 6800, run() { overlay.update(cur); later(() => moment('big'), 600); } },
    fg: { len: 6400, run() { overlay.update(cur); later(() => moment('fg'), 600); } },
    bad: { len: 6200, run() { overlay.update(cur); later(() => moment('bad'), 600); } },
    opp: { len: 6800, run() { overlay.update(cur); later(() => moment('opp'), 600); } },
    play: { len: 5600, run() { overlay.update(cur); later(() => moment('play'), 600); } },
    roll: {
      len: 7200,
      run() {
        overlay.update(cur);
        later(() => { cur = bump(JSON.parse(JSON.stringify(cur)), 'b', 6.4, Math.min(95, cur.leagues[0].winPct + 14)); overlay.update(cur); }, 900);
        later(() => { cur = bump(JSON.parse(JSON.stringify(cur)), 'c', 4.8, Math.min(97, cur.leagues[0].winPct + 9)); overlay.update(cur); }, 3400);
      },
    },
    win: {
      len: 6400,
      run() {
        cur.leagues[0].winPct = 38; overlay.update(cur);
        later(() => { cur = JSON.parse(JSON.stringify(cur)); cur.leagues[0].winPct = 74; overlay.update(cur); }, 900);
        later(() => { cur = JSON.parse(JSON.stringify(cur)); cur.leagues[0].winPct = 52; overlay.update(cur); }, 3600);
      },
    },
    tabs: {
      len: 6400,
      run() {
        const f = JSON.parse(JSON.stringify(cur));
        const second = JSON.parse(JSON.stringify(f.leagues[0]));
        f.leagues[0].label = 'ABL'; second.id = 'sample:2'; second.label = "DAN'S"; second.name = "Dan's league"; second.me.name = 'SUNDAY SCARIES'; second.opp.name = 'GHOST ROSTER'; second.me.total = 121; second.opp.total = 93.5; second.winPct = 82;
        f.leagues.push(second);
        overlay.update(f);
        const tab = (n) => () => { const b = overlay.host.shadowRoot.querySelectorAll('.tabs button')[n]; if (b) b.click(); };
        later(tab(1), 1500); later(tab(0), 3900);
      },
    },
    tile: {
      len: 10600,
      run() {
        const w = innerWidth, h = innerHeight, pic = document.getElementById('pic');
        const rects = [{ left: 0, top: h * 0.2, width: w / 2, height: h * 0.6 }, { left: w / 2, top: h * 0.2, width: w / 2, height: h * 0.6 }];
        pic.innerHTML = '';
        ['FOX · WSH @ NYG', 'CBS · KC @ ATL'].forEach((t, i) => { const d = document.createElement('div'); d.className = 'tile'; d.textContent = t; Object.assign(d.style, { left: rects[i].left + 'px', top: rects[i].top + 'px', width: rects[i].width + 'px', height: rects[i].height + 'px' }); pic.appendChild(d); });
        const f = JSON.parse(JSON.stringify(cur)); f.games = [];
        overlay.update(f);
        overlay.setTiles(rects.map((rect, index) => ({ index, rect, network: null, gameId: 'G' + (index + 1) })));
        later(() => moment('td', 0), 700);
        later(() => moment('big', 1), 3300);
      },
    },
  };

  const s = SCENES[scene] || SCENES.td;
  s.run();
  if (!q.has('once')) setInterval(s.run, s.len);
  window.__scene = { name: scene, len: s.len };
})();
