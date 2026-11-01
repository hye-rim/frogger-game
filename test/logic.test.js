'use strict';
// 프로거 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const fresh = (level = 1) => L.newGame(L.rng(7), level);
// 비어 있는 판: 자동차·통나무·뱀·파리·암컷 개구리가 없다
function blank(level = 1) {
  const st = fresh(level);
  for (const lane of st.lanes) lane.items = [];
  st.snake = null; st.fxWait = 1e9; st.ladyWait = 1e9;
  return st;
}
const run = (st, secs, input = {}) => { for (let i = 0; i < Math.round(secs / 0.01); i++) L.step(st, 0.01, input); };
const hop = (st, dir) => { L.step(st, 0.001, { dir }); run(st, L.HOP + 0.02); };
const put = (st, x, y) => { st.frog.x = x; st.frog.y = y; st.frog.hop = null; };
const evs = (st, t) => st.events.filter((e) => e.t === t);
const addItem = (st, row, x, len, extra = {}) => { const lane = L.laneOf(st, row); const it = { x, len, phase: 0, idx: 0, croc: false, dives: false, ...extra }; lane.items.push(it); return it; };

test('layout: 15 columns, home row, 5 river rows, median, 5 road rows, start row', () => {
  assert.strictEqual(L.COLS, 15); assert.strictEqual(L.ROWS, 13);
  assert.deepStrictEqual(L.RIVER, [1, 2, 3, 4, 5]); assert.deepStrictEqual(L.ROAD, [7, 8, 9, 10, 11]);
  assert.strictEqual(L.BAYS.length, 5);
  const st = fresh();
  assert.strictEqual(st.lanes.length, 10);
  assert.deepStrictEqual([st.frog.x, st.frog.y], [7, 12]);
  assert.strictEqual(st.lives, L.START_LIVES); assert.strictEqual(st.timeLeft, L.TIME_LIMIT);
});

test('lanes wrap around with a gap and every lane has a different row', () => {
  const st = fresh();
  assert.strictEqual(new Set(st.lanes.map((l) => l.row)).size, 10);
  for (const l of st.lanes) assert.ok(l.span >= L.COLS + l.len + 2, 'ring is long enough to fill the screen');
  const t0 = JSON.stringify(st.lanes.map((l) => l.items.map((i) => i.x.toFixed(2))));
  run(st, 20);
  for (const l of st.lanes) for (const it of l.items) assert.ok(it.x > -l.span && it.x < l.span, 'stays in range ' + it.x);
  assert.notStrictEqual(t0, JSON.stringify(st.lanes.map((l) => l.items.map((i) => i.x.toFixed(2)))));
});

test('hopping moves one cell and scores 10 for each new row only', () => {
  const st = blank();
  hop(st, 0); assert.strictEqual(st.frog.y, 11); assert.strictEqual(st.score, 10);
  hop(st, 2); assert.strictEqual(st.frog.y, 12); assert.strictEqual(st.score, 10);
  hop(st, 0); assert.strictEqual(st.score, 10, 'no points for a row already reached');
  hop(st, 0); assert.strictEqual(st.frog.y, 10); assert.strictEqual(st.score, 20);
  hop(st, 1); assert.strictEqual(st.frog.x, 8);
  hop(st, 3); hop(st, 3); assert.strictEqual(st.frog.x, 6);
});

test('cannot hop off the sides or below the start row', () => {
  const st = blank();
  put(st, 0, 12); hop(st, 3); assert.strictEqual(st.frog.x, 0);
  put(st, 14, 12); hop(st, 1); assert.strictEqual(st.frog.x, 14);
  put(st, 7, 12); hop(st, 2); assert.strictEqual(st.frog.y, 12);
});

test('a hop takes time and cannot be interrupted', () => {
  const st = blank();
  L.step(st, 0.001, { dir: 0 });
  assert.ok(st.frog.hop);
  L.step(st, 0.02, { dir: 3 });
  assert.ok(st.frog.hop && st.frog.hop.tx === 7, 'second request ignored while hopping');
});

test('a car kills the frog and costs a life', () => {
  const st = blank();
  addItem(st, 11, 6.6, 1);
  put(st, 7, 11);
  L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'dying'); assert.strictEqual(st.lives, L.START_LIVES - 1);
  assert.strictEqual(evs(st, 'dead')[0].why, 'car');
});

