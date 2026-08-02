// ── Canvas rendering ─────────────────────────────────────────
// Draws the whole game as a minimap: fog-of-war wall outlines,
// the yellow-cross player marker, rarity-colored enemy dots,
// telegraphs, and skill VFX. Plus the blurred biome backdrop.

import { $ } from './utils.js';
import { BIOMES, RARITY } from './defs.js';
import { mulberry32 } from './utils.js';

const ENEMY_VIS = 14;    // enemies show within this many tiles, radar style
let S = 11;              // pixels per tile, set on resize
let dpr = 1;
let floorCanvas = null;  // offscreen 1px-per-tile fill for discovered floor

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

  // world transform: camera centered
  const px = S * dpr;
  ctx.setTransform(px, 0, 0, px, c.width / 2 - run.camX * px, c.height / 2 - run.camY * px);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawFloorFill(ctx, run);
  drawWalls(ctx, run, biome);
  drawWaypoints(ctx, run, biome);
  drawTarget(ctx, run);
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
    if (seen[i] && map.grid[i]) fctx.fillRect(i % map.w, (i / map.w) | 0, 1, 1);
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

function drawWaypoints(ctx, run, biome) {
  const pulse = 0.75 + 0.25 * Math.sin(run.time * 3);
  for (const wp of run.map.waypoints) {
    const idx = (wp.y | 0) * run.map.w + (wp.x | 0);
    if (!run.seen[idx]) continue;
    const unlocked = run.wpUnlocked.includes(wp.id);
    ctx.save();
    ctx.translate(wp.x, wp.y);
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = unlocked ? hexA(biome.wpColor, 0.95) : hexA(biome.wpColor, 0.45 * pulse + 0.2);
    ctx.lineWidth = 0.14;
    ctx.strokeRect(-0.55, -0.55, 1.1, 1.1);
    if (unlocked) {
      ctx.strokeStyle = hexA(biome.wpColor, 0.35 * pulse);
      ctx.strokeRect(-0.95, -0.95, 1.9, 1.9);
    }
    ctx.restore();
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
    if (e.snareT > 0) ring(ctx, e.x, e.y, r + 0.25, 'rgba(125,187,94,0.9)', 0.1);
    else if (e.slowT > 0) ring(ctx, e.x, e.y, r + 0.25, 'rgba(127,212,240,0.9)', 0.1);
  }
}

function drawPlayer(ctx, run) {
  const p = run.player;
  ctx.save();
  ctx.translate(p.x, p.y);
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
  pop(ctx, v, k) {
    const rng = mulberry32(((v.x * 73 + v.y * 179) * 1000) | 0);
    for (let i = 0; i < 6; i++) {
      const ang = rng() * Math.PI * 2;
      const d = k * (0.5 + rng() * 0.8);
      ctx.fillStyle = hexA(v.color, 1 - k);
      ctx.fillRect(v.x + Math.cos(ang) * d, v.y + Math.sin(ang) * d, 0.12, 0.12);
    }
  },
  num(ctx, v, k) {
    ctx.font = '0.72px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255,244,214,${1 - k})`;
    ctx.fillText(String(v.text), v.x, v.y - 0.6 - k * 0.9);
  },
};

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
