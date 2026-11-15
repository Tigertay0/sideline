/* Settings shared by the content script, popup and options page. Stored in chrome.storage.sync so they follow the
   viewer to other Chrome profiles. Stream delays are estimates: every app drifts, which is what the nudge is for. */
(function (root) {
  'use strict';

  const PRESETS = {
    cable: ['Cable or antenna', 7], youtubetv: ['YouTube TV', 45], sundayticket: ['NFL Sunday Ticket', 45], hulu: ['Hulu + Live TV', 45],
    fubo: ['Fubo', 55], sling: ['Sling', 40], directv: ['DirecTV Stream', 35], prime: ['Prime Video', 30], peacock: ['Peacock', 35],
    nflplus: ['NFL+', 40], espn: ['ESPN', 40], paramount: ['Paramount+', 40], netflix: ['Netflix', 30],
  };

  const DEFAULTS = {
    enabled: true, sleeperUser: '', espnLeagues: [], stream: 'youtubetv', nudge: 0,
    corner: 'bl', mvCorner: 'auto', size: 'M', view: 'live', photos: true,
    moments: { td: true, fg: true, big: true, bad: true, play: false, opp: true, full: true },
    mv: { layout: 'off', tiles: [] },                        // TV only: YouTube TV multiview layout and the game in each tile
  };

  const delaySecOf = (c) => Math.max(0, (PRESETS[c.stream] || PRESETS.youtubetv)[1] + (Number(c.nudge) || 0));

  const merge = (stored) => ({ ...DEFAULTS, ...stored, moments: { ...DEFAULTS.moments, ...((stored && stored.moments) || {}) } });
  async function load() { return merge(await chrome.storage.sync.get(null)); }
  const save = (patch) => chrome.storage.sync.set(patch);

  const api = { PRESETS, DEFAULTS, delaySecOf, merge, load, save };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).settings = api;
})(typeof self !== 'undefined' ? self : globalThis);
