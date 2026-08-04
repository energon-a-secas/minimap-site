// ── Biome terrain shapes ─────────────────────────────────────
// Per-biome carvers that stamp organic silhouettes onto the tile
// grid (0 wall, 1 floor, 2 impassable water) plus the decor pass.
// Carvers only shape terrain; mapgen.js owns every guarantee
// (mainland, entrance, boss arena, connectivity repair).

import { randInt, pick, clamp } from './utils.js';

export const GRID_W = 96;
export const GRID_H = 64;
const W = GRID_W, H = GRID_H;

// ── Tile helpers (all writes keep a 1-tile solid border) ──

function get(grid, x, y) {
  return x < 0 || y < 0 || x >= W || y >= H ? 0 : grid[y * W + x];
}

function set(grid, x, y, v) {
  if (x >= 1 && x <= W - 2 && y >= 1 && y <= H - 2) grid[y * W + x] = v;
}

function fillRect(grid, x, y, w, h, v) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(grid, i, j, v);
}

/** Count 4-neighbors holding value v. */
function adj4(grid, x, y, v) {
  return (get(grid, x + 1, y) === v) + (get(grid, x - 1, y) === v) +
         (get(grid, x, y + 1) === v) + (get(grid, x, y - 1) === v);
}

/** Jittered ellipse: 12 radial spokes wobble the edge so blobs read organic. */
function carveBlob(grid, rng, cx, cy, rx, ry, val) {
  const S = 12, radii = [];
  for (let i = 0; i < S; i++) radii.push(0.72 + rng() * 0.45);
  const m = Math.ceil(Math.max(rx, ry) * 1.2) + 1;
  for (let y = Math.floor(cy) - m; y <= Math.ceil(cy) + m; y++) {
    for (let x = Math.floor(cx) - m; x <= Math.ceil(cx) + m; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const d = Math.hypot(dx, dy);
      if (d > 1.2) continue;
      const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) * S;
      const i0 = Math.floor(a) % S, t = a - Math.floor(a);
      if (d <= radii[i0] * (1 - t) + radii[(i0 + 1) % S] * t) set(grid, x, y, val);
    }
  }
}

function stampDisc(grid, cx, cy, r, val) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) set(grid, x, y, val);
}

/** Contiguous stamp between two points: half-tile disc steps, no gaps. */
function stampSeg(grid, x1, y1, x2, y2, r, val) {
  const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
  for (let i = 0; i <= n; i++)
    stampDisc(grid, x1 + (x2 - x1) * (i / n), y1 + (y2 - y1) * (i / n), r, val);
}

/** Winding band between two points: sine sway pinned at both endpoints. */
function carveBand(grid, rng, x1, y1, x2, y2, width, wobble, val) {
  const d = Math.hypot(x2 - x1, y2 - y1) || 1;
  const px = -(y2 - y1) / d, py = (x2 - x1) / d;
  const amp = wobble * (1.5 + rng() * 2.5);
  const phase = rng() * Math.PI * 2, freq = 1 + rng() * 1.5;
  const steps = Math.max(2, Math.ceil(d));
  const r = width / 2 + 0.35;
  let lx = x1, ly = y1;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const off = Math.sin(phase + t * freq * Math.PI * 2) * amp * Math.sin(t * Math.PI);
    const x = x1 + (x2 - x1) * t + px * off;
    const y = y1 + (y2 - y1) * t + py * off;
    stampSeg(grid, lx, ly, x, y, r, val);
    lx = x; ly = y;
  }
}

// ── Caverns: cellular-automata caves + a couple of tiny pools ──

