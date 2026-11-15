/* The box. A shadow-DOM layer over the video: the lineup card, moment cards, and (in multiview) one lane per tile so a
   touchdown shows on the game it happened in. The box is built once and patched in place, so a frame a second never
   reloads photos or restarts animations. API strings only ever go through textContent or esc(). The shadow root is closed. */
(function (root) {
  'use strict';
  const { CSS } = typeof require !== 'undefined' ? require('./overlay.css') : root.SL.css;
  const MV = typeof require !== 'undefined' ? require('./multiview') : root.SL.multiview;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const signed = (n) => (n < 0 ? '−' : '+') + f1(Math.abs(n));
  const short = (name) => { const p = String(name).split(' '); return p.length > 1 && p[1] !== 'D/ST' ? p[0][0] + '. ' + p.slice(1).join(' ') : name; };
  const STATES = new Set(['pre', 'in', 'post', 'bye']);
  const ROTATE_MS = 12000, MAX_QUEUE = 4, ENTER_MS = 420, EXIT_MS = 280, VALUE_DELAY_MS = 260, AWAKE_MS = 10000;
  const EASE = 'cubic-bezier(.22,1,.36,1)';
  // The tint behind each headshot: a main colour per team, rough hex values of my own. Orange teams are shifted away from
  // the box's own orange, so orange keeps meaning "points" and nothing else.
  const TEAM_COLORS = { ARI: '#97233f', ATL: '#a71930', BAL: '#5c3b9e', BUF: '#2a62b8', CAR: '#0085ca', CHI: '#2b4a7a', CIN: '#4a4f5c', CLE: '#6b4a2f', DAL: '#6f8fc4', DEN: '#1f4f8f',
    DET: '#2f8fd8', GB: '#2f7d57', HOU: '#c8102e', IND: '#2f6fd0', JAX: '#1a8f9a', KC: '#e31837', LV: '#b0b7bc', LAC: '#2a9de0', LAR: '#3a6fd8', MIA: '#1fb5b0', MIN: '#6b3fa0',
    NE: '#d03a4a', NO: '#c9a35a', NYG: '#3a64c7', NYJ: '#1f8a5c', PHI: '#1f8a6c', PIT: '#f2b600', SF: '#c8202f', SEA: '#69be28', TB: '#d50a0a', TEN: '#4b92db', WSH: '#9b2f45' };
  const teamColor = (t) => TEAM_COLORS[t] || 'transparent';
  // A touchdown of mine takes the screen (or its multiview tile) for this long; the card comes in as it leaves.
  const PARTY_MS = 3000, PARTY_OUT_MS = 420, CONFETTI = 56, ACCENT = '#ff6a1f', INK = '#0e1016', TEXT = '#f4f5f8';
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const onColor = (bg) => (contrast(bg, TEXT) >= contrast(bg, INK) ? TEXT : INK);   // the giant word is ink on light team colours
  const SCALE = { web: { S: 0.85, M: 1, L: 1.25 }, tv: { S: 1.3, M: 1.55, L: 1.8 } };   // the TV is read from across the room

  /** Odometer (transitions.dev "spinning counter"): each changed digit rolls up from the digit it was. */
  function setReel(doc, node, text, animate) {
    if (node.dataset.v === text) return;
    const prev = node.dataset.v || '';
    node.dataset.v = text;
    node.setAttribute('aria-label', text);
    node.textContent = '';
    let col = 0;
    [...text].forEach((ch, i) => {
      if (!/\d/.test(ch)) { const s = doc.createElement('span'); s.className = 'rs'; s.textContent = ch; node.appendChild(s); return; }
      const cell = doc.createElement('span'); cell.className = 'rc';
      const strip = doc.createElement('span'); strip.className = 'rstrip';
      for (let k = 0; k < 20; k++) { const d = doc.createElement('span'); d.textContent = String(k % 10); strip.appendChild(d); }
      cell.appendChild(strip); node.appendChild(cell);
      const was = prev[prev.length - (text.length - i)];            // digits line up from the right
      const to = +ch;
      if (!animate || !prev || was === ch) { strip.style.transform = `translateY(${-to}em)`; return; }
      const from = /\d/.test(was || '') ? +was : 0;
      strip.style.transform = `translateY(${-from}em)`;
      void strip.offsetHeight;                                        // commit the start before the transition
      strip.style.transition = `transform var(--reel-dur) var(--reel-ease) ${col++ * 60}ms`;
      strip.style.transform = `translateY(${-(to <= from ? to + 10 : to)}em)`;   // always roll upward
    });
  }

  /** Headshot (or the team logo for a defense) in a circle; initials show until the image is there, and stay if it never comes.
      `load` is the host's image fetcher (the extension hands images over as data URLs, since a streaming site's CSP may block ESPN's host). */
  function setAvatar(doc, av, pos, src, load) {
    if (av.dataset.src === src && av.dataset.pos === pos) return;
    av.dataset.src = src; av.dataset.pos = pos;
    av.textContent = pos || '';
    av.classList.remove('has');
    av.classList.toggle('logo', !!src && (pos === 'DEF' || /\/teamlogos\//.test(src)));   // a logo sits on a light tile so dark logos still read; no picture, dark initials
    if (!src) return;
    const img = doc.createElement('img');
    img.alt = ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.addEventListener('load', () => av.classList.add('has'), { once: true });
    av.appendChild(img);
    if (!load) { img.src = src; return; }
    load(src).then((u) => { if (u && av.dataset.src === src) img.src = u; else img.remove(); }, () => img.remove());
  }

  function createOverlay({ doc, win, getConfig, tv, loadImage }) {
    const host = doc.createElement('div');
    host.id = 'sideline-box-host';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    // Closed: a script on the streaming site can't read your leagues out of it. The demo page sets the flag to look inside;
    // the extension's isolated world is a separate global, so a site cannot set it.
    const shadow = host.attachShadow({ mode: win.__sidelineOpenShadow ? 'open' : 'closed' });
    shadow.innerHTML = `<style>${CSS}</style><div id="stage"><div id="tiles"></div>` +
      '<div id="box" role="group" aria-label="Fantasy lineup">' +
      '<div class="tabs" role="tablist" hidden><span class="pill"></span></div>' +
      '<div class="score"><div class="tm me"><span class="nm"></span><span class="reel big"></span></div>' +
      '<div class="tm op"><span class="nm"></span><span class="reel big"></span></div></div>' +
      '<div class="wp" hidden><span class="pct"></span><div class="track"><i></i></div></div>' +
      '<ul class="rows"></ul><div class="strip" hidden></div><div class="ft"></div></div>' +
      '<div id="toasts" role="status" aria-live="polite"></div></div>';
    const $ = (sel) => shadow.querySelector(sel);
    const stage = $('#stage'), box = $('#box'), tabs = $('.tabs'), pill = $('.tabs .pill');
    const meSide = $('.tm.me'), meNm = $('.tm.me .nm'), meReel = $('.tm.me .reel'), opSide = $('.tm.op'), opNm = $('.tm.op .nm'), opReel = $('.tm.op .reel');
    const wp = $('.wp'), wpBar = $('.wp .track i'), wpPct = $('.wp .pct'), rowsEl = $('.rows'), strip = $('.strip'), ft = $('.ft');
    const ui = { frame: null, test: null, i: 0, pinned: false, tiles: [], status: { ok: true }, hidden: false, leagueId: null };
    const rowEls = new Map(), chipEls = new Map(), lanes = new Map(), timers = [], lastPts = new Map(), totals = new Map();
    // The box rests see-through so it doesn't hide the game, and goes solid for a while when something happens.
    function wake(ms) {
      box.classList.add('awake');
      if (ui.sleep) win.clearTimeout(ui.sleep);
      ui.sleep = later(() => box.classList.remove('awake'), ms);
    }
    const later = (fn, ms) => { const id = win.setTimeout(fn, ms); timers.push(id); return id; };
    const cfg = () => getConfig();
    const frameNow = () => ui.test || ui.frame;
    const multi = () => ui.tiles.length >= 2;
    // The TV's WebView ignores the viewport tag, so a 1080p TV can lay out at 960 CSS px: size everything from the real width.
    const k = () => (tv ? win.innerWidth / 1920 : 1);
    const scale = () => (SCALE[tv ? 'tv' : 'web'][cfg().size || 'M'] || 1) * k();
    if (tv) stage.classList.add('tv');

    /* ---- placement ---- */
    function weighted() {                    // a tile showing my game costs four times as much to cover
      const f = ui.frame;
      const mine = new Set(f ? f.leagues.flatMap((L) => L.me.rows.map((r) => r.team)) : []);
      const mineGames = new Set(f ? f.games.filter((g) => g.teams.some((t) => mine.has(t.abbr))).map((g) => g.id) : []);
      return ui.tiles.map((t) => ({ ...t, weight: t.gameId && mineGames.has(t.gameId) ? 4 : 1 }));
    }
    function place() {
      const c = cfg();
      const r = box.getBoundingClientRect();
      const corner = multi() ? MV.bestCorner(c.mvCorner || 'auto', { w: r.width, h: r.height }, weighted(), win.innerWidth, win.innerHeight, tv ? 96 * k() : 20) : c.corner;
      // The tallest moment (a big play) is about 250 px at size 1: if box + moment don't fit the screen, put the moment beside the box.
      const side = !multi() && r.height + 250 * scale() + 2 * (tv ? 54 * k() : 20) + 10 > win.innerHeight;
      const cls = `c-${corner}${multi() ? ' multi' : ''}${tv ? ' tv' : ''}${side ? ' side' : ''}`;
      if (stage.className !== cls) stage.className = cls;
      stage.style.setProperty('--z', String(scale()));
      if (tv) { stage.style.setProperty('--mx', 96 * k() + 'px'); stage.style.setProperty('--my', 54 * k() + 'px'); }   // overscan-safe margins
      stage.style.setProperty('--bh', box.classList.contains('is-in') ? Math.round(r.height) + 'px' : '0px');
    }

    /* ---- the lineup box, patched in place ---- */
    function patchTabs(frame, L) {
      const many = frame.leagues.length > 1;
      tabs.hidden = !many;
      if (!many) return;
      const labels = frame.leagues.map((x) => x.label).join('|');
      if (tabs.dataset.labels !== labels) {
        tabs.dataset.labels = labels;
        tabs.querySelectorAll('button').forEach((b) => b.remove());
        frame.leagues.forEach((x, n) => {
          const b = doc.createElement('button');
          b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.i = String(n); b.textContent = x.label;
          tabs.appendChild(b);
        });
        pill.style.transition = 'none';                            // first position lands without sliding in from 0
      }
      const btns = [...tabs.querySelectorAll('button')];
      btns.forEach((b, n) => b.setAttribute('aria-selected', String(frame.leagues[n] === L)));
      const on = btns[frame.leagues.indexOf(L)];
      if (on) { pill.style.width = on.offsetWidth + 'px'; pill.style.transform = `translateX(${on.offsetLeft}px)`; }   // tabs are equal width, so the pill only travels
      void pill.offsetWidth; pill.style.transition = '';
    }

    /** "QB GB · Q3 4:12". A game's clock is printed once, on its first row: five rows of the same clock is noise. */
    function subOf(r, seen) {
      let when = r.state === 'in' ? r.detail : r.state === 'post' ? 'Final' : r.state === 'pre' ? r.detail : 'Bye';
      const id = (r.gameId || r.team) + '|' + when;
      if (seen.has(id)) when = ''; else seen.add(id);
      return [[r.pos, r.team].filter(Boolean).join(' '), when].filter(Boolean).join(' · ');
    }

    function patchRows(L, rows, c) {
      const keep = new Set(), seen = new Set();
      rows.forEach((r, idx) => {
        const key = L.id + '|' + r.key;
        keep.add(key);
        let li = rowEls.get(key);
        if (!li) {
          li = doc.createElement('li');
          li.innerHTML = '<span class="av"></span><span class="who"><span class="nm"></span><span class="sub"></span></span><span class="reel pt"></span>';
          rowEls.set(key, li);
        }
        if (rowsEl.children[idx] !== li) rowsEl.insertBefore(li, rowsEl.children[idx] || null);
        li.className = 'r ' + (STATES.has(r.state) ? r.state : 'bye');
        li.dataset.key = r.key;
        li.querySelector('.nm').textContent = short(r.name);
        li.querySelector('.sub').textContent = subOf(r, seen);
        setReel(doc, li.querySelector('.pt'), f1(r.pts), true);
        const av = li.querySelector('.av');
        setAvatar(doc, av, r.pos, c.photos ? r.photo : '', loadImage);
        av.style.setProperty('--tc', teamColor(r.team));
        const before = lastPts.get(key);
        lastPts.set(key, r.pts);
        if (before !== undefined && before !== r.pts) showDelta(li, r.pts - before);
      });
      for (const [k, li] of rowEls) if (!keep.has(k)) { li.remove(); rowEls.delete(k); }
    }

    /** A small +6.4 beside the number for a few seconds: what just changed, next to where it changed. */
    function showDelta(li, d) {
      const old = li.querySelector('.dl');
      if (old) old.remove();
      const el = doc.createElement('span');
      el.className = 'dl' + (d < 0 ? ' neg' : '');
      el.textContent = signed(Math.round(d * 10) / 10);
      li.insertBefore(el, li.querySelector('.pt'));
      later(() => el.remove(), 3400);
    }

    /** Multiview's compact lineup: a headshot and the points per player, patched in place so photos never reload. */
    function patchStrip(L, rows, c) {
      const keep = new Set();
      rows.forEach((r, idx) => {
        const key = L.id + '|' + r.key;
        keep.add(key);
        let chip = chipEls.get(key);
        if (!chip) { chip = doc.createElement('span'); chip.innerHTML = '<span class="av"></span><b></b>'; chip.setAttribute('role', 'img'); chipEls.set(key, chip); }
        if (strip.children[idx] !== chip) strip.insertBefore(chip, strip.children[idx] || null);
        chip.className = 'chip ' + (STATES.has(r.state) ? r.state : 'bye');
        chip.dataset.key = r.key;
        chip.title = r.name;
        chip.setAttribute('aria-label', `${r.name} ${f1(r.pts)}`);
        chip.querySelector('b').textContent = f1(r.pts);
        const av = chip.querySelector('.av');
        setAvatar(doc, av, r.pos, c.photos ? r.photo : '', loadImage);
        av.style.setProperty('--tc', teamColor(r.team));
      });
      for (const [k, el] of chipEls) if (!keep.has(k)) { el.remove(); chipEls.delete(k); }
    }

    function patchFoot(frame) {
      ft.textContent = '';
      const pill1 = (text, bad, title) => { const p = doc.createElement('span'); p.className = 'pill-s' + (bad ? ' bad' : ''); p.textContent = text; if (title) p.title = title; ft.appendChild(p); };
      if (frame && frame.syncing && !ui.test) pill1('Syncing to your stream');
      if (ui.status.setup) pill1(tv ? 'Open Sideline on the TV to add your league' : 'Click the Sideline icon to add your league');
      else if (ui.status.config) pill1("Can't load your leagues: open Sideline settings", true, ui.status.error);
      else if (!ui.status.ok) pill1('Scores offline · retrying', true, ui.status.error);
      return ft.childElementCount > 0;
    }

    function render() {
      const c = cfg();
      const frame = frameNow();
      if (frame && ui.i >= frame.leagues.length) ui.i = 0;
      const L = frame && frame.leagues.length ? frame.leagues[ui.i] : null;
      const live = L ? L.me.rows.filter((r) => r.state === 'in') : [];
      const lineup = !!L && c.enabled && !ui.hidden && (c.view === 'all' || live.length > 0 || !!ui.test);
      const hasFoot = patchFoot(frame) && c.enabled && !ui.hidden;
      box.classList.toggle('is-in', lineup || hasFoot);
      $('.score').hidden = !lineup; rowsEl.hidden = !lineup || multi(); strip.hidden = !lineup || !multi();
      if (lineup) {
        const rows = c.view === 'all' || ui.test ? L.me.rows : live;
        patchTabs(frame, L);
        meNm.textContent = L.me.name;
        setReel(doc, meReel, f1(L.me.total), ui.leagueId === L.id);
        const before = totals.get(L.id);
        totals.set(L.id, L.me.total);
        if (before !== undefined && before !== L.me.total) wake(AWAKE_MS);   // your points moved
        opSide.hidden = !L.opp;
        meSide.classList.toggle('lead', !L.opp || L.me.total >= L.opp.total);
        opSide.classList.toggle('lead', !!L.opp && L.opp.total > L.me.total);
        if (L.opp) { opNm.textContent = L.opp.name; setReel(doc, opReel, f1(L.opp.total), ui.leagueId === L.id); }
        wp.hidden = L.winPct == null;
        if (L.winPct != null) {
          wpBar.style.setProperty('--p', String(Math.max(0, Math.min(100, L.winPct)) / 100));
          wpPct.textContent = L.winPct + '%';
          const s = doc.createElement('small'); s.textContent = 'to win'; wpPct.appendChild(s);
        }
        if (multi()) patchStrip(L, rows, c); else patchRows(L, rows, c);
        ui.leagueId = L.id;
      } else { tabs.hidden = true; wp.hidden = true; }              // no lineup: a win bar from the last one (or a test) must not stay up
      place();
    }

    box.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-i]');
      if (!b) return;
      ui.i = Number(b.dataset.i); ui.pinned = true; wake(AWAKE_MS);                // a tap keeps that league up
      render();
    });
    const rotate = win.setInterval(() => {
      const frame = frameNow();
      if (!ui.pinned && frame && frame.leagues.length > 1) { ui.i = (ui.i + 1) % frame.leagues.length; render(); }
    }, ROTATE_MS);

    /* ---- moments ---- */
    function buildCard(card, c) {
      const el = doc.createElement('div');
      el.className = 'mo ' + (['td', 'fg', 'big', 'bad', 'play'].includes(card.kind) ? card.kind : 'play') + (card.value.n < 0 ? ' neg' : '') + (card.side === 'opp' ? ' opp' : '');
      el.innerHTML = '<div class="head"><span class="word"></span><span class="vp"><span class="val reel"></span></span></div>' +
        '<div class="who"><span class="av"></span><span><b></b><em></em></span></div><div class="ch"></div>';
      const t = card.title;                                          // "TOUCHDOWN" from the engine is shown as "Touchdown"
      el.querySelector('.word').textContent = t ? (t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t) : card.line;
      el.querySelector('.who b').textContent = card.subject.name;
      const av = el.querySelector('.av');
      setAvatar(doc, av, card.subject.pos, c.photos ? card.subject.photo : '', loadImage);
      av.style.setProperty('--tc', teamColor(card.subject.team));
      const chips = el.querySelector('.ch');
      const labels = [card.game, ...(card.chips || []).map((x) => x.label)].filter(Boolean);   // the game first: it may not be the one on screen
      for (const l of labels) { const i = doc.createElement('i'); i.textContent = l; chips.appendChild(i); }
      if (!chips.childElementCount) chips.remove();
      const val = el.querySelector('.val');
      setReel(doc, val, signed(card.value.n).replace(/\d/g, '0'), false);   // starts at +0.0 (same width), then rolls
      later(() => setReel(doc, val, signed(card.value.n), true), VALUE_DELAY_MS);   // the value rolls in once the bar is up
      // When the card already shows the yards (big play, touchdown, field goal), the line under the name says who instead of repeating them.
      const yardsShown = addExtras(el, card);
      el.querySelector('.who em').textContent = card.title && !yardsShown ? card.line : `${card.subject.pos} ${card.subject.team}`;
      return el;
    }

    /** Moment-specific motion: a big play or touchdown runs the yard line, a field goal clears the uprights.
        Returns true when the card now shows the yards itself. */
    function addExtras(el, card) {
      const bar = el.querySelector('.head');
      const play = card.data && card.data.play;
      const yds = play && play.yds > 0 ? Math.round(play.yds) : 0;
      const rollTo = (node, text) => { setReel(doc, node, '0'.repeat(text.length), false); later(() => setReel(doc, node, text, true), 200); };
      if ((card.kind === 'big' || card.kind === 'td') && yds && card.subject.pos !== 'DEF') {
        const td = card.kind === 'td';                                // a touchdown's ball always reaches the end zone; a big play's travels its own yards of 60
        const to = td ? 100 : Math.min(100, Math.max(10, (yds / 60) * 100));
        bar.insertAdjacentHTML('afterend', '<div class="run' + (td ? ' td' : '') + '" style="--to:' + to + '%" data-to="' + to + '" aria-hidden="true"><div class="line"><i class="ticks"></i><i class="trail"></i><i class="end"></i><i class="dot"></i></div>' +
          '<div class="meta"><span class="reel yd"></span><small>yds</small><em class="dn"></em></div></div>');
        rollTo(el.querySelector('.run .yd'), String(yds));
        el.querySelector('.run .dn').textContent = play.down || '';
        return true;
      }
      if (card.kind === 'fg') {
        const m = /(\d{1,3})/.exec(card.line || '');                  // "Good from 52": the distance goes beside the posts, like the big play's yards
        bar.insertAdjacentHTML('afterend', '<div class="kick" aria-hidden="true"><div class="fld"><svg viewBox="0 0 120 44"><path class="up" pathLength="1" d="M44 4v22M76 4v22M44 26h32M60 26v14"/></svg>' +
          '<span class="bx"><span class="by"></span></span></div>' + (m ? '<div class="km"><span class="reel yd"></span><small>yds</small></div>' : '') + '</div>');
        if (m) rollTo(el.querySelector('.kick .yd'), m[1]);
        return !!m;
      }
      return false;
    }

    /** The ball travels in pixels, so measure the yard line once the card is in the page (the dot then moves by transform alone). */
    function measureRun(el) {
      const run = el.querySelector('.run');
      if (!run) return;
      const line = run.querySelector('.line');
      run.style.setProperty('--span', (line.offsetWidth * Number(run.dataset.to) / 100) + 'px');
    }

    /** The card grows out of the player's own row (or chip) when it is on screen: motion that comes from somewhere. */
    function origin(card) {
      const k = card.subject && card.subject.key;
      if (!k) return null;
      const n = shadow.querySelector(multi() ? `.chip[data-key="${CSS_ESC(k)}"]` : `.r[data-key="${CSS_ESC(k)}"]`);
      return n && box.classList.contains('is-in') ? n : null;
    }
    const CSS_ESC = (s) => String(s).replace(/["\\]/g, '\\$&');
    const reduced = () => win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /** The card grows out of its row: the box moves and scales over 420 ms while opacity comes up in 160, so no squashed text is ever visible. */
    function flip(el, from) {
      if (!el.animate || reduced()) return null;
      const a = from.getBoundingClientRect(), b = el.getBoundingClientRect();
      if (!a.width || !b.width) return null;
      const there = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'linear', fill: 'both' });
      return el.animate([{ transform: there }, { transform: 'none' }], { duration: ENTER_MS, easing: EASE, fill: 'both' });
    }
    function rise(el, enter) {
      if (!el.animate) return null;
      if (reduced()) return el.animate([{ opacity: enter ? 0 : 1 }, { opacity: enter ? 1 : 0 }], { duration: 150, fill: 'both' });   // reduced motion: a short fade, no travel
      const off = [{ transform: 'translateY(16px)', opacity: 0 }];
      return el.animate(enter ? [...off, { transform: 'none', opacity: 1 }] : [{ transform: 'none', opacity: 1 }, { transform: 'translateY(8px)', opacity: 0 }],
        { duration: enter ? ENTER_MS : EXIT_MS, easing: EASE, fill: 'both' });
    }

    /* ---- touchdown takeover: the screen (or the game's tile) goes dark, a team-colour band sweeps across, TOUCHDOWN stamps
       down on it with a jolt and two echoes, the player and the points rise in, confetti bursts from the word. ---- */
    const isParty = (card) => card.kind === 'td' && card.side !== 'opp' && (cfg().moments || {}).full !== false;
    function celebrate(card, key) {
      const t = key !== 'g' && ui.tiles.find((x) => String(x.index) === key);
      const r = t ? t.rect : { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight };
      const tc = TEAM_COLORS[card.subject.team] || ACCENT;
      const el = doc.createElement('div');
      el.className = 'party';
      el.setAttribute('aria-hidden', 'true');                       // the card that follows carries the same news for screen readers
      el.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;--q:${r.width / 1920}px;--fw:${r.width}px;` +
        `--tc:${tc};--tk:${onColor(tc)};--b2:${tc === ACCENT ? TEXT : ACCENT}`;
      el.innerHTML = '<i class="veil"></i><i class="flash"></i><div class="zoom"><div class="body">' +
        '<div class="word"><i class="b1"></i><i class="b2"></i><span class="echo">Touchdown</span><span class="echo">Touchdown</span><span class="w">Touchdown</span></div>' +
        '<div class="who"><span class="av"></span><span class="nm"><b></b><em></em></span><span class="vp"><span class="val reel"></span></span></div>' +
        '</div></div><div class="conf"></div>';
      el.querySelector('.nm b').textContent = card.subject.name;
      el.querySelector('.nm em').textContent = [card.line, card.game || `${card.subject.pos} ${card.subject.team}`].filter(Boolean).join(' · ');
      const av = el.querySelector('.av');
      setAvatar(doc, av, card.subject.pos, cfg().photos ? card.subject.photo : '', loadImage);
      av.style.setProperty('--tc', teamColor(card.subject.team));
      const val = el.querySelector('.val');
      setReel(doc, val, signed(card.value.n).replace(/\d/g, '0'), false);
      later(() => setReel(doc, val, signed(card.value.n), true), 760);
      if (!reduced()) confetti(el.querySelector('.conf'), card, r, tc);
      stage.appendChild(el);
      later(() => el.classList.add('out'), PARTY_MS);
      later(() => el.remove(), PARTY_MS + PARTY_OUT_MS);
      return PARTY_MS;
    }
    /** Pieces burst up and out of the word, then fall. Seeded from the card id, so a replay of the same touchdown looks the same. */
    function confetti(wrap, card, r, tc) {
      let s = [...String(card.id || card.subject.name)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
      const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
      const colors = [tc, ACCENT, TEXT];
      for (let i = 0; i < CONFETTI; i++) {
        const p = doc.createElement('i');
        const a = (rnd() - 0.5) * Math.PI * 0.9;                     // mostly upward, fanned out
        const reach = 0.25 + rnd() * 0.45;
        p.style.cssText = `--c:${colors[i % 3]};--dx:${Math.sin(a) * reach * r.width}px;--dy:${-Math.cos(a) * reach * r.height * 0.8}px;` +
          `--fall:${(0.7 + rnd() * 0.5) * r.height}px;--r1:${(rnd() - 0.5) * 720}deg;--r2:${(rnd() - 0.5) * 1800}deg;` +
          `--dur:${1900 + rnd() * 900}ms;--d:${380 + rnd() * 160}ms;--pw:${12 + rnd() * 10};--ph:${18 + rnd() * 18}`;
        wrap.appendChild(p);
      }
    }

    function play(ln, card) {
      ln.busy = true;
      const party = isParty(card) ? celebrate(card, ln.key) : 0;
      wake(party + (card.ttl_ms || 3600) + AWAKE_MS);
      if (party) later(() => show(ln, card), party);
      else show(ln, card);
    }

    function show(ln, card) {
      const el = buildCard(card, cfg());
      ln.el.appendChild(el);
      measureRun(el);
      const from = ln.key === 'g' ? origin(card) : null;
      if (!(from && flip(el, from))) rise(el, true);
      later(() => {
        const anim = rise(el, false);                               // out is a plain fade and drop: scaling the card back would squash its text
        const done = () => { el.remove(); ln.busy = false; const next = ln.queue.shift(); if (next) play(ln, next); };
        if (anim) anim.onfinish = done; else done();
      }, card.ttl_ms || 3600);
    }

    function laneFor(key) {
      if (lanes.has(key)) return lanes.get(key);
      const el = key === 'g' ? $('#toasts') : shadow.querySelector(`.tile[data-i="${key}"] .lane`);
      const ln = { key, el, queue: [], busy: false };
      lanes.set(key, ln);
      return ln;
    }

    /** Show a moment. `tile` is the multiview tile it belongs to, or null for the main lane. */
    function card(c, tile) {
      if (!cfg().enabled || ui.hidden) return;
      const key = tile != null && multi() && shadow.querySelector(`.tile[data-i="${tile}"]`) ? String(tile) : 'g';
      const ln = laneFor(key);
      if (!ln.busy) return play(ln, c);
      if (c.kind === 'td') ln.queue.unshift(c); else ln.queue.push(c);   // touchdowns jump the line
      ln.queue.length = Math.min(ln.queue.length, MAX_QUEUE);
    }

    /* ---- tiles ---- */
    let layoutSig = '';
    function setTiles(tiles) {
      ui.tiles = tiles;
      const sig = tiles.map((t) => [t.index, t.rect.left, t.rect.top, t.rect.width, t.rect.height].join(',')).join('|');
      if (sig === layoutSig) return render();                     // same layout, new labels: keep lanes and moments in flight
      layoutSig = sig;
      const wrap = $('#tiles');
      wrap.textContent = '';
      lanes.forEach((ln, key) => { if (key !== 'g') lanes.delete(key); });
      if (tiles.length >= 2) {
        for (const t of tiles) {
          const el = doc.createElement('div');
          el.className = 'tile';
          el.dataset.i = String(t.index);
          el.style.cssText = `left:${t.rect.left}px;top:${t.rect.top}px;width:${t.rect.width}px;height:${t.rect.height}px`;
          el.innerHTML = '<div class="lane"></div>';
          // A tile on the screen's edge: on a TV the lane keeps out of the overscan area, like the box does.
          const lane = el.firstChild, inset = 14 * scale();
          lane.style.setProperty('--ll', (tv && t.rect.left <= 1 ? 96 * k() : inset) + 'px');
          lane.style.setProperty('--lr', (tv && t.rect.left + t.rect.width >= win.innerWidth - 1 ? 96 * k() : inset) + 'px');
          lane.style.setProperty('--lb', (tv && t.rect.top + t.rect.height >= win.innerHeight - 1 ? 54 * k() : inset) + 'px');
          wrap.appendChild(el);
        }
      }
      render();
    }

    /* ---- host placement: inside the fullscreen element, or nothing is visible when the player goes fullscreen ---- */
    function mount() {
      const fs = doc.fullscreenElement;
      const target = fs && fs.tagName !== 'VIDEO' ? fs : doc.documentElement;
      if (host.parentNode !== target) target.appendChild(host);
    }
    doc.addEventListener('fullscreenchange', mount);
    mount();
    // The box also changes height with no render (the font arriving, a photo loading): moments sit on top of it, so re-measure.
    const sizer = win.ResizeObserver ? new win.ResizeObserver(() => place()) : null;
    if (sizer) sizer.observe(box);
    if (tv) win.addEventListener('resize', () => { place(); render(); });

    return {
      update(frame) { ui.frame = frame; render(); },
      card,
      setTiles,
      setStatus(s) { ui.status = s; render(); },
      refresh: render,
      setHidden(h) { ui.hidden = h; render(); },
      isHidden: () => ui.hidden,
      /** Play a sample moment over a sample lineup, then put the real one back. */
      test(frame, c) {
        ui.test = frame; render();
        later(() => card(c, null), 60);                            // let the sample rows land first, so the card grows from one
        later(() => { ui.test = null; render(); }, (isParty(c) ? PARTY_MS : 0) + (c.ttl_ms || 3600) + ENTER_MS + EXIT_MS + 600);
      },
      destroy() { if (sizer) sizer.disconnect(); win.clearInterval(rotate); timers.forEach((t) => win.clearTimeout(t)); doc.removeEventListener('fullscreenchange', mount); host.remove(); },
      host,
    };
  }

  const api = { createOverlay, esc, setReel };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).overlay = api;
})(typeof self !== 'undefined' ? self : globalThis);
