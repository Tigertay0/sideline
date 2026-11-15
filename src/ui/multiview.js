/* Multiview support: find the video tiles on the page, work out which game each one is showing, and pick where the
   box can sit without covering a tile. YouTube TV multiview puts up to four streams in one page, so a single corner
   card would sit on top of somebody's game.

   Tile -> game: the channel name found in each tile's own DOM (CBS, FOX, ...) is matched to the network ESPN lists for each
   game. When that is not enough (CBS and FOX both have several games at once) the viewer assigns it in the popup. */
(function (root) {
  'use strict';

  const NETS = [['CBS', /\bcbs\b/i], ['FOX', /\bfox\b/i], ['NBC', /\bnbc\b/i], ['ABC', /\babc\b/i], ['ESPN', /\bespn2?\b/i],
    ['NFL Network', /nfl network|\bnfln\b/i], ['Prime Video', /prime video|amazon/i], ['Netflix', /netflix/i], ['YouTube', /sunday ticket|\byoutube\b/i]];

  function networkOf(text) {
    for (const [name, re] of NETS) if (re.test(text || '')) return name;
    return null;
  }

  /** Tiles + ESPN games -> tiles with a gameId. `assigned` maps tile index -> game id, or 'none'. Pure, so it is unit tested. */
  function resolveTiles(tiles, games, assigned, mineTeams) {
    return tiles.map((t) => {
      const manual = (assigned && assigned[t.index]) || t.assign;     // t.assign: the TV's tiles come pre-assigned from the phone
      if (manual) return { ...t, gameId: manual === 'none' ? null : manual, manual: true };
      let pick = null;
      if (t.network) {
        const live = games.filter((g) => g.state === 'in' && g.networks.some((n) => n.toLowerCase() === t.network.toLowerCase()));
        const mine = live.filter((g) => g.teams.some((x) => mineTeams.has(x.abbr)));
        pick = live.length === 1 ? live[0] : mine.length === 1 ? mine[0] : null;
      }
      return { ...t, gameId: pick ? pick.id : null, manual: false };
    });
  }

  const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

  /** Which corner covers the least video? `pref` other than 'auto' wins outright. A tile may carry a `weight`
      (default 1): covering the tile that shows your own game costs more than covering one that does not. */
  function bestCorner(pref, box, tiles, vw, vh, margin) {
    if (pref !== 'auto') return pref;
    const m = margin || 16;
    const at = { tl: [m, m], tr: [vw - box.w - m, m], bl: [m, vh - box.h - m], br: [vw - box.w - m, vh - box.h - m] };
    let best = 'bl', least = Infinity;
    for (const c of ['bl', 'br', 'tl', 'tr']) {
      const [x, y] = at[c];
      const cover = tiles.reduce((s, t) => s + (t.weight || 1) * area({ left: x, top: y, right: x + box.w, bottom: y + box.h },
        { left: t.rect.left, top: t.rect.top, right: t.rect.left + t.rect.width, bottom: t.rect.top + t.rect.height }), 0);
      if (cover < least) { least = cover; best = c; }
    }
    return best;
  }

  function textNear(el, others) {
    const parts = [el.getAttribute('aria-label') || '', el.getAttribute('title') || ''];
    if (el.tagName !== 'VIDEO') parts.push((el.innerText || '').slice(0, 300));      // a tile element carries its own label
    let node = el;
    for (let i = 0; i < 6 && node.parentElement; i++) {
      node = node.parentElement;
      if (others.some((o) => o !== el && node.contains(o))) break;       // this ancestor already holds another tile
      parts.push(node.getAttribute('aria-label') || '', node.getAttribute('title') || '', (node.innerText || '').slice(0, 300));
      node.querySelectorAll('img[alt]').forEach((img, n) => { if (n < 12) parts.push(img.alt); });
    }
    return parts.join(' ');
  }

  const LABEL_TTL = 10000;
  /** Reading a tile's label touches innerText up the tree, which is not cheap on a heavy page: do it once per tile per 10 s. */
  function labelOf(el, els, cache, now) {
    const hit = cache.get(el);
    if (hit && now - hit.at < LABEL_TTL) return hit.network;
    const network = networkOf(textNear(el, els));
    cache.set(el, { at: now, network });
    return network;
  }

  /** Visible video tiles in reading order (top-left to bottom-right). */
  function scan(doc, win, cache = new WeakMap()) {
    const vw = win.innerWidth, vh = win.innerHeight;
    const seen = [...doc.querySelectorAll('video')].map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ el, r }) => {
      if (r.width < 200 || r.height < 112) return false;
      const shown = area(r, { left: 0, top: 0, right: vw, bottom: vh });
      if (shown < r.width * r.height * 0.5) return false;
      const cs = win.getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    });
    const inside = (a, b) => a !== b && a.r.left >= b.r.left - 4 && a.r.top >= b.r.top - 4 && a.r.right <= b.r.right + 4 && a.r.bottom <= b.r.bottom + 4;
    const tiles = seen.filter((a) => !seen.some((b) => inside(a, b) && (b.r.width * b.r.height > a.r.width * a.r.height || seen.indexOf(b) < seen.indexOf(a))));
    tiles.sort((a, b) => Math.round(a.r.top / (vh / 4)) - Math.round(b.r.top / (vh / 4)) || a.r.left - b.r.left);
    const els = tiles.map((t) => t.el);
    const now = Date.now();
    return tiles.map((t, index) => ({
      index, rect: { left: t.r.left, top: t.r.top, width: t.r.width, height: t.r.height }, network: labelOf(t.el, els, cache, now),
    }));
  }

  /** Re-scans once a second and on resize or fullscreen; calls onChange only when the layout or labels actually changed. */
  function createTracker({ doc, win, onChange }) {
    let sig = '', tiles = [], timer = null;
    const cache = new WeakMap();
    const rescan = () => {
      const next = scan(doc, win, cache);
      const s = next.map((t) => [t.index, Math.round(t.rect.left), Math.round(t.rect.top), Math.round(t.rect.width), Math.round(t.rect.height), t.network].join(',')).join('|');
      if (s === sig) return;
      sig = s; tiles = next; onChange(tiles);
    };
    return {
      start() { rescan(); timer = win.setInterval(rescan, 1000); win.addEventListener('resize', rescan); doc.addEventListener('fullscreenchange', rescan); },
      stop() { win.clearInterval(timer); win.removeEventListener('resize', rescan); doc.removeEventListener('fullscreenchange', rescan); },
      rescan, tiles: () => tiles,
    };
  }

  const api = { networkOf, resolveTiles, bestCorner, scan, createTracker };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).multiview = api;
})(typeof self !== 'undefined' ? self : globalThis);