function cavernsCarve(rng, grid) {
  // Random fill ~45% wall, then majority smoothing rounds the noise
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      grid[y * W + x] =
        x < 2 || y < 2 || x >= W - 2 || y >= H - 2 ? 0 : rng() < 0.46 ? 0 : 1;
  const buf = new Uint8Array(grid.length);
  for (let pass = 0; pass < 5; pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Classic 4-5 rule: count walls in the whole 3x3 block, self included
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (get(grid, x + dx, y + dy) !== 1) walls++;
        buf[y * W + x] =
          x < 2 || y < 2 || x >= W - 2 || y >= H - 2 ? 0 : walls >= 5 ? 0 : 1;
      }
    }
    grid.set(buf);
  }
  // Overly open caves get eroded: keeps floor under the 60% budget
  for (let extra = 0; extra < 2; extra++) {
    let floor = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] === 1) floor++;
    if (floor <= grid.length * 0.55) break;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (get(grid, x + dx, y + dy) !== 1) walls++;
        buf[y * W + x] =
          x < 2 || y < 2 || x >= W - 2 || y >= H - 2 ? 0 : walls >= 4 ? 0 : 1;
      }
    }
    grid.set(buf);
  }
  // Tiny water pools: flavor only, mainland pass may trim strays
  const pools = randInt(rng, 2, 3);
  for (let p = 0; p < pools; p++) {
    for (let a = 0; a < 40; a++) {
      const x = randInt(rng, 8, W - 9), y = randInt(rng, 8, H - 9);
      if (grid[y * W + x] !== 1) continue;
      const r = 1.4 + rng() * 1.1;
      carveBlob(grid, rng, x, y, r, r, 2);
      break;
    }
  }
}

// ── Wetlands: island blobs in open water, causeways between ──

function wetlandsCarve(rng, grid, gen) {
  grid.fill(2);
  const n = Math.max(8, Math.round(gen.rooms * 0.8));
  const isles = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const cx = clamp(Math.round(7 + t * (W - 15) + (rng() - 0.5) * 9), 6, W - 7);
    const cy = clamp(Math.round(H * 0.5 + (rng() - 0.5) * H * 0.7), 6, H - 7);
    const lobes = randInt(rng, 2, 3);
    for (let b = 0; b < lobes; b++)
      carveBlob(grid, rng, cx + (rng() - 0.5) * 5, cy + (rng() - 0.5) * 4,
        3.6 + rng() * 3, 2.8 + rng() * 2.4, 1);
    isles.push({ x: cx, y: cy });
  }
  // Land routes always exist: chain plus a couple of skip links
  for (let i = 1; i < n; i++)
    carveBand(grid, rng, isles[i - 1].x, isles[i - 1].y, isles[i].x, isles[i].y, 2, gen.wind, 1);
  for (let k = 0; k < 2; k++) {
    const i = randInt(rng, 0, n - 3);
    carveBand(grid, rng, isles[i].x, isles[i].y, isles[i + 2].x, isles[i + 2].y, 2, gen.wind, 1);
  }
  // Inland ponds only where a fat ring of land protects the route
  for (let p = 0; p < 2; p++) {
    for (let a = 0; a < 50; a++) {
      const x = randInt(rng, 8, W - 9), y = randInt(rng, 8, H - 9);
      if (!ringIsLand(grid, x, y, 4)) continue;
      carveBlob(grid, rng, x, y, 1.8, 1.5, 2);
      break;
    }
  }
}

function ringIsLand(grid, cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if (get(grid, x, y) !== 1) return false;
  return true;
}

// ── Forest: elliptical clearings joined by winding paths ──

function forestCarve(rng, grid, gen) {
  grid.fill(0);
  const n = Math.max(9, Math.round(gen.rooms * 0.7));
  const glades = [];
  const meander = 1 + rng() * 1.2, mphase = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const cx = clamp(Math.round(8 + t * (W - 17) + (rng() - 0.5) * 7), 6, W - 7);
    const cy = clamp(Math.round(H * 0.5 +
      Math.sin(mphase + t * meander * Math.PI * 2) * H * 0.26 + (rng() - 0.5) * 8), 6, H - 7);
    carveBlob(grid, rng, cx, cy, 4.2 + rng() * 4, 3.2 + rng() * 3, 1);
    glades.push({ x: cx, y: cy });
  }
  for (let i = 1; i < n; i++)
    carveBand(grid, rng, glades[i - 1].x, glades[i - 1].y, glades[i].x, glades[i].y, 2, gen.wind * 2.2, 1);
  for (let k = 0; k < 3; k++) {
    const i = randInt(rng, 0, n - 3), j = i + randInt(rng, 2, Math.min(3, n - 1 - i));
    carveBand(grid, rng, glades[i].x, glades[i].y, glades[j].x, glades[j].y, 2, gen.wind * 2.2, 1);
  }
}

