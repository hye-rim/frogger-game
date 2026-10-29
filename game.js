'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 프로거: 화면·입력·소리. 규칙은 logic.js (LOGIC_FROGGER). 여기서는 st.events 를 보고 소리·효과를 만든다.
const L = LOGIC_FROGGER;
const { COLS, ROWS, BAYS } = L;
const CELL = 16, HUD = 16, FOOT = 16;
const W = COLS * CELL, FH = ROWS * CELL, CH = HUD + FH + FOOT;       // 240 x 240

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const controls = $('controls');
  const ctrlH = getComputedStyle(controls).display === 'none' ? 0 : controls.offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - ctrlH) / CH);
  const cssW = Math.max(150, Math.floor(W * scale)), cssH = Math.floor(cssW * CH / W);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / CH, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', fit);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('froggerMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.045, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function noise(dur, vol = 0.08, lowpass = 1500) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(audio.destination); s.start();
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.05) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const sfx = {
  hop: () => tone(440, 0.07, 'square', 0.04, 260),
  squash: () => { noise(0.2, 0.1, 900); tone(160, 0.2, 'sawtooth', 0.05, -90); },
  splash: () => noise(0.35, 0.09, 2400),
  home: () => melody([523, 659, 784, 1047], 80, 'square', 0.05),
  fly: () => melody([1047, 1319, 1568], 60, 'sine', 0.06),
  pickup: () => melody([784, 988], 70, 'sine', 0.06),
  dead: () => melody([392, 330, 262, 196], 120, 'sawtooth', 0.05),
  clear: () => melody([523, 659, 784, 1047, 784, 1047, 1319], 100),
  tick: () => tone(300, 0.05, 'square', 0.03),
  start: () => melody([392, 523, 659], 100),
  over: () => melody([392, 330, 262, 196], 220, 'sawtooth', 0.06),
  extra: () => melody([659, 784, 1047, 1319], 90, 'sine', 0.07),
};

// ---------- 상태 ----------
let G = L.newGame();
let state = 'title';                           // title · play · paused · over
let best = Number(store.get('froggerBest')) || 0;
let fxs = [];
let banner = { text: '', sub: '', t: 0, color: '#7dff7d' };
let clock = 0, lastTick = 0;
let pending = null, pendingT = 0, held = null;

/* @test-hooks:start */
window.__fg = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt) };
/* @test-hooks:end */

// ---------- 입력 ----------
const KEY_DIR = { ArrowUp: 0, w: 0, W: 0, ArrowRight: 1, d: 1, D: 1, ArrowDown: 2, s: 2, S: 2, ArrowLeft: 3, a: 3, A: 3 };
function ask(d) { pending = d; pendingT = 0.25; }
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key in KEY_DIR) {
    e.preventDefault();
    if (state === 'play' && !e.repeat) { ask(KEY_DIR[e.key]); held = KEY_DIR[e.key]; }
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (state === 'title' || state === 'over') { if (!e.repeat) onOverlayButton(); } else if (state === 'paused' && !e.repeat) resume();
    return;
  }
  if (e.key === 'p' || e.key === 'P') { if (state === 'paused') resume(); else pause(); }
  else if (e.key === 'm' || e.key === 'M') toggleMute();
});
addEventListener('keyup', (e) => { if (e.key in KEY_DIR && KEY_DIR[e.key] === held) held = null; });

// 폰 화살표 버튼: 누르면 한 칸, 꾹 누르면 계속
const padBtns = [...document.querySelectorAll('#dpad button')];
for (const b of padBtns) {
  const d = Number(b.dataset.d);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) {} b.classList.add('on'); if (state === 'play') { ask(d); held = d; } });
  const off = () => { b.classList.remove('on'); if (held === d) held = null; };
  b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
}
// 화면 쓸기: 쓴 방향으로 한 칸 (톡 치면 앞으로)
let swipe = null;
canvas.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
  if (state !== 'play') return;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 14) ask(0);
  else ask(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
});
canvas.addEventListener('pointercancel', () => { swipe = null; });