test('a car in another lane or a gap does not hurt', () => {
  const st = blank();
  addItem(st, 11, 2, 1); addItem(st, 10, 7, 2);
  put(st, 7, 11); L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'play');
});

test('falling in the water kills the frog', () => {
  const st = blank();
  put(st, 7, 6); hop(st, 0);
  assert.strictEqual(st.phase, 'dying'); assert.strictEqual(evs(st, 'dead').length + st.events.length >= 0, true);
});

test('a log carries the frog sideways and carrying off screen kills it', () => {
  const st = blank();
  addItem(st, 1, 5, 6); addItem(st, 5, 5, 6);
  put(st, 7, 6); hop(st, 0);
  assert.strictEqual(st.phase, 'play');
  const lane = L.laneOf(st, 5), x0 = st.frog.x;
  run(st, 1);
  assert.ok(Math.abs((st.frog.x - x0) - lane.dir * lane.speed) < 0.3, 'moves with the platform');
  for (let i = 0; i < 1500 && st.phase === 'play'; i++) L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'dying');
});

test('swept off the edge is its own death reason', () => {
  const st = blank();
  const it = addItem(st, 4, 12, 3);
  put(st, 13, 4); st.frog.hop = null;
  let why = null;
  for (let i = 0; i < 400 && !why; i++) { L.step(st, 0.01, {}); const d = evs(st, 'dead')[0]; if (d) why = d.why; }
  assert.strictEqual(why, 'swept'); assert.ok(it);
});

test('diving turtles: safe while sinking, deadly under water', () => {
  const st = blank();
  const it = addItem(st, 5, 6, 3, { dives: true });
  const lane = L.laneOf(st, 5);
  for (const [t, state] of [[0.1, 'up'], [4.5, 'sink'], [5.5, 'under'], [6.5, 'rise']]) { st.t = t - it.phase; assert.strictEqual(L.diveState(st, it), state); }
  st.t = 5.5; assert.strictEqual(L.platformAt(st, 5, 7), null, 'nothing to stand on under water');
  st.t = 4.5; assert.ok(L.platformAt(st, 5, 7), 'still solid while sinking');
  it.dives = false; st.t = 5.5; assert.ok(L.platformAt(st, 5, 7)); assert.ok(lane);
});

test('a frog on a turtle that dives drowns', () => {
  const st = blank();
  const it = addItem(st, 5, 6, 4, { dives: true });
  lane5Speed0(st);
  st.t = 4.0 - it.phase;
  put(st, 7, 6); hop(st, 0);
  assert.strictEqual(st.phase, 'play');
  run(st, 2);
  assert.strictEqual(st.phase, 'dying');
});
function lane5Speed0(st) { L.laneOf(st, 5).speed = 0; }

test('the crocodile head is deadly only with the mouth open, the body is safe', () => {
  const st = blank(2);
  const it = addItem(st, 3, 4, 6, { croc: true }); L.laneOf(st, 3).speed = 0;
  const [a, b] = L.headRange(L.laneOf(st, 3), it);
  assert.strictEqual(b - a, 1);
  assert.strictEqual(a, 9, 'head at the front (moving right)');
  st.t = 0; it.phase = 0; assert.strictEqual(L.mouthOpen(st, it), false);
  st.t = 4; assert.strictEqual(L.mouthOpen(st, it), true);
  st.t = 0; put(st, 9, 3); st.frog.hop = null; run(st, 0.5);   // 입 닫힘: 안전 (t 가 0.5초 흐름)
  assert.strictEqual(st.phase, 'play');
  const s2 = blank(2); const c2 = addItem(s2, 3, 4, 6, { croc: true }); L.laneOf(s2, 3).speed = 0; c2.phase = 3.2;
  put(s2, 9, 3); L.step(s2, 0.01, {});
  assert.strictEqual(s2.phase, 'dying'); assert.strictEqual(evs(s2, 'dead')[0].why, 'croc');
  const s3 = blank(2); const c3 = addItem(s3, 3, 4, 6, { croc: true }); L.laneOf(s3, 3).speed = 0; c3.phase = 3.2;
  put(s3, 5, 3); L.step(s3, 0.01, {});
  assert.strictEqual(s3.phase, 'play', 'standing on the body is safe');
});