// ── Ruins: angular halls with L-bites, pillars, broken walls ──

function ruinsCarve(rng, grid, gen) {
  grid.fill(0);
  const rooms = [];
  let attempts = 0;
  while (rooms.length < gen.rooms && attempts < 600) {
    attempts++;
    // Rooms shrink under placement pressure so dense seeds still fill out
    const maxSide = attempts > 300 ? gen.roomMin + 3 : gen.roomMax;
    const w = randInt(rng, gen.roomMin, maxSide);
    const h = randInt(rng, gen.roomMin, maxSide);
    // First room anchors the left edge: the entrance always has a hall
    const x = rooms.length === 0 ? randInt(rng, 2, 10) : randInt(rng, 2, W - w - 3);
    const y = randInt(rng, 2, H - h - 3);
    if (rooms.some((r) => r.x - 2 < x + w && r.x + r.w + 2 > x &&
                          r.y - 2 < y + h && r.y + r.h + 2 > y)) continue;
    fillRect(grid, x, y, w, h, 1);
    if (rng() < 0.45) {
      // Bite a corner back out: L-shaped hall
      const bw = Math.max(2, Math.round(w * (0.35 + rng() * 0.2)));
      const bh = Math.max(2, Math.round(h * (0.35 + rng() * 0.2)));
      fillRect(grid, rng() < 0.5 ? x : x + w - bw, rng() < 0.5 ? y : y + h - bh, bw, bh, 0);
    }
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
  }
  // Corridors stay straight and angular on purpose (the contrast biome)
  for (let i = 1; i < rooms.length; i++) {
    let best = rooms[0], bd = Infinity;
    for (let j = 0; j < i; j++) {
      const dd = Math.hypot(rooms[j].cx - rooms[i].cx, rooms[j].cy - rooms[i].cy);
      if (dd < bd) { bd = dd; best = rooms[j]; }
    }
    lCorridor(grid, rng, rooms[i].cx, rooms[i].cy, best.cx, best.cy);
  }
  // Interior pillar columns: wall tiles the renderer outlines
  const pillars = [];
  for (const r of rooms) {
    if (r.w < 7 || r.h < 7) continue;
    for (let gy = r.y + 2; gy <= r.y + r.h - 3; gy += 3)
      for (let gx = r.x + 2; gx <= r.x + r.w - 3; gx += 3) {
        if (rng() >= 0.6 || !openAround(grid, gx, gy)) continue;
        set(grid, gx, gy, 0);
        pillars.push({ x: gx, y: gy });
      }
  }
  // Partial partitions: a broken wall line with a doorway gap
  for (const r of rooms) {
    if (rng() >= 0.35 || r.w < 8 || r.h < 8) continue;
    if (rng() < 0.5) {
      const wx = r.x + randInt(rng, 3, r.w - 4);
      const gap = randInt(rng, r.y + 1, r.y + r.h - 4);
      for (let y = r.y; y < r.y + r.h; y++)
        if ((y < gap || y > gap + 2) && grid[y * W + wx] === 1 &&
            !pillars.some((p) => p.x === wx && p.y === y)) set(grid, wx, y, 0);
    } else {
      const wy = r.y + randInt(rng, 3, r.h - 4);
      const gap = randInt(rng, r.x + 1, r.x + r.w - 4);
      for (let x = r.x; x < r.x + r.w; x++)
        if ((x < gap || x > gap + 2) && grid[wy * W + x] === 1 &&
            !pillars.some((p) => p.x === x && p.y === wy)) set(grid, x, wy, 0);
    }
  }
  // Weathering: chip stray wall tiles off the hall edges
  const chips = randInt(rng, 16, 26);
  for (let c = 0; c < chips; c++) {
    const x = randInt(rng, 2, W - 3), y = randInt(rng, 2, H - 3);
    if (grid[y * W + x] === 0 && adj4(grid, x, y, 1) >= 1) set(grid, x, y, 1);
  }
  return { pillars };
}

