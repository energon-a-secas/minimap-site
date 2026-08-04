// ── Atlas terrain painter ────────────────────────────────────
// Deterministic dark-fantasy world map painted on a <canvas>
// behind the atlas SVG. A northern sea with a glowing coast,
// biome-tinted lowlands, forest and marsh detail, a sand reach,
// mountains rising toward the apex, and tiny line-art landmarks
// near the three class roots. All drawing happens in the SVG's
// 1000x560 coordinate space, scaled to the wrap's client box.

import { mulberry32, debounce } from './utils.js';
import { ATLAS } from './defs.js';

const W = 1000;
const H = 560;
const SEED = 0xA71A57; // fixed: same map every paint

// terrain tint per biome, as "r, g, b" (matches wpColor hues)
const TINT = {
  caverns: '111, 195, 255',
  wetlands: '99, 224, 192',
  forest: '143, 224, 106',
  ruins: '224, 180, 99',
  crypt: '180, 143, 224',
};
const ACCENT = '125, 211, 252'; // sky-300, the minimap accent
const GOLD = '200, 170, 110';   // HUD gold
const RIDGE = '214, 222, 235';  // pale rock
const INK = 'rgba(230, 226, 216, 0.30)'; // landmark line art

const COAST_STEP = 55;

let wrapRef = null;
let bound = false;
let lastKey = '';

/** Paint (or repaint) the terrain canvas inside `.atlas-wrap`.
    Idempotent: reuses the canvas, skips when the box is unchanged. */
export function paintAtlasTerrain(wrap) {
  if (!wrap) return;
  wrapRef = wrap;
  if (!bound) {
    bound = true;
    window.addEventListener('resize', debounce(() => {
      lastKey = '';
      if (wrapRef && wrapRef.isConnected) paintAtlasTerrain(wrapRef);
    }, 160));
  }
  let canvas = wrap.querySelector('canvas.atlas-terrain');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'atlas-terrain';
    canvas.setAttribute('aria-hidden', 'true');
    wrap.insertBefore(canvas, wrap.firstChild);
  }
  const cw = wrap.clientWidth;
  const ch = wrap.clientHeight;
  if (!cw || !ch) {
    // screen hidden at call time: retry once on the next frame
    requestAnimationFrame(() => {
      if (wrapRef && wrapRef.isConnected && wrapRef.clientWidth) paintAtlasTerrain(wrapRef);
    });
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const key = cw + 'x' + ch + '@' + dpr;
  if (key === lastKey && canvas.width) return; // same box, same pixels
  lastKey = key;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform((cw * dpr) / W, 0, 0, (ch * dpr) / H, 0, 0);
  paint(ctx);
}

function paint(ctx) {
  const rng = mulberry32(SEED);
  const coast = buildCoast(rng);
  ctx.clearRect(0, 0, W, H);
  paintSea(ctx);
  paintLand(ctx, coast);
  paintBiomeTints(ctx, rng);
  paintHighground(ctx);
  paintBay(ctx);
  paintCoastGlow(ctx, coast);
  paintWaves(ctx, rng, coast);
  paintBiomeDetail(ctx, rng, coast);
  paintMountains(ctx, rng);
  paintLandmarks(ctx);
  paintCompass(ctx, 946, 524);
  paintVignette(ctx);
}

// ── Coastline ────────────────────────────────────────────────

function buildCoast(rng) {
  const pts = [];
  for (let x = -30; x <= 1040; x += COAST_STEP) {
    let y = 46 + Math.sin(x * 0.008) * 8 + (rng() - 0.5) * 16;
    if (x < 220) y += 12;  // deeper gulf in the north-west
    if (x > 800) y -= 16;  // land climbs toward the mountains
    pts.push([x, Math.max(20, Math.min(72, y))]);
  }
  return pts;
}

function coastY(coast, x) {
  const f = (x + 30) / COAST_STEP;
  const i = Math.max(0, Math.min(coast.length - 2, Math.floor(f)));
  const t = Math.max(0, Math.min(1, f - i));
  return coast[i][1] + (coast[i + 1][1] - coast[i][1]) * t;
}

// ── Base layers ──────────────────────────────────────────────

function paintSea(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#071528');
  g.addColorStop(0.5, '#050e1e');
  g.addColorStop(1, '#040a16');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function paintLand(ctx, coast) {
  ctx.beginPath();
  ctx.moveTo(coast[0][0], coast[0][1]);
  for (const [x, y] of coast) ctx.lineTo(x, y);
  ctx.lineTo(1040, 600);
  ctx.lineTo(-30, 600);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 40, 0, H);
  g.addColorStop(0, '#0c141d');
  g.addColorStop(0.55, '#0b1219');
  g.addColorStop(1, '#0a1016');
  ctx.fillStyle = g;
  ctx.fill();
}

