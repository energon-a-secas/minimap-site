// ── Canvas rendering ─────────────────────────────────────────
// Draws the whole game as a minimap: fog-of-war wall outlines,
// the yellow-cross player marker, rarity-colored enemy dots,
// telegraphs, and skill VFX. Plus the blurred biome backdrop.

import { $ } from './utils.js';
import { BIOMES, RARITY, MOVES } from './defs.js';
import { mulberry32 } from './utils.js';

const ENEMY_VIS = 14;    // enemies show within this many tiles, radar style
let S = 11;              // pixels per tile, set on resize
let dpr = 1;
let floorCanvas = null;  // offscreen 1px-per-tile fill for discovered floor
let lastRollT = 0;       // previous frame's rollT, to catch i-frames ending
let lastRun = null;      // reset roll tracking when the run changes
let rollEndFx = null;    // {x, y, t} white ring when i-frames end

export function resizeCanvases() {
  const stage = $('stage');
  if (!stage) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const id of ['gameCanvas', 'bgCanvas']) {
    const c = $(id);
    c.width = stage.clientWidth * dpr;
    c.height = stage.clientHeight * dpr;
  }
  S = Math.max(8, Math.min(15, stage.clientHeight / 42));
}

/** Static blurred blobs behind the map, the "game you cannot see". */
export function paintBackdrop(map) {
  const c = $('bgCanvas');
  const ctx = c.getContext('2d');
  const biome = BIOMES[map.biome];
  const rng = mulberry32(map.seed ^ 0x9e37);
  ctx.fillStyle = biome.bg[0];
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 46; i++) {
    const x = rng() * c.width, y = rng() * c.height;
    const r = (0.05 + rng() * 0.16) * c.width;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = biome.bg[1 + Math.floor(rng() * (biome.bg.length - 1))];
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // vignette
  const v = ctx.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.2, c.width / 2, c.height / 2, c.width * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, c.width, c.height);
  floorCanvas = document.createElement('canvas');
  floorCanvas.width = map.w;
  floorCanvas.height = map.h;
}

export function drawFrame(run) {
  const c = $('gameCanvas');
  const ctx = c.getContext('2d');
  const { map, player } = run;
  const biome = BIOMES[map.biome];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);

  // world transform: camera centered, jittered by engine-owned shake
  const px = S * dpr;
  const shk = run.shakeMag || 0;
  const cx = run.camX + (shk ? (Math.random() - 0.5) * shk : 0);
  const cy = run.camY + (shk ? (Math.random() - 0.5) * shk : 0);
  ctx.setTransform(px, 0, 0, px, c.width / 2 - cx * px, c.height / 2 - cy * px);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawFloorFill(ctx, run);
  drawWalls(ctx, run, biome);
  drawDecor(ctx, run);
  drawWaypoints(ctx, run);
  drawTarget(ctx, run);
  drawZones(ctx, run);
  drawImpacts(ctx, run);
  drawTelegraphs(ctx, run);
  drawEnemies(ctx, run);
  drawVfx(ctx, run);
  drawPlayer(ctx, run);
}

function drawFloorFill(ctx, run) {
  if (!floorCanvas) return;
  const { map, seen } = run;
  const fctx = floorCanvas.getContext('2d');
  fctx.clearRect(0, 0, map.w, map.h);
  fctx.fillStyle = 'rgba(150,160,200,0.10)';
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] && map.grid[i] === 1) fctx.fillRect(i % map.w, (i / map.w) | 0, 1, 1);
  }
  // water (grid value 2): dim blue-teal so lakes read inside their shorelines
  fctx.fillStyle = 'rgba(56,142,168,0.24)';
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] && map.grid[i] === 2) fctx.fillRect(i % map.w, (i / map.w) | 0, 1, 1);
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(floorCanvas, 0, 0, map.w, map.h);
  ctx.restore();
}

function drawWalls(ctx, run, biome) {
  const { map, seen } = run;
  ctx.beginPath();
  for (const s of map.segs) {
    if (!seen[s.tile]) continue;
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
  }
  // two-pass: soft glow then crisp line, like a certain minimap
  ctx.strokeStyle = hexA(biome.line, 0.22);
  ctx.lineWidth = 0.42;
  ctx.stroke();
  ctx.strokeStyle = hexA(biome.line, 0.95);
  ctx.lineWidth = 0.13;
  ctx.stroke();
}