function openAround(grid, x, y) {
  if (grid[y * W + x] !== 1) return false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (get(grid, x + dx, y + dy) !== 1) return false;
  return true;
}

function lCorridor(grid, rng, x1, y1, x2, y2) {
  const mx = rng() < 0.5 ? x2 : x1, my = mx === x2 ? y1 : y2;
  hallLine(grid, x1, y1, mx, my);
  hallLine(grid, mx, my, x2, y2);
}

function hallLine(grid, x1, y1, x2, y2) {
  let x = x1, y = y1;
  const sx = Math.sign(x2 - x1) || 1;
  while (x !== x2) { fillRect(grid, x, y, 2, 2, 1); x += sx; }
  const sy = Math.sign(y2 - y1) || 1;
  while (y !== y2) { fillRect(grid, x, y, 2, 2, 1); y += sy; }
  fillRect(grid, x2, y2, 2, 2, 1);
}

// ── Crypt: thin maze halls (backtracker on 2x2 cells, pitch 3) ──

function cryptCarve(rng, grid) {
  grid.fill(0);
  const M = 2, P = 3;
  const cw = Math.floor((W - M * 2 + 1) / P), ch = Math.floor((H - M * 2 + 1) / P);
  const tx = (i) => M + i * P, ty = (j) => M + j * P;
  const visited = new Uint8Array(cw * ch);
  // Pre-block some cells: solid piers the maze must route around
  for (let c = 0; c < cw * ch; c++) if (rng() < 0.12) visited[c] = 1;
  const openLink = (i, j, di, dj, wide) => {
    if (di) {
      const x = di > 0 ? tx(i) + 2 : tx(i) - 1, y = ty(j);
      if (wide) { set(grid, x, y, 1); set(grid, x, y + 1, 1); }
      else set(grid, x, y + (rng() < 0.5 ? 0 : 1), 1);
    } else {
      const y = dj > 0 ? ty(j) + 2 : ty(j) - 1, x = tx(i);
      if (wide) { set(grid, x, y, 1); set(grid, x + 1, y, 1); }
      else set(grid, x + (rng() < 0.5 ? 0 : 1), y, 1);
    }
  };
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let si = randInt(rng, 0, cw - 1), sj = randInt(rng, 0, ch - 1);
  while (visited[sj * cw + si]) { si = randInt(rng, 0, cw - 1); sj = randInt(rng, 0, ch - 1); }
  visited[sj * cw + si] = 1;
  fillRect(grid, tx(si), ty(sj), 2, 2, 1);
  const stack = [[si, sj]];
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const opts = DIRS.filter(([di, dj]) => {
      const ni = i + di, nj = j + dj;
      return ni >= 0 && nj >= 0 && ni < cw && nj < ch && !visited[nj * cw + ni];
    });
    if (!opts.length) { stack.pop(); continue; }
    const [di, dj] = pick(rng, opts);
    visited[(j + dj) * cw + (i + di)] = 1;
    fillRect(grid, tx(i + di), ty(j + dj), 2, 2, 1);
    openLink(i, j, di, dj, rng() < 0.55);
    stack.push([i + di, j + dj]);
  }
  const linkOpen = (i, j, di, dj) => {
    if (di) {
      const x = di > 0 ? tx(i) + 2 : tx(i) - 1;
      return get(grid, x, ty(j)) === 1 || get(grid, x, ty(j) + 1) === 1;
    }
    const y = dj > 0 ? ty(j) + 2 : ty(j) - 1;
    return get(grid, tx(i), y) === 1 || get(grid, tx(i) + 1, y) === 1;
  };
  // Braid a little: a maze, not a punishment
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      if (get(grid, tx(i), ty(j)) !== 1) continue;
      let links = 0;
      const closed = [];
      for (const [di, dj] of DIRS) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cw || nj >= ch) continue;
        if (linkOpen(i, j, di, dj)) links++;
        else if (get(grid, tx(ni), ty(nj)) === 1) closed.push([di, dj]);
      }
      if (links === 1 && closed.length && rng() < 0.35)
        openLink(i, j, ...pick(rng, closed), rng() < 0.4);
    }
  // Small burial chambers
  const chambers = randInt(rng, 5, 7);
  for (let c = 0; c < chambers; c++) {
    const i = randInt(rng, 1, cw - 2), j = randInt(rng, 1, ch - 2);
    const w = randInt(rng, 4, 6), h = randInt(rng, 4, 5);
    fillRect(grid, tx(i) - (w >> 1) + 1, ty(j) - (h >> 1) + 1, w, h, 1);
  }
}