// ---------- 흐름 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.querySelector('button').onclick = onOverlayButton; }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function setBanner(text, sub = '', color = '#7dff7d', t = 2) { banner = { text, sub, t, color }; }
function startGame() {
  G = L.newGame();
  if (/[?&]tutorial=1/.test(location.search)) G.lives = 9;             // 튜토리얼에서는 죽어도 계속 해 볼 수 있게
  fxs = []; pending = null; held = null; lastTick = 0;
  state = 'play';
  setBanner('LEVEL 1', '집 다섯 칸을 모두 채워요');
  hideOverlay();
  sfx.start();
}
function onOverlayButton() { if (state === 'paused') resume(); else startGame(); }
let pausedFrom = null;
function pause() {
  if (state !== 'play') return;
  pausedFrom = state; state = 'paused'; held = null;
  showOverlay('<h2>일시정지</h2><p>P 키나 아래 버튼으로 계속해요</p><button id="startBtn">계속하기</button>');
}
function resume() { if (state !== 'paused') return; state = pausedFrom; hideOverlay(); }
function gameOver() {
  state = 'over';
  const rec = G.score > best;
  if (rec) { best = G.score; store.set('froggerBest', String(best)); }
  sfx.over();
  showOverlay(`<h2>GAME OVER</h2><p class="big">${G.score.toLocaleString()}점</p><p>레벨 ${G.level} · 채운 집 ${G.bays.filter(Boolean).length}칸${rec ? '<br>🏆 최고 기록!' : ''}</p><button id="startBtn">다시 하기</button>`);
}

function handleEvents() {
  for (const e of G.events) {
    if (e.t === 'hop') { sfx.hop(); tutorialSignal('hop'); }
    else if (e.t === 'land') {
      const row = Math.round(G.frog.y);
      if (row === L.MEDIAN) tutorialSignal('median');
      else if (L.isRiver(row)) tutorialSignal('ride');
    }
    else if (e.t === 'squash') sfx.squash();
    else if (e.t === 'splash') { sfx.splash(); fxs.push({ kind: 'ripple', x: e.x + 0.5, y: e.y + 0.5, t: 0, life: 0.8 }); }
    else if (e.t === 'dead') { if (e.why === 'time') sfx.dead(); else if (e.why !== 'car' && e.why !== 'water') sfx.dead(); else if (e.why === 'water') setTimeout(sfx.dead, 250); else setTimeout(sfx.dead, 200); }
    else if (e.t === 'home') { sfx.home(); tutorialSignal('home'); fxs.push({ kind: 'text', x: BAYS[e.bay] + 0.5, y: 1.4, t: 0, life: 1.2, text: String(e.pts), color: '#ffe14a' }); }
    else if (e.t === 'fly') sfx.fly();
    else if (e.t === 'pickup') { sfx.pickup(); tutorialSignal('lady'); }
    else if (e.t === 'lady') sfx.fly();
    else if (e.t === 'extra') { sfx.extra(); setBanner('1UP', '개구리가 한 마리 늘었어요', '#ffe14a', 1.8); }
    else if (e.t === 'clear') { sfx.clear(); setBanner('LEVEL CLEAR', `+${e.pts}`, '#ffe14a', 2.4); }
    else if (e.t === 'level') { if (e.level > 1) { setBanner(`LEVEL ${e.level}`, '', '#7dff7d', 2); sfx.start(); } }
    else if (e.t === 'over') gameOver();
  }
}

function update(dt) {
  clock += dt;
  if (state !== 'play') return;
  pendingT -= dt; if (pendingT <= 0) pending = null;
  let dir = null;
  if (pending !== null) dir = pending; else if (held !== null) dir = held;
  const f = G.frog;
  const before = f.hop;
  L.step(G, dt, { dir });
  if (dir !== null && !before && G.frog.hop) { if (pending === dir) pending = null; }       // 뛰었으면 입력을 비움
  handleEvents();
  banner.t = Math.max(0, banner.t - dt);
  for (const x of fxs) x.t += dt;
  fxs = fxs.filter((x) => x.t < x.life);
  const sec = Math.ceil(G.timeLeft);
  if (G.phase === 'play' && G.timeLeft < 8 && sec !== lastTick) { lastTick = sec; sfx.tick(); }
}

// ---------- 그리기 ----------
const px = (x) => x * CELL, py = (y) => HUD + y * CELL;
function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