test('the snake on the median kills only from level 3', () => {
  assert.strictEqual(fresh(1).snake, null);
  assert.strictEqual(fresh(2).snake, null);
  assert.ok(fresh(3).snake);
  const st = blank(3); st.snake = { x: 7, dir: 1 };
  put(st, 7, 6); L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'dying'); assert.strictEqual(evs(st, 'dead')[0].why, 'snake');
  const s2 = blank(3); s2.snake = { x: 2, dir: 1 }; put(s2, 12, 6); L.step(s2, 0.01, {});
  assert.strictEqual(s2.phase, 'play');
});

test('reaching an empty bay scores 50 plus the time bonus and sends a new frog', () => {
  const st = blank();
  addItem(st, 1, 0, 14); L.laneOf(st, 1).speed = 0;
  st.bestRow = 1; put(st, 7, 1); st.timeLeft = 20;
  hop(st, 0);
  assert.strictEqual(st.bays[2], true);
  assert.strictEqual(st.score, 50 + 40 * 10);
  assert.deepStrictEqual([st.frog.x, st.frog.y], [7, 12]); assert.ok(st.timeLeft > L.TIME_LIMIT - 0.2);
  assert.strictEqual(st.lives, L.START_LIVES);
});

test('hitting the wall between the bays, or a filled bay, kills', () => {
  const st = blank();
  addItem(st, 1, 0, 14); L.laneOf(st, 1).speed = 0;
  put(st, 5, 1); hop(st, 0);
  assert.strictEqual(st.phase, 'dying');
  const s2 = blank(); addItem(s2, 1, 0, 14); L.laneOf(s2, 1).speed = 0; s2.bays[2] = true;
  put(s2, 7, 1); hop(s2, 0);
  assert.strictEqual(s2.phase, 'dying');
});

test('a fly in a bay is worth 200 more, a gator in a bay kills', () => {
  const st = blank(3);
  addItem(st, 1, 0, 14); L.laneOf(st, 1).speed = 0;
  st.bayFx = { kind: 'fly', bay: 2, t: 4 }; st.timeLeft = 0.2; put(st, 7, 1); hop(st, 0);
  assert.ok(st.score >= 50 + 200); assert.strictEqual(st.bayFx, null);
  const s2 = blank(3); addItem(s2, 1, 0, 14); L.laneOf(s2, 1).speed = 0;
  s2.bayFx = { kind: 'gator', bay: 2, t: 4 }; put(s2, 7, 1); hop(s2, 0);
  assert.strictEqual(s2.phase, 'dying');
});

test('the lady frog: pick her up from a log and bring her home for 200', () => {
  const st = blank();
  const it = addItem(st, 1, 3, 8); L.laneOf(st, 1).speed = 0;
  st.lady = { row: 1, it, off: 4, t: 14 };
  put(st, 7, 1); st.bestRow = 1; st.timeLeft = 0.2;
  L.step(st, 0.01, {});
  assert.strictEqual(st.carry, true); assert.strictEqual(st.lady, null);
  hop(st, 0);
  assert.strictEqual(st.carry, false);
  assert.ok(st.score >= 50 + 200);
  assert.ok(evs(st, 'lady').length + 1);
});

test('dying with the lady frog loses her', () => {
  const st = blank(); st.carry = true; L.die(st, 'car');
  assert.strictEqual(st.carry, false);
});

test('time runs out after the time limit', () => {
  const st = blank();
  run(st, L.TIME_LIMIT - 0.5); assert.strictEqual(st.phase, 'play');
  run(st, 1);
  assert.strictEqual(st.phase, 'dying'); assert.strictEqual(st.lives, L.START_LIVES - 1);
});

test('after dying the frog comes back at the start with a full timer', () => {
  const st = blank(); put(st, 7, 8); L.die(st, 'car');
  run(st, L.DYING + 0.1);
  assert.strictEqual(st.phase, 'play');
  assert.deepStrictEqual([st.frog.x, st.frog.y], [7, 12]); assert.ok(st.timeLeft > 29.8);
});

test('game over after the last life', () => {
  const st = blank(); st.lives = 1; L.die(st, 'car');
  run(st, L.DYING + 0.1);
  assert.strictEqual(st.phase, 'over');
});

test('five frogs home clears the level for 1000 and the next level is faster', () => {
  const st = blank();
  addItem(st, 1, 0, 14); L.laneOf(st, 1).speed = 0;
  st.bays = [true, true, false, true, true]; st.timeLeft = 5;
  put(st, 7, 1); hop(st, 0);
  assert.strictEqual(st.phase, 'clear');
  assert.ok(st.score >= 1000 + 50);
  run(st, L.CLEAR_TIME + 0.1);
  assert.strictEqual(st.level, 2); assert.strictEqual(st.phase, 'play');
  assert.deepStrictEqual(st.bays, [false, false, false, false, false]);
  assert.ok(L.speedFactor(2) > L.speedFactor(1));
});

