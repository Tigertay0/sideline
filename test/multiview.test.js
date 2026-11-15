'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MV = require('../src/ui/multiview');
const { esc } = require('../src/ui/overlay.js');

const tile = (index, left, top, network) => ({ index, network, rect: { left, top, width: 600, height: 340 } });
const games = [
  { id: 'A', state: 'in', networks: ['CBS'], teams: [{ abbr: 'KC' }, { abbr: 'ATL' }] },
  { id: 'B', state: 'in', networks: ['Fox'], teams: [{ abbr: 'WSH' }, { abbr: 'NYG' }] },
  { id: 'C', state: 'in', networks: ['CBS'], teams: [{ abbr: 'MIA' }, { abbr: 'IND' }] },
  { id: 'D', state: 'pre', networks: ['NBC'], teams: [{ abbr: 'SF' }, { abbr: 'DAL' }] },
];

test('networkOf reads channel names out of tile text', () => {
  assert.equal(MV.networkOf('FOX Sports · LIVE'), 'FOX');
  assert.equal(MV.networkOf('Watching on ESPN2'), 'ESPN');
  assert.equal(MV.networkOf('NFL Network'), 'NFL Network');
  assert.equal(MV.networkOf('Sunday Ticket'), 'YouTube');
  assert.equal(MV.networkOf('foxglove garden'), null, 'word boundaries: not every "fox" is FOX');
  assert.equal(MV.networkOf(''), null);
});

test('resolveTiles: one live game on the network is matched, an ambiguous network falls back to my teams, then to nothing', () => {
  const mine = new Set(['MIA']);
  const out = MV.resolveTiles([tile(0, 0, 0, 'FOX'), tile(1, 600, 0, 'CBS'), tile(2, 0, 340, 'NBC'), tile(3, 600, 340, null)], games, {}, mine);
  assert.deepEqual(out.map((t) => t.gameId), ['B', 'C', null, null]);   // CBS has two live games; only C has one of mine. NBC game has not started.
  const none = MV.resolveTiles([tile(1, 600, 0, 'CBS')], games, {}, new Set());
  assert.equal(none[0].gameId, null, 'two CBS games and none of mine: do not guess');
});

test('resolveTiles: a manual assignment wins, and "none" really means none', () => {
  const t = [tile(0, 0, 0, 'FOX'), tile(1, 600, 0, 'CBS')];
  const out = MV.resolveTiles(t, games, { 0: 'A', 1: 'none' }, new Set());
  assert.deepEqual(out.map((x) => [x.gameId, x.manual]), [['A', true], [null, true]]);
});

test('bestCorner: an explicit corner wins; auto avoids the tile that shows my game', () => {
  const box = { w: 240, h: 160 };
  assert.equal(MV.bestCorner('tr', box, [], 1280, 720, 16), 'tr');
  // 2 x 2 grid. My game is bottom-left, so the box should not go bottom-left.
  const tiles = [tile(0, 0, 0), tile(1, 640, 0), { ...tile(2, 0, 360), weight: 4 }, tile(3, 640, 360)].map((t) => ({ ...t, rect: { ...t.rect, width: 640, height: 360 } }));
  const corner = MV.bestCorner('auto', box, tiles, 1280, 720, 16);
  assert.notEqual(corner, 'bl');
  // With the video filling only the left half, the free right half is the best place.
  const half = [{ ...tile(0, 0, 0), rect: { left: 0, top: 0, width: 640, height: 720 } }];
  assert.ok(['tr', 'br'].includes(MV.bestCorner('auto', box, half, 1280, 720, 16)));
});

test('overlay escapes everything the APIs send', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>"\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
});