// ── Dispatch + decor scatter ──

/** Stamp the biome silhouette. Returns carver extras (ruins pillars). */
export function carveBiome(rng, grid, biomeId, gen) {
  if (biomeId === 'caverns') return cavernsCarve(rng, grid);
  if (biomeId === 'wetlands') return wetlandsCarve(rng, grid, gen);
  if (biomeId === 'forest') return forestCarve(rng, grid, gen);
  if (biomeId === 'ruins') return ruinsCarve(rng, grid, gen);
  return cryptCarve(rng, grid);
}

/** Purely visual props on the final grid. Kinds the renderer knows:
    rubble | shroom | tree | pillar | crystal. */
export function scatterDecor(rng, grid, biomeId, terrain) {
  const decor = [], used = new Set();
  const put = (x, y, kind) => {
    const i = y * W + x;
    if (!used.has(i)) { used.add(i); decor.push({ x: x + 0.5, y: y + 0.5, kind }); }
  };
  const scatter = (tries, cap, kind, ok) => {
    let made = 0;
    for (let a = 0; a < tries && made < cap; a++) {
      const x = randInt(rng, 1, W - 2), y = randInt(rng, 1, H - 2);
      if (ok(x, y)) { put(x, y, kind); made++; }
    }
  };
  const floorHere = (x, y) => grid[y * W + x] === 1;
  if (biomeId === 'caverns') {
    scatter(140, 14, 'shroom', (x, y) => floorHere(x, y) && adj4(grid, x, y, 0) >= 1);
    scatter(140, 8, 'crystal', (x, y) => floorHere(x, y) && adj4(grid, x, y, 0) >= 2);
  } else if (biomeId === 'wetlands') {
    scatter(180, 16, 'tree', (x, y) => floorHere(x, y) && adj4(grid, x, y, 2) >= 1);
    scatter(80, 7, 'shroom', floorHere);
  } else if (biomeId === 'forest') {
    // Trees sit on wall tiles hugging the clearings: canopy edge
    scatter(420, 46, 'tree', (x, y) => grid[y * W + x] === 0 && adj4(grid, x, y, 1) >= 1);
    scatter(70, 6, 'shroom', (x, y) => floorHere(x, y) && adj4(grid, x, y, 0) >= 1);
  } else if (biomeId === 'ruins') {
    for (const p of (terrain && terrain.pillars) || [])
      if (grid[p.y * W + p.x] === 0 && adj4(grid, p.x, p.y, 1) >= 3) put(p.x, p.y, 'pillar');
    scatter(140, 12, 'rubble', (x, y) => floorHere(x, y) && adj4(grid, x, y, 0) >= 1);
  } else {
    scatter(180, 16, 'rubble', (x, y) => floorHere(x, y) && adj4(grid, x, y, 0) >= 1);
  }
  return decor;
}