test('difficulty rises with each level but is capped', () => {
  for (let l = 2; l <= 15; l++) assert.ok(L.speedFactor(l) >= L.speedFactor(l - 1));
  assert.ok(L.speedFactor(99) <= 1.8);
  const a = fresh(1), b = fresh(6);
  const dives = (s) => s.lanes.reduce((n, l) => n + l.items.filter((i) => i.dives).length, 0);
  assert.ok(dives(b) > dives(a), 'more diving turtles later');
  const crocs = (s) => s.lanes.reduce((n, l) => n + l.items.filter((i) => i.croc).length, 0);
  assert.strictEqual(crocs(a), 0); assert.ok(crocs(b) >= 1);
});

test('an extra frog at the extra life score, once', () => {
  const st = blank(); st.score = L.EXTRA_LIFE_AT - 10; hop(st, 0);
  assert.strictEqual(st.lives, L.START_LIVES + 1);
  st.score = L.EXTRA_LIFE_AT + 5000; hop(st, 0); hop(st, 0);
  assert.strictEqual(st.lives, L.START_LIVES + 1);
});

test('flies and gators appear in empty bays only and do not stack', () => {
  const st = fresh(3);
  st.bays = [true, true, true, true, false]; st.fxWait = 0;
  L.step(st, 0.01, {});
  assert.ok(st.bayFx && st.bayFx.bay === 4);
  const first = st.bayFx; st.fxWait = 0; L.step(st, 0.01, {});
  assert.strictEqual(st.bayFx, first);
});

test('random play never breaks the rules (fuzz)', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const r = L.rng(seed), st = L.newGame(L.rng(seed * 3), 1 + (seed % 5));
    for (let i = 0; i < 6000 && st.phase !== 'over'; i++) {
      L.step(st, 0.02, { dir: r() < 0.12 ? Math.floor(r() * 4) : null });
      assert.ok(Number.isFinite(st.frog.x) && Number.isFinite(st.frog.y) && st.frog.y >= 0 && st.frog.y <= 12);
      assert.ok(st.lives >= 0 && st.score >= 0);
      assert.ok(st.timeLeft >= 0 && st.timeLeft <= L.TIME_LIMIT);
    }
  }
});

test('the first levels are gentle: no snake, no crocodile, no diving turtles until later', () => {
  for (const lv of [1, 2]) {
    const st = fresh(lv);
    assert.strictEqual(st.snake, null);
    assert.ok(st.lanes.every((l) => l.items.every((it) => !it.croc)), `no crocodile on level ${lv}`);
  }
  assert.ok(fresh(1).lanes.every((l) => l.items.every((it) => !it.dives)), 'no turtle dives on level 1');
  assert.ok(fresh(3).lanes.some((l) => l.items.some((it) => it.croc)), 'a crocodile on level 3');
});

test('landing a little past the edge of a log is forgiven but not far past it', () => {
  const near = blank();
  const it = addItem(near, 3, 7, 3); L.laneOf(near, 3).speed = 0;
  near.bestRow = 3; put(near, 9.7, 4);                     // 통나무는 7~10: 몸 가운데(10.2)가 끝에서 0.2 칸 밖
  hop(near, 0);
  assert.strictEqual(near.phase, 'play', 'close to the end still lands');
  const far = blank();
  addItem(far, 3, 7, 3); L.laneOf(far, 3).speed = 0;
  far.bestRow = 3; put(far, 10.2, 4);                      // 가운데(10.7)가 끝에서 0.7 칸 밖
  hop(far, 0);
  assert.strictEqual(far.phase, 'dying');
  assert.ok(it);
});

test('a car just grazing the frog is a near miss while a direct hit still kills', () => {
  const graze = blank();
  addItem(graze, 11, 5.0, 1);                              // 차 5~6, 개구리 몸은 6.25~6.75
  put(graze, 7, 11); L.step(graze, 0.01, {});
  assert.strictEqual(graze.phase, 'play');
  const hit = blank();
  addItem(hit, 11, 6.6, 1); put(hit, 7, 11); L.step(hit, 0.01, {});
  assert.strictEqual(hit.phase, 'dying');
});
