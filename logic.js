'use strict';
// 프로거 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
const LOGIC_FROGGER = (() => {
  const COLS = 15, ROWS = 13;
  const HOME_ROW = 0, MEDIAN = 6, START_ROW = 12;
  const RIVER = [1, 2, 3, 4, 5], ROAD = [7, 8, 9, 10, 11];
  const BAYS = [1, 4, 7, 10, 13];                         // 집 다섯 칸의 가운데 칸
  const BAY_REACH = 0.7;                                  // 이 거리 안이면 집에 들어간 것
  const START = { x: 7, y: 12 };
  const START_LIVES = 3, TIME_LIMIT = 30, HOP = 0.11, DYING = 1.3, CLEAR_TIME = 2.6;
  const POINTS = { step: 10, home: 50, fly: 200, lady: 200, clear: 1000, halfSecond: 10 };
  const EXTRA_LIFE_AT = 20000;
  const DIVE_CYCLE = 7;                                   // 거북이: 떠 있음 4.2 · 가라앉는 중 0.8 · 물속 1.2 · 떠오르는 중 0.8
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const speedFactor = (level) => Math.min(2.2, 1 + 0.09 * (level - 1));

  // 한 줄마다: 줄 번호, 종류, 길이, 사이 빈 칸, 방향(1 오른쪽 · -1 왼쪽), 기본 속도(칸/초)
  const LANES = [
    { row: 1, kind: 'log', len: 4, gap: 3, dir: 1, speed: 1.6 },
    { row: 2, kind: 'turtle', len: 3, gap: 3, dir: -1, speed: 1.5, diveFrom: 2 },
    { row: 3, kind: 'log', len: 6, gap: 4, dir: 1, speed: 3.0 },
    { row: 4, kind: 'log', len: 3, gap: 3, dir: 1, speed: 1.3 },
    { row: 5, kind: 'turtle', len: 2, gap: 3, dir: -1, speed: 1.8, diveFrom: 1 },
    { row: 7, kind: 'truck', len: 3, gap: 7, dir: -1, speed: 1.5 },
    { row: 8, kind: 'racer', len: 1, gap: 7, dir: 1, speed: 4.8 },
    { row: 9, kind: 'car', len: 1, gap: 4, dir: -1, speed: 2.4 },
    { row: 10, kind: 'dozer', len: 2, gap: 5, dir: 1, speed: 1.8 },
    { row: 11, kind: 'car', len: 1, gap: 4, dir: -1, speed: 1.5 },
  ];
  const isRiver = (r) => r >= 1 && r <= 5;
  const isRoad = (r) => r >= 7 && r <= 11;

  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const emit = (st, e) => { st.events.push(e); };

  function buildLanes(st) {
    st.lanes = LANES.map((def) => {
      const spacing = def.len + def.gap, n = Math.ceil((COLS + def.len + 2) / spacing);
      const off = st.rand() * spacing;
      const items = [];
      for (let i = 0; i < n; i++) {
        const it = { x: off + i * spacing - def.len - 1, len: def.len, phase: st.rand() * DIVE_CYCLE, idx: i, croc: false, dives: false };
        if (def.kind === 'turtle' && st.level >= def.diveFrom) it.dives = st.level >= def.diveFrom + 2 || i % 2 === 0;
        items.push(it);
      }
      if (def.row === 3 && st.level >= 2) { items[0].croc = true; if (st.level >= 4 && items.length > 3) items[3].croc = true; }
      return { ...def, span: n * spacing, items };
    });
  }
  const laneOf = (st, row) => st.lanes.find((l) => l.row === row);
  // 거북이 상태: up · sink · under · rise
  function diveState(st, it) {
    if (!it.dives) return 'up';
    const p = (st.t + it.phase) % DIVE_CYCLE;
    return p < 4.2 ? 'up' : p < 5 ? 'sink' : p < 6.2 ? 'under' : 'rise';
  }
  const solid = (st, lane, it) => lane.kind !== 'turtle' || diveState(st, it) !== 'under';
  // 악어 머리(입): 진행 방향 앞 한 칸. 입이 열려 있을 때만 위험
  const mouthOpen = (st, it) => ((st.t + it.phase) % 5) > 3;
  const headRange = (lane, it) => (lane.dir > 0 ? [it.x + it.len - 1, it.x + it.len] : [it.x, it.x + 1]);

  function platformAt(st, row, cx) {
    const lane = laneOf(st, row);
    if (!lane) return null;
    for (const it of lane.items) if (cx >= it.x && cx <= it.x + it.len && solid(st, lane, it)) return { lane, it };
    return null;
  }

  function newGame(rand = Math.random, level = 1) {
    const st = { rand, score: 0, lives: START_LIVES, level, t: 0, events: [], extra: false };
    startLevel(st, level);
    return st;
  }
  function startLevel(st, level) {
    st.level = level;
    st.bays = [false, false, false, false, false];
    st.bayFx = null; st.fxWait = 3 + st.rand() * 3;
    st.lady = null; st.ladyWait = 8 + st.rand() * 6;
    st.snake = level >= 2 ? { x: 3, dir: 1 } : null;
    st.phase = 'play'; st.clearT = 0;
    buildLanes(st);
    resetFrog(st);
    emit(st, { t: 'level', level });
  }
  function resetFrog(st) {
    st.frog = { x: START.x, y: START.y, hop: null, dir: 0, alive: true };
    st.timeLeft = TIME_LIMIT; st.bestRow = START_ROW; st.carry = false;
  }

  function die(st, why) {
    if (st.phase !== 'play') return;
    const f = st.frog;
    f.alive = false; f.hop = null; st.carry = false;
    st.lives--;
    st.phase = 'dying'; st.dyingT = DYING;
    emit(st, { t: 'dead', why, x: f.x, y: f.y });
  }
  function addScore(st, n) {
    st.score += n;
    if (!st.extra && st.score >= EXTRA_LIFE_AT) { st.extra = true; st.lives++; emit(st, { t: 'extra' }); }
  }

  function tryHop(st, dir) {
    const f = st.frog;
    if (f.hop || !f.alive) return false;
    const ty = Math.round(f.y) + DY[dir];
    let tx = f.x + DX[dir];
    if (ty < 0 || ty > START_ROW) return false;
    if (DX[dir] !== 0 && (tx < -0.01 || tx > COLS - 0.99)) return false;
    if (DX[dir] === 0 && !isRiver(ty) && ty !== HOME_ROW) tx = Math.round(f.x);
    if (DX[dir] !== 0 && !isRiver(ty)) tx = Math.round(tx);
    f.hop = { fx: f.x, fy: f.y, tx, ty, t: 0 };
    f.dir = dir;
    emit(st, { t: 'hop', dir });
    if (ty < st.bestRow) { st.bestRow = ty; addScore(st, POINTS.step); emit(st, { t: 'step', pts: POINTS.step }); }
    return true;
  }

  function enterHome(st) {
    const f = st.frog;
    const i = BAYS.findIndex((b) => Math.abs(f.x - b) <= BAY_REACH);
    if (i < 0) return die(st, 'wall');
    if (st.bays[i]) return die(st, 'filled');
    if (st.bayFx && st.bayFx.kind === 'gator' && st.bayFx.bay === i) return die(st, 'gator');
    st.bays[i] = true;
    let pts = POINTS.home + Math.floor(st.timeLeft * 2) * POINTS.halfSecond;
    if (st.bayFx && st.bayFx.kind === 'fly' && st.bayFx.bay === i) { pts += POINTS.fly; emit(st, { t: 'fly', bay: i }); st.bayFx = null; st.fxWait = 3 + st.rand() * 4; }
    if (st.carry) { pts += POINTS.lady; emit(st, { t: 'lady', bay: i }); st.carry = false; }
    addScore(st, pts);
    emit(st, { t: 'home', bay: i, pts });
    if (st.bays.every(Boolean)) {
      addScore(st, POINTS.clear);
      st.phase = 'clear'; st.clearT = CLEAR_TIME; st.frog.alive = false;
      emit(st, { t: 'clear', level: st.level, pts: POINTS.clear });
    } else resetFrog(st);
  }

  function land(st) {
    const f = st.frog, h = f.hop;
    f.hop = null; f.x = h.tx; f.y = h.ty;
    if (h.ty === HOME_ROW) { enterHome(st); return; }
    if (isRiver(h.ty)) { if (!platformAt(st, h.ty, f.x + 0.5)) { emit(st, { t: 'splash', x: f.x, y: f.y }); die(st, 'water'); } }
    else f.x = Math.round(f.x);
    emit(st, { t: 'land' });
  }

  function updateLanes(st, h) {
    const k = speedFactor(st.level);
    for (const lane of st.lanes) for (const it of lane.items) {
      it.x += lane.dir * lane.speed * k * h;
      if (lane.dir > 0 && it.x > COLS + 1) it.x -= lane.span;
      else if (lane.dir < 0 && it.x + it.len < -1) it.x += lane.span;
    }
    if (st.snake) {
      const s = st.snake;
      s.x += s.dir * 2.2 * k * h;
      if (s.x > COLS - 1.5) { s.x = COLS - 1.5; s.dir = -1; } else if (s.x < 0.5) { s.x = 0.5; s.dir = 1; }
    }
  }

  function updateExtras(st, h) {
    // 집에 나타나는 파리·악어
    if (st.bayFx) { st.bayFx.t -= h; if (st.bayFx.t <= 0) { st.bayFx = null; st.fxWait = 3 + st.rand() * 4; } }
    else {
      st.fxWait -= h;
      const empty = st.bays.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);
      if (st.fxWait <= 0 && empty.length) {
        const bay = empty[Math.floor(st.rand() * empty.length)];
        const gator = st.level >= 3 && st.rand() < 0.5;
        st.bayFx = { kind: gator ? 'gator' : 'fly', bay, t: gator ? 5 : 4.5 };
        emit(st, { t: 'bayfx', kind: st.bayFx.kind, bay });
      }
    }
    // 통나무 위의 암컷 개구리
    if (st.lady) { st.lady.t -= h; if (st.lady.t <= 0) { st.lady = null; st.ladyWait = 8 + st.rand() * 6; } }
    else if (!st.carry) {
      st.ladyWait -= h;
      if (st.ladyWait <= 0) {
        const cands = [];
        for (const lane of st.lanes) if (lane.kind === 'log') for (const it of lane.items) if (!it.croc && it.x >= 0 && it.x + it.len <= COLS) cands.push({ lane, it });
        if (cands.length) { const c = cands[Math.floor(st.rand() * cands.length)]; st.lady = { row: c.lane.row, it: c.it, off: c.it.len / 2, t: 14 }; emit(st, { t: 'ladyspawn' }); }
        else st.ladyWait = 1;
      }
    }
  }

  function checkFrog(st, h) {
    const f = st.frog;
    // 도로: 차에 치임
    for (const lane of st.lanes) {
      if (!isRoad(lane.row) || Math.abs(f.y - lane.row) >= 0.65) continue;
      for (const it of lane.items) if (f.x + 0.15 < it.x + it.len - 0.05 && f.x + 0.85 > it.x + 0.05) { emit(st, { t: 'squash' }); return die(st, 'car'); }
    }
    // 가운데 둔덕의 뱀
    if (st.snake && Math.abs(f.y - MEDIAN) < 0.5 && Math.abs(f.x - st.snake.x) < 0.8) return die(st, 'snake');
    if (f.hop) return;
    const row = Math.round(f.y);
    if (isRiver(row)) {
      const cx = f.x + 0.5, pf = platformAt(st, row, cx);
      if (!pf) { emit(st, { t: 'splash', x: f.x, y: f.y }); return die(st, 'water'); }
      f.x += pf.lane.dir * pf.lane.speed * speedFactor(st.level) * h;
      if (f.x < -0.5 || f.x > COLS - 0.5) return die(st, 'swept');
      if (pf.it.croc && mouthOpen(st, pf.it)) { const [a, b] = headRange(pf.lane, pf.it); if (cx >= a && cx <= b) return die(st, 'croc'); }
      if (st.lady && st.lady.row === row && !st.carry) {
        const lx = st.lady.it.x + st.lady.off;
        if (Math.abs(cx - lx) < 0.8) { st.carry = true; st.lady = null; st.ladyWait = 10 + st.rand() * 6; emit(st, { t: 'pickup' }); }
      }
    }
  }

  function step(st, dt, input = {}) {
    const h = Math.min(dt, 0.05);
    st.events = [];
    if (st.phase === 'over') return;
    st.t += h;
    updateLanes(st, h);
    if (st.phase === 'dying') {
      st.dyingT -= h;
      if (st.dyingT <= 0) {
        if (st.lives <= 0) { st.phase = 'over'; emit(st, { t: 'over' }); } else { resetFrog(st); st.phase = 'play'; emit(st, { t: 'respawn' }); }
      }
      return;
    }
    if (st.phase === 'clear') {
      st.clearT -= h;
      if (st.clearT <= 0) startLevel(st, st.level + 1);
      return;
    }
    updateExtras(st, h);
    st.timeLeft -= h;
    if (st.timeLeft <= 0) { st.timeLeft = 0; return die(st, 'time'); }
    const f = st.frog;
    if (f.hop) {
      f.hop.t += h;
      const p = Math.min(1, f.hop.t / HOP);
      f.x = f.hop.fx + (f.hop.tx - f.hop.fx) * p; f.y = f.hop.fy + (f.hop.ty - f.hop.fy) * p;
      if (p >= 1) land(st);
    } else if (input.dir !== null && input.dir !== undefined) tryHop(st, input.dir);
    if (st.phase === 'play') checkFrog(st, h);
  }

  return {
    COLS, ROWS, HOME_ROW, MEDIAN, START_ROW, RIVER, ROAD, BAYS, START, START_LIVES, TIME_LIMIT, HOP, DYING, CLEAR_TIME, POINTS, EXTRA_LIFE_AT, DIVE_CYCLE, DX, DY, LANES,
    rng, speedFactor, newGame, startLevel, step, tryHop, diveState, mouthOpen, headRange, platformAt, laneOf, isRiver, isRoad, die, resetFrog,
  };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_FROGGER;