/** Decor kinds as tiny minimap marks: single strokes and dots, muted tones. */
const DECOR_DRAW = {
  rubble(ctx, x, y) { dot(ctx, x - 0.12, y + 0.03, 0.09, 'rgba(205,205,215,0.30)'); dot(ctx, x + 0.11, y - 0.09, 0.07, 'rgba(205,205,215,0.26)'); },
  shroom(ctx, x, y) { dot(ctx, x, y - 0.05, 0.13, 'rgba(212,168,220,0.40)'); },
  tree(ctx, x, y) { mark(ctx, [[x - 0.2, y + 0.18], [x, y - 0.24], [x + 0.2, y + 0.18]], 'rgba(138,188,118,0.45)', 0.09); },
  pillar(ctx, x, y) { mark(ctx, [[x, y + 0.22], [x, y - 0.26]], 'rgba(220,208,176,0.40)', 0.12); },
  crystal(ctx, x, y) { mark(ctx, [[x, y - 0.22], [x + 0.15, y], [x, y + 0.22], [x - 0.15, y], [x, y - 0.22]], 'rgba(150,218,240,0.50)', 0.08); },
};

function drawDecor(ctx, run) {
  const decor = run.map.decor;
  if (!decor) return;
  for (const d of decor) {
    if (!run.seen[(d.y | 0) * run.map.w + (d.x | 0)]) continue;
    DECOR_DRAW[d.kind]?.(ctx, d.x, d.y);
  }
}