function drawBackground() {
  rect(0, 0, W, CH, '#000');
  rect(0, py(0), W, CELL, '#0a5a14');                                   // 맨 위 풀숲
  rect(0, py(1), W, CELL * 5, '#0a2a7a');                               // 강
  for (let r = 1; r <= 5; r++) for (let x = 0; x < COLS * 2; x++) if ((x + r) % 3 === 0) rect(x * 8 + Math.sin(clock + x) * 1.5, py(r) + 8 + (r % 2) * 3, 4, 1, '#2a56c0');
  rect(0, py(6), W, CELL, '#6a2a8a'); rect(0, py(12), W, CELL, '#6a2a8a');   // 둔덕·출발
  for (const r of [6, 12]) for (let x = 0; x < COLS; x++) if ((x + r) % 2) rect(px(x), py(r), CELL, CELL, '#7a3a9a');
  rect(0, py(7), W, CELL * 5, '#161616');                               // 도로
  for (let r = 7; r < 11; r++) for (let x = 0; x < COLS; x++) rect(px(x) + 3, py(r + 1) - 1, 10, 2, '#555');
  // 집 다섯 칸
  for (let i = 0; i < BAYS.length; i++) {
    const x = px(BAYS[i]) - 8, y = py(0);
    rect(x, y, CELL + 16, CELL, '#0a2a7a'); rect(x, y, CELL + 16, 2, '#052a0a');
    rect(x - 1, y, 1, CELL, '#2a8a2a'); rect(x + CELL + 16, y, 1, CELL, '#2a8a2a');
  }
}
function drawFrogShape(cx, cy, dir, scale, color, dead) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(dir * Math.PI / 2); ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 6.5, 0, 0, 7); ctx.fill();
  ctx.fillRect(-7, -6, 3, 3); ctx.fillRect(4, -6, 3, 3); ctx.fillRect(-7, 3, 3, 3); ctx.fillRect(4, 3, 3, 3);   // 다리
  if (dead) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-4, -5); ctx.lineTo(-1, -2); ctx.moveTo(-1, -5); ctx.lineTo(-4, -2); ctx.moveTo(1, -5); ctx.lineTo(4, -2); ctx.moveTo(4, -5); ctx.lineTo(1, -2); ctx.stroke(); }
  else { ctx.fillStyle = '#fff'; ctx.fillRect(-4, -6, 3, 3); ctx.fillRect(1, -6, 3, 3); ctx.fillStyle = '#000'; ctx.fillRect(-3, -5, 1.5, 1.5); ctx.fillRect(2, -5, 1.5, 1.5); }
  ctx.restore();
}
function drawLaneItem(lane, it) {
  const x = px(it.x), y = py(lane.row), w = it.len * CELL;
  if (x > W + 4 || x + w < -4) return;
  if (lane.kind === 'log') {
    if (it.croc) { drawCroc(lane, it, x, y, w); return; }
    rect(x, y + 2, w, CELL - 4, '#8a5a1a'); rect(x, y + 4, w, 2, '#a8742a'); rect(x, y + 9, w, 2, '#6a3a0a');
    rect(x, y + 2, 2, CELL - 4, '#5a3008'); rect(x + w - 2, y + 2, 2, CELL - 4, '#5a3008');
  } else if (lane.kind === 'turtle') {
    const state = L.diveState(G, it);
    for (let i = 0; i < it.len; i++) {
      const cx = x + i * CELL + 8, cy = y + 8;
      if (state === 'under') { ctx.fillStyle = 'rgba(80,140,255,.3)'; ctx.beginPath(); ctx.ellipse(cx, cy, 5, 4, 0, 0, 7); ctx.fill(); continue; }
      const k = state === 'sink' || state === 'rise' ? 0.6 + 0.2 * Math.sin(clock * 12) : 1;
      ctx.fillStyle = state === 'sink' || state === 'rise' ? '#2a8a8a' : '#1a9a3a';
      ctx.beginPath(); ctx.ellipse(cx, cy, 6.5 * k, 5 * k, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#0a5a1a'; ctx.fillRect(cx - 3 * k, cy - 2 * k, 6 * k, 1); ctx.fillRect(cx - 1, cy - 4 * k, 1, 8 * k);
      ctx.fillStyle = '#3ac85a'; ctx.fillRect(cx + (lane.dir < 0 ? -9 : 6), cy - 1.5, 3, 3);
    }
  } else {
    drawVehicle(lane, it, x, y, w);
  }
}
function drawVehicle(lane, it, x, y, w) {
  const left = lane.dir < 0;
  if (lane.kind === 'truck') {
    rect(x + 1, y + 2, w - 2, CELL - 4, '#d8d8d8'); rect(x + 1, y + 2, w - 2, 2, '#fff');
    const cab = left ? x + 1 : x + w - 12; rect(cab, y + 3, 11, CELL - 6, '#d84a2a');
    rect(x + 4, y + CELL - 3, 6, 3, '#111'); rect(x + w - 10, y + CELL - 3, 6, 3, '#111');
  } else if (lane.kind === 'dozer') {
    rect(x + 3, y + 4, w - 6, 7, '#e8c82a'); rect(left ? x : x + w - 4, y + 3, 4, 10, '#8a8a8a'); rect(x + 5, y + 11, w - 10, 4, '#444');
    rect(x + (left ? w - 14 : 4), y + 1, 8, 5, '#c8a818');
  } else if (lane.kind === 'racer') {
    rect(x + 1, y + 5, 14, 6, '#ff3a8a'); rect(x + (left ? 2 : 8), y + 3, 6, 3, '#ffd0e8'); rect(x + 2, y + 11, 4, 3, '#111'); rect(x + 10, y + 11, 4, 3, '#111');
  } else {
    const col = lane.row === 9 ? '#2a8aff' : '#e8e82a';
    rect(x + 1, y + 5, 14, 7, col); rect(x + 4, y + 3, 8, 4, col); rect(x + 5, y + 4, 6, 2, '#bfe0ff'); rect(x + 2, y + 11, 4, 3, '#111'); rect(x + 10, y + 11, 4, 3, '#111');
  }
}
function drawCroc(lane, it, x, y, w) {
  rect(x, y + 3, w, CELL - 6, '#2a7a2a'); rect(x, y + 3, w, 2, '#3aa83a');
  for (let i = 1; i < it.len - 1; i++) rect(x + i * CELL + 4, y + 2, 3, 2, '#1a5a1a');
  const hx = lane.dir > 0 ? x + w - CELL : x;
  const open = L.mouthOpen(G, it);
  rect(hx, y + 3, CELL, open ? 5 : 9, '#2a8a2a');
  if (open) { rect(hx, y + 9, CELL, 4, '#2a8a2a'); rect(hx + 2, y + 8, CELL - 4, 1, '#fff'); rect(hx + 3, y + 9, 2, 2, '#fff'); rect(hx + CELL - 5, y + 9, 2, 2, '#fff'); }
  rect(hx + (lane.dir > 0 ? 9 : 4), y + 3, 3, 3, '#ff4a2a');
}
function drawBayFx() {
  for (let i = 0; i < BAYS.length; i++) {
    const cx = px(BAYS[i]) + 8, cy = py(0) + 8;
    if (G.bays[i]) drawFrogShape(cx, cy, 2, 1, '#3ad83a', false);
  }
  const fx = G.bayFx;
  if (!fx) return;
  const cx = px(BAYS[fx.bay]) + 8, cy = py(0) + 8;
  if (fx.kind === 'fly') {
    const w = Math.sin(clock * 40) * 2;
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(cx - 5, cy - 4 + w, 4, 3); ctx.fillRect(cx + 1, cy - 4 - w, 4, 3);
    ctx.fillStyle = '#222'; ctx.fillRect(cx - 2, cy - 1, 4, 5);
  } else {
    rect(cx - 7, cy - 3, 14, 7, '#2a8a2a'); rect(cx - 7, cy + 1, 14, 3, '#1a5a1a');
    rect(cx - 5, cy + 0, 2, 2, '#fff'); rect(cx + 3, cy + 0, 2, 2, '#fff'); rect(cx - 6, cy - 5, 3, 3, '#ff4a2a'); rect(cx + 3, cy - 5, 3, 3, '#ff4a2a');
  }
}
function drawLady() {
  const l = G.lady; if (!l) return;
  const lx = px(l.it.x + l.off), ly = py(l.row);
  drawFrogShape(lx, ly + 8, 0, 0.8, '#ff6ab8', false);
}
function drawSnake() {
  const s = G.snake; if (!s) return;
  const x = px(s.x), y = py(L.MEDIAN) + 8;
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#e8d82a' : '#2a9a2a'; ctx.fillRect(x - s.dir * i * 4 + 4, y + Math.sin(clock * 10 + i) * 2 - 1.5, 4, 3); }
  rect(x + 4 + (s.dir > 0 ? 2 : -2), y - 2, 5, 4, '#2a9a2a');
}
function drawFrog() {
  const f = G.frog;
  if (G.phase === 'clear') return;
  let x = px(f.x) + 8, y = py(f.y) + 8, sc = 1;
  if (f.hop) { const p = Math.min(1, f.hop.t / L.HOP); sc = 1 + 0.35 * Math.sin(p * Math.PI); }
  if (!f.alive) {
    if (G.phase === 'dying') { if (Math.floor(clock * 8) % 2) return; drawFrogShape(x, y, f.dir, 1, '#d83a3a', true); }
    return;
  }
  drawFrogShape(x, y, f.dir, sc, G.carry ? '#3ad83a' : '#3ad83a', false);
  if (G.carry) drawFrogShape(x, y - 1, 0, 0.5, '#ff6ab8', false);
}
function drawFx() {
  for (const f of fxs) {
    const k = f.t / f.life, x = px(f.x), y = py(f.y);
    if (f.kind === 'ripple') { ctx.strokeStyle = `rgba(200,230,255,${1 - k})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, y, 3 + k * 10, 2 + k * 6, 0, 0, 7); ctx.stroke(); }
    else if (f.kind === 'text') { ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.fillStyle = f.color || '#fff'; ctx.strokeText(f.text, x, y + 10 - k * 12); ctx.fillText(f.text, x, y + 10 - k * 12); }
  }
}
function drawHud() {
  rect(0, 0, W, HUD, '#000'); rect(0, HUD + FH, W, FOOT, '#000');
  ctx.textBaseline = 'middle'; ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'left'; ctx.fillStyle = '#ff6a6a'; ctx.fillText('1UP', 4, 8); ctx.fillStyle = '#fff'; ctx.fillText(String(G.score), 26, 8);
  ctx.textAlign = 'center'; ctx.fillStyle = '#7fd0ff'; ctx.fillText('HI', 118, 8); ctx.fillStyle = '#fff'; ctx.fillText(String(Math.max(best, G.score)), 140, 8);
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffe14a'; ctx.fillText(`LV ${G.level}`, W - 64, 8);
  for (let i = 0; i < Math.max(0, G.lives - (G.frog.alive ? 1 : 0)); i++) drawFrogShape(10 + i * 14, HUD + FH + 8, 0, 0.55, '#3ad83a', false);
  // 남은 시간 막대
  const k = Math.max(0, G.timeLeft / L.TIME_LIMIT);
  rect(90, HUD + FH + 4, 140, 8, '#222');
  rect(91, HUD + FH + 5, 138 * k, 6, k > 0.3 ? '#e8e82a' : (Math.floor(clock * 6) % 2 ? '#ff3a3a' : '#ffa0a0'));
  ctx.textAlign = 'right'; ctx.fillStyle = '#bbb'; ctx.font = 'bold 7px sans-serif'; ctx.fillText('TIME', 86, HUD + FH + 8);
}
function draw() {
  drawBackground();
  for (const lane of G.lanes) if (L.isRiver(lane.row)) for (const it of lane.items) drawLaneItem(lane, it);
  drawBayFx(); drawLady(); drawSnake();
  for (const lane of G.lanes) if (L.isRoad(lane.row)) for (const it of lane.items) drawLaneItem(lane, it);
  drawFrog(); drawFx(); drawHud();
  // 양옆: 화면 밖에서 오는 것을 가리는 띠
  if (banner.t > 0) {
    rect(0, HUD + FH / 2 - 24, W, banner.sub ? 40 : 24, 'rgba(0,0,0,.65)');
    ctx.fillStyle = banner.color; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, W / 2, HUD + FH / 2 - 13);
    if (banner.sub) { ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, W / 2, HUD + FH / 2 + 3); }
  }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('froggerMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('startBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
requestAnimationFrame(frame);
