/* YouTube TV multiview layouts on a TV, as rectangles of the screen. Shared by the TV overlay (where moments land) and the
   phone remote (the little map you pick games on). YouTube TV builds the grid itself; pick the one that matches. */
(function (root) {
  'use strict';
  const LAYOUTS = {
    two: { name: '2 side by side', rects: (W, H) => [{ left: 0, top: H / 4, width: W / 2, height: H / 2 }, { left: W / 2, top: H / 4, width: W / 2, height: H / 2 }] },
    three: { name: '1 big + 2', rects: (W, H) => [{ left: 0, top: H / 6, width: (2 * W) / 3, height: (2 * H) / 3 },
      { left: (2 * W) / 3, top: H / 6, width: W / 3, height: H / 3 }, { left: (2 * W) / 3, top: H / 2, width: W / 3, height: H / 3 }] },
    four: { name: '2 x 2', rects: (W, H) => [{ left: 0, top: 0, width: W / 2, height: H / 2 }, { left: W / 2, top: 0, width: W / 2, height: H / 2 },
      { left: 0, top: H / 2, width: W / 2, height: H / 2 }, { left: W / 2, top: H / 2, width: W / 2, height: H / 2 }] },
  };
  const api = { LAYOUTS };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).layouts = api;
})(typeof self !== 'undefined' ? self : globalThis);