/** Waypoints are totems: green for the entrance, blue for midpoints. */
function drawWaypoints(ctx, run) {
  const pulse = 0.75 + 0.25 * Math.sin(run.time * 3);
  for (const wp of run.map.waypoints) {
    const idx = (wp.y | 0) * run.map.w + (wp.x | 0);
    if (!run.seen[idx]) continue;
    const unlocked = run.wpUnlocked.includes(wp.id);
    const color = wp.id === 'wp0' ? '#4ade80' : '#38bdf8';
    const a = unlocked ? 0.95 : 0.35 + 0.25 * pulse;
    ctx.save();
    ctx.translate(wp.x, wp.y);
    // pole
    ctx.strokeStyle = hexA(color, a);
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.moveTo(0, 0.85);
    ctx.lineTo(0, -0.95);
    ctx.stroke();
    // crossbars, wider at the bottom like a proper totem
    ctx.lineWidth = 0.16;
    for (const [y, w] of [[-0.75, 0.42], [-0.3, 0.55], [0.2, 0.68]]) {
      ctx.beginPath();
      ctx.moveTo(-w, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // head
    ctx.fillStyle = hexA(color, a);
    ctx.beginPath();
    ctx.arc(0, -1.1, 0.22, 0, Math.PI * 2);
    ctx.fill();
    if (unlocked) {
      ctx.strokeStyle = hexA(color, 0.3 * pulse);
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.arc(0, 0, 1.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Druid vine zones: translucent green with writhing strands. */
function drawZones(ctx, run) {
  for (const z of run.zones) {
    const wobble = Math.sin(run.time * 7) * 0.06;
    ctx.fillStyle = 'rgba(125,187,94,0.16)';
    ctx.strokeStyle = 'rgba(143,217,106,0.75)';
    ctx.lineWidth = 0.1;
    if (z.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r + wobble, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      for (let i = 0; i < 7; i++) {
        const ang = (i / 7) * Math.PI * 2 + run.time * 1.5;
        ctx.beginPath();
        ctx.moveTo(z.x + Math.cos(ang) * z.r * 0.35, z.y + Math.sin(ang) * z.r * 0.35);
        ctx.lineTo(z.x + Math.cos(ang) * (z.r * 0.85 + wobble), z.y + Math.sin(ang) * (z.r * 0.85 + wobble));
        ctx.stroke();
      }
    } else {
      const dx = z.x2 - z.x1, dy = z.y2 - z.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      ctx.beginPath();
      ctx.moveTo(z.x1 + nx * z.width, z.y1 + ny * z.width);
      ctx.lineTo(z.x2 + nx * z.width, z.y2 + ny * z.width);
      ctx.lineTo(z.x2 - nx * z.width, z.y2 - ny * z.width);
      ctx.lineTo(z.x1 - nx * z.width, z.y1 - ny * z.width);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const px = z.x1 + dx * t, py = z.y1 + dy * t;
        const s = (i % 2 ? 1 : -1) * (z.width * 0.8 + wobble);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + nx * s, py + ny * s);
        ctx.stroke();
      }
    }
  }
}

/** Incoming friendly comets: blue telegraph with a timer ring. */
function drawImpacts(ctx, run) {
  for (const im of run.impacts) {
    if (im.fired) continue;
    const k = im.t / im.dur;
    ctx.fillStyle = `rgba(127,212,240,${0.08 + k * 0.2})`;
    ctx.beginPath();
    ctx.arc(im.x, im.y, im.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(159,224,247,0.85)';
    ctx.lineWidth = 0.1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(im.x, im.y, im.r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  }
}

function drawTarget(ctx, run) {
  const t = run.input.target;
  if (!t) return;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.arc(t.x, t.y, 0.5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawTelegraphs(ctx, run) {
  const b = run.boss;
  if (!b || b.dead) return;
  for (const tg of b.telegraphs) {
    if (tg.fired) continue;
    const k = tg.t / tg.dur;
    ctx.fillStyle = `rgba(255,110,40,${0.10 + k * 0.22})`;
    ctx.beginPath();
    ctx.arc(tg.x, tg.y, tg.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,140,60,0.85)';
    ctx.lineWidth = 0.12;
    ctx.stroke();
    // closing timer ring
    ctx.strokeStyle = 'rgba(255,220,120,0.9)';
    ctx.beginPath();
    ctx.arc(tg.x, tg.y, tg.r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
    ctx.stroke();
  }
}

function drawEnemies(ctx, run) {
  const p = run.player;
  for (const e of run.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    if (dx * dx + dy * dy > ENEMY_VIS * ENEMY_VIS) continue;
    if (!run.seen[(e.y | 0) * run.map.w + (e.x | 0)]) continue;
    const rdef = RARITY[e.rarity];
    const r = rdef.r / 11;
    if (e.rarity !== 'normal') {
      ctx.fillStyle = hexA(rdef.color, 0.25);
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * (e.isBoss ? 2.1 : 1.9), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = rdef.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.isBoss ? r * (1.15 + 0.12 * Math.sin(run.time * 5)) : r, 0, Math.PI * 2);
    ctx.fill();
    // hit flash: engine sets flashT on damage, we just brighten while it lasts
    if (e.flashT > 0) dot(ctx, e.x, e.y, r * 1.08, `rgba(255,255,255,${Math.min(0.9, e.flashT * 6)})`);
    if (e.snareT > 0) ring(ctx, e.x, e.y, r + 0.25, 'rgba(125,187,94,0.9)', 0.1);
    else if (e.slowT > 0) ring(ctx, e.x, e.y, r + 0.25, 'rgba(127,212,240,0.9)', 0.1);
  }
}

function drawPlayer(ctx, run) {
  const p = run.player;
  // white pop the instant i-frames end, so "hittable again" is readable
  if (run !== lastRun) { lastRun = run; lastRollT = 0; rollEndFx = null; }
  if (lastRollT > 0 && p.rollT <= 0) rollEndFx = { x: p.x, y: p.y, t: run.time };
  lastRollT = p.rollT;
  if (rollEndFx) {
    const rk = (run.time - rollEndFx.t) / 0.28;
    if (rk >= 1) rollEndFx = null;
    else ring(ctx, rollEndFx.x, rollEndFx.y, 0.5 + rk * 1.1, `rgba(255,255,255,${0.85 * (1 - rk)})`, 0.12);
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  // rolling: ghost the marker so the invulnerability window is readable
  if (p.rollT > 0) {
    // afterimages trailing the roll direction
    const fade = Math.min(1, p.rollT / MOVES.roll.dur);
    for (let i = 1; i <= 3; i++) {
      dot(ctx, -p.aim.x * i * 0.5, -p.aim.y * i * 0.5, 0.42 - i * 0.08, `rgba(255,255,255,${fade * (0.32 - i * 0.08)})`);
    }
    ctx.setLineDash([0.16, 0.12]);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.arc(0, 0, 1.0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.35;
  }
  // stunned: spinning dazed arcs
  if (p.stunT > 0) {
    ctx.strokeStyle = 'rgba(255,210,62,0.9)';
    ctx.lineWidth = 0.12;
    for (let i = 0; i < 3; i++) {
      const a0 = run.time * 5 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(0, 0, 1.05, a0, a0 + 0.9);
      ctx.stroke();
    }
  }
  // channeling: draw ring closing in
  if (p.channelT > 0 && p.channelSkill) {
    const k = 1 - p.channelT / p.channelSkill.channel;
    ctx.strokeStyle = 'rgba(255,242,176,0.9)';
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.arc(0, 0, 1.4 - k * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  // sprinting: motion ticks behind
  if (p.sprint) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.09;
    for (const s of [0.7, 1.0, 1.3]) {
      ctx.beginPath();
      ctx.moveTo(-p.aim.x * s - p.aim.y * 0.2, -p.aim.y * s + p.aim.x * 0.2);
      ctx.lineTo(-p.aim.x * (s + 0.3) + p.aim.y * 0.2, -p.aim.y * (s + 0.3) - p.aim.x * 0.2);
      ctx.stroke();
    }
  }
  // the big red dot
  ctx.fillStyle = '#e33b25';
  ctx.beginPath();
  ctx.arc(0, 0, 0.46, 0, Math.PI * 2);
  ctx.fill();
  // the yellow cross, slightly rotated because it always is
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = '#ffd23e';
  ctx.lineWidth = 0.2;
  ctx.beginPath();
  for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(ax * 0.28, ay * 0.28);
    ctx.lineTo(ax * 0.85, ay * 0.85);
  }
  ctx.stroke();
  ctx.restore();
}

// ── VFX ──────────────────────────────────────────────────────

const VFX_DRAW = {
  arrow(ctx, v, k) { beam(ctx, v, k, '#e8d894', 0.1); },
  thorn(ctx, v, k) { beam(ctx, v, k, '#8fd96a', 0.16); },
  frost(ctx, v, k) { beam(ctx, v, k, '#9fe0f7', 0.13); },
  pierceLine(ctx, v, k) { beam(ctx, v, k, '#fff2b0', 0.2); },
  burstRing(ctx, v, k) { ring(ctx, v.x, v.y, v.radius * k, `rgba(143,217,106,${1 - k})`, 0.22); },
  novaRing(ctx, v, k) { ring(ctx, v.x, v.y, v.radius * k, `rgba(159,224,247,${1 - k})`, 0.22); },
  levelRing(ctx, v, k) { ring(ctx, v.x, v.y, v.radius * k, `rgba(255,210,62,${1 - k})`, 0.3); },
  slam(ctx, v, k) {
    ctx.fillStyle = `rgba(255,150,64,${0.5 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(v.x, v.y, v.radius, 0, Math.PI * 2);
    ctx.fill();
  },
  hurt(ctx, v, k) { ring(ctx, v.x, v.y, 0.7 + k * 0.5, `rgba(227,59,37,${0.8 * (1 - k)})`, 0.14); },
  rollStreak(ctx, v, k) { beam(ctx, v, k, 'rgba(255,255,255,0.8)', 0.24); },
  cometSlam(ctx, v, k) {
    ctx.fillStyle = `rgba(159,224,247,${0.55 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(v.x, v.y, v.radius * (0.8 + k * 0.3), 0, Math.PI * 2);
    ctx.fill();
  },
  pop(ctx, v, k) {
    // death burst scaled by rarity (pop color is the rarity color)
    const sc = POP_SCALE[v.color] || 1;
    const rng = mulberry32(((v.x * 73 + v.y * 179) * 1000) | 0);
    const n = 6 + (((sc - 1) * 5) | 0);
    for (let i = 0; i < n; i++) {
      const ang = rng() * Math.PI * 2;
      const d = k * (0.5 + rng() * 0.8) * sc;
      ctx.fillStyle = hexA(v.color, 1 - k);
      ctx.fillRect(v.x + Math.cos(ang) * d, v.y + Math.sin(ang) * d, 0.12, 0.12);
    }
    if (sc > 1) ring(ctx, v.x, v.y, 0.3 + k * 1.2 * sc, `rgba(255,255,255,${0.6 * (1 - k)})`, 0.1);
    if (sc > 2) dot(ctx, v.x, v.y, (1 - k) * 1.6, `rgba(255,238,200,${0.5 * (1 - k)})`);
  },
  num(ctx, v, k) {
    // font grows mildly with damage magnitude, capped at 1.5x base
    const mag = Math.min(1.5, 1 + Math.max(0, Math.log10(Math.max(1, Number(v.text) || 1)) - 1) * 0.25);
    ctx.font = (0.72 * mag).toFixed(2) + 'px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255,244,214,${1 - k})`;
    ctx.fillText(String(v.text), v.x, v.y - 0.6 - k * 0.9);
  },
};

const POP_SCALE = { [RARITY.normal.color]: 1, [RARITY.magic.color]: 1.5, [RARITY.rare.color]: 1.8, [RARITY.boss.color]: 2.6 };

function drawVfx(ctx, run) {
  for (const v of run.vfx) {
    const k = Math.min(1, v.t / v.dur);
    VFX_DRAW[v.type]?.(ctx, v, k);
  }
}

function beam(ctx, v, k, color, width) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = 1 - k;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(v.x1, v.y1);
  ctx.lineTo(v.x1 + (v.x2 - v.x1) * Math.min(1, k * 2), v.y1 + (v.y2 - v.y1) * Math.min(1, k * 2));
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function ring(ctx, x, y, r, style, width) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.01, r), 0, Math.PI * 2);
  ctx.stroke();
}

function dot(ctx, x, y, r, style) {
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.01, r), 0, Math.PI * 2);
  ctx.fill();
}

function mark(ctx, pts, style, width) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

/** Convert client (screen) coords to world tile coords. */
export function screenToWorld(run, clientX, clientY) {
  const c = $('gameCanvas');
  const rect = c.getBoundingClientRect();
  const px = S * dpr;
  return {
    x: run.camX + ((clientX - rect.left) * dpr - c.width / 2) / px,
    y: run.camY + ((clientY - rect.top) * dpr - c.height / 2) / px,
  };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