function paintBiomeTints(ctx, rng) {
  let sx = 0, sy = 0, sn = 0;
  for (const n of ATLAS) {
    const tint = TINT[n.biome];
    const r = 62 + rng() * 20;
    const g = ctx.createRadialGradient(n.x, n.y, 6, n.x, n.y, r);
    g.addColorStop(0, `rgba(${tint}, 0.055)`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(n.x - r, n.y - r, r * 2, r * 2);
    if (n.biome === 'ruins') { sx += n.x; sy += n.y; sn++; }
  }
  if (sn) {
    // one broad sand reach around the ruins cluster centroid
    const cx = sx / sn, cy = sy / sn;
    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 150);
    g.addColorStop(0, `rgba(${TINT.ruins}, 0.05)`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 150, cy - 150, 300, 300);
  }
}

function paintHighground(ctx) {
  // pale lift so the right side reads as rising ground
  const g = ctx.createRadialGradient(940, 285, 40, 940, 285, 300);
  g.addColorStop(0, `rgba(${RIDGE}, 0.05)`);
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(620, 0, 380, H);
}

// ── Water detail ─────────────────────────────────────────────

function paintBay(ctx) {
  // small cove in the south-west corner
  ctx.beginPath();
  ctx.ellipse(0, 588, 132, 86, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#05101f';
  ctx.fill();
  ctx.strokeStyle = `rgba(${ACCENT}, 0.22)`;
  ctx.lineWidth = 1.4;
  ctx.shadowColor = `rgba(${ACCENT}, 0.5)`;
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function inBay(x, y) {
  const dx = x / 132, dy = (588 - y) / 86;
  return dx * dx + dy * dy < 1;
}

function paintCoastGlow(ctx, coast) {
  ctx.beginPath();
  ctx.moveTo(coast[0][0], coast[0][1]);
  for (const [x, y] of coast) ctx.lineTo(x, y);
  ctx.strokeStyle = `rgba(${ACCENT}, 0.30)`;
  ctx.lineWidth = 1.4;
  ctx.shadowColor = `rgba(${ACCENT}, 0.55)`;
  ctx.shadowBlur = 7;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(${ACCENT}, 0.10)`;
  ctx.lineWidth = 4;
  ctx.stroke();
}

function paintWaves(ctx, rng, coast) {
  ctx.lineWidth = 1;
  for (let i = 0; i < 30; i++) {
    const x = 10 + rng() * 980;
    const limit = coastY(coast, x) - 14;
    const y = 8 + rng() * Math.max(4, limit - 8);
    const r = 6 + rng() * 8;
    if (y < limit) arcWave(ctx, x, y, r, 0.06 + rng() * 0.05);
  }
  for (let i = 0; i < 6; i++) {
    const x = 8 + rng() * 78;
    const y = 516 + rng() * 36;
    const r = 5 + rng() * 5;
    if (inBay(x, y)) arcWave(ctx, x, y, r, 0.07 + rng() * 0.04);
  }
}

function arcWave(ctx, x, y, r, a) {
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI * 1.15, Math.PI * 1.85);
  ctx.strokeStyle = `rgba(${ACCENT}, ${a})`;
  ctx.stroke();
}

// ── Biome speckle detail ─────────────────────────────────────

function paintBiomeDetail(ctx, rng, coast) {
  for (const n of ATLAS) {
    const count = n.biome === 'forest' ? 14 : n.biome === 'wetlands' ? 9 : 8;
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const d = 27 + rng() * 30;
      const x = n.x + Math.cos(a) * d;
      const y = n.y + Math.sin(a) * d * 0.8;
      if (x < 8 || x > 992 || y > 548) continue;
      if (y < coastY(coast, x) + 8) continue;
      if (inBay(x, y)) continue;
      drawSpeck(ctx, rng, n.biome, x, y);
    }
  }
}

function drawSpeck(ctx, rng, biome, x, y) {
  switch (biome) {
    case 'forest': { // tiny conifer
      const s = 3 + rng() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x - s * 0.7, y + s * 0.6);
      ctx.lineTo(x + s * 0.7, y + s * 0.6);
      ctx.closePath();
      ctx.fillStyle = `rgba(${TINT.forest}, 0.11)`;
      ctx.fill();
      break;
    }
    case 'wetlands': { // marsh ripple
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.quadraticCurveTo(x, y - 3, x + 5, y);
      ctx.strokeStyle = `rgba(${TINT.wetlands}, 0.13)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'ruins': { // rubble block
      ctx.fillStyle = `rgba(${TINT.ruins}, 0.15)`;
      ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
      break;
    }
    case 'caverns': { // sinkhole ring
      ctx.beginPath();
      ctx.arc(x, y, 1.8 + rng() * 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${TINT.caverns}, 0.11)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'crypt': { // grave marker
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y + 2);
      ctx.moveTo(x - 2, y - 1.4);
      ctx.lineTo(x + 2, y - 1.4);
      ctx.strokeStyle = `rgba(${TINT.crypt}, 0.13)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
  }
}

// ── Mountains ────────────────────────────────────────────────

const RIDGES = [
  [962, 128, 5], [968, 214, 4], [958, 356, 5], [952, 452, 4],
  [852, 170, 3], [860, 400, 3], [908, 118, 3], [906, 452, 3],
];

function paintMountains(ctx, rng) {
  for (const [cx, cy, peaks] of RIDGES) ridge(ctx, rng, cx, cy, peaks);
  // faint elevation contours ringing the apex summit
  const apex = ATLAS.find((n) => n.id === 'apex');
  if (!apex) return;
  for (const r of [46, 64]) {
    ctx.beginPath();
    for (let i = 0; i <= 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rr = r + (rng() - 0.5) * 6;
      const x = apex.x + Math.cos(a) * rr;
      const y = apex.y + Math.sin(a) * rr * 0.9;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(${GOLD}, 0.10)`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function ridge(ctx, rng, cx, cy, peaks) {
  const w = peaks * 22;
  let x = cx - w / 2;
  ctx.beginPath();
  ctx.moveTo(x, cy);
  const tips = [];
  for (let i = 0; i < peaks; i++) {
    const px = x + 11 + rng() * 4;
    const py = cy - 12 - rng() * 12;
    ctx.lineTo(px, py);
    tips.push([px, py]);
    x += 22;
    ctx.lineTo(x, cy + (rng() - 0.5) * 5);
  }
  ctx.strokeStyle = `rgba(${RIDGE}, 0.16)`;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath(); // snow ticks on the tips
  for (const [px, py] of tips) {
    ctx.moveTo(px - 3, py + 3.5);
    ctx.lineTo(px, py + 1);
    ctx.lineTo(px + 3, py + 3.5);
  }
  ctx.strokeStyle = `rgba(${RIDGE}, 0.26)`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ── Landmarks near the class roots ───────────────────────────

function paintLandmarks(ctx) {
  const a = ATLAS.find((n) => n.id === 't1a');
  const b = ATLAS.find((n) => n.id === 't1b');
  const c = ATLAS.find((n) => n.id === 't1c');
  if (a) stones(ctx, a.x + 42, a.y + 40);   // standing stones (druid)
  if (b) tower(ctx, b.x + 34, b.y - 34);    // ruined tower (archer)
  if (c) temple(ctx, c.x + 46, c.y + 40);   // temple silhouette (mage)
}

function tower(ctx, x, y) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 5, y);
  ctx.lineTo(x - 5, y - 15);
  ctx.lineTo(x - 2, y - 13); // broken crown
  ctx.lineTo(x, y - 18);
  ctx.lineTo(x + 3, y - 12);
  ctx.lineTo(x + 5, y - 14);
  ctx.lineTo(x + 5, y);
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 4); // door slit
  ctx.moveTo(x + 8, y + 1);
  ctx.lineTo(x + 10, y + 1); // fallen block
  ctx.stroke();
}

function temple(ctx, x, y) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 9, y - 8); // pediment
  ctx.lineTo(x, y - 13);
  ctx.lineTo(x + 9, y - 8);
  ctx.moveTo(x - 8, y - 8);
  ctx.lineTo(x + 8, y - 8);
  for (const dx of [-6, 0, 6]) { // columns
    ctx.moveTo(x + dx, y - 7);
    ctx.lineTo(x + dx, y);
  }
  ctx.moveTo(x - 8, y);
  ctx.lineTo(x + 8, y);
  ctx.stroke();
}

function stones(ctx, x, y) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [dx, h, lean] of [[-7, 6, -1.5], [0, 9, 0.5], [7, 5, 2]]) {
    ctx.moveTo(x + dx, y);
    ctx.lineTo(x + dx + lean, y - h);
  }
  ctx.stroke();
}

// ── Ornaments ────────────────────────────────────────────────

function paintCompass(ctx, x, y) {
  ctx.strokeStyle = `rgba(${GOLD}, 0.30)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? 11 : 5.5;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.stroke();
  ctx.beginPath(); // north needle
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x - 2.5, y - 7);
  ctx.lineTo(x + 2.5, y - 7);
  ctx.closePath();
  ctx.fillStyle = `rgba(${GOLD}, 0.35)`;
  ctx.fill();
}

function paintVignette(ctx) {
  const g = ctx.createRadialGradient(500, 270, 180, 500, 270, 640);
  g.addColorStop(0, 'rgba(4, 7, 20, 0)');
  g.addColorStop(1, 'rgba(4, 7, 20, 0.4)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
