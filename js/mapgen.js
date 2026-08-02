// ── Map generation ───────────────────────────────────────────
// Seeded rooms-and-corridors digger on a tile grid. Guarantees:
// entrance waypoint -> mid waypoint(s) -> boss room at the far end.
// Also precomputes the wall-edge segments the renderer strokes.

import { mulberry32, randInt, pick, dist } from './utils.js';
import { BIOMES, RARITY } from './defs.js';

export const GRID_W = 96;
export const GRID_H = 64;

const MODIFIERS = ['fast', 'tanky', 'deadly'];

/** Generate a full map for an atlas node. Same seed -> same map. */
export function generateMap(seed, node) {
  const rng = mulberry32(seed);
  const biome = BIOMES[node.biome];
  const g = biome.gen;
  const grid = new Uint8Array(GRID_W * GRID_H);

  // ── Rooms ──
  const rooms = [];
  let attempts = 0;
  while (rooms.length < g.rooms && attempts < 400) {
    attempts++;
    const w = randInt(rng, g.roomMin, g.roomMax);
    const h = randInt(rng, g.roomMin, g.roomMax);
    const x = randInt(rng, 2, GRID_W - w - 3);
    const y = randInt(rng, 2, GRID_H - h - 3);
    const room = { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
    if (rooms.some((r) => overlaps(r, room, 2))) continue;
    rooms.push(room);
    carveRect(grid, x, y, w, h);
  }

  // ── Corridors: connect each room to the nearest already-connected one ──
  const connected = [rooms[0]];
  for (let i = 1; i < rooms.length; i++) {
    const room = rooms[i];
    let best = connected[0];
    for (const c of connected) {
      if (dist(room.cx, room.cy, c.cx, c.cy) < dist(room.cx, room.cy, best.cx, best.cy)) best = c;
    }
    carveCorridor(grid, rng, room.cx | 0, room.cy | 0, best.cx | 0, best.cy | 0, g.wind);
    connected.push(room);
  }

  // ── Entrance = leftmost room, boss = room farthest from entrance ──
  rooms.sort((a, b) => a.cx - b.cx);
  const entranceRoom = rooms[0];
  let bossRoom = rooms[0];
  for (const r of rooms) {
    if (dist(r.cx, r.cy, entranceRoom.cx, entranceRoom.cy) > dist(bossRoom.cx, bossRoom.cy, entranceRoom.cx, entranceRoom.cy)) bossRoom = r;
  }
  // Widen the boss arena so the telegraph dance has space
  carveRect(grid,
    Math.max(2, bossRoom.x - 2), Math.max(2, bossRoom.y - 2),
    Math.min(GRID_W - 4 - bossRoom.x + 2, bossRoom.w + 4),
    Math.min(GRID_H - 4 - bossRoom.y + 2, bossRoom.h + 4));

  // ── Waypoints: entrance + rooms near 45% and 75% of the way to the boss ──
  const maxD = dist(entranceRoom.cx, entranceRoom.cy, bossRoom.cx, bossRoom.cy);
  const waypoints = [{ id: 'wp0', name: 'Entrance', x: entranceRoom.cx, y: entranceRoom.cy }];
  for (const [frac, label] of [[0.45, 'Halfway Stone'], [0.75, 'Almost There']]) {
    let bestR = null, bestErr = Infinity;
    for (const r of rooms) {
      if (r === entranceRoom || r === bossRoom) continue;
      const err = Math.abs(dist(r.cx, r.cy, entranceRoom.cx, entranceRoom.cy) - maxD * frac);
      if (err < bestErr && !waypoints.some((w) => Math.abs(w.x - r.cx) < 4 && Math.abs(w.y - r.cy) < 4)) {
        bestErr = err; bestR = r;
      }
    }
    if (bestR) waypoints.push({ id: 'wp' + waypoints.length, name: label, x: bestR.cx, y: bestR.cy });
  }

  // ── Enemy packs per room (entrance stays safe) ──
  const spawns = [];
  for (const room of rooms) {
    if (room === entranceRoom) continue;
    const isBossRoom = room === bossRoom;
    const packs = isBossRoom ? 1 : randInt(rng, 2, 2 + Math.min(2, Math.ceil(node.tier / 3)));
    for (let p = 0; p < packs; p++) {
      const px = room.x + 1 + rng() * (room.w - 2);
      const py = room.y + 1 + rng() * (room.h - 2);
      const size = randInt(rng, 3, 5 + Math.ceil(node.tier / 3));
      const roll = rng();
      const leaderRarity = roll < 0.08 + node.tier * 0.01 ? 'rare' : roll < 0.32 ? 'magic' : 'normal';
      for (let m = 0; m < size; m++) {
        const rarity = m === 0 ? leaderRarity : 'normal';
        spawns.push({
          x: px + (rng() - 0.5) * 3, y: py + (rng() - 0.5) * 3,
          rarity,
          mod: rarity === 'normal' ? null : pick(rng, MODIFIERS),
        });
      }
    }
  }

  const monsterLevel = 80 + node.tier * 2;
  return {
    w: GRID_W, h: GRID_H, grid,
    seed, biome: biome.id, tier: node.tier, nodeId: node.id,
    name: node.name, bossName: node.boss, monsterLevel,
    quest: biome.quest,
    entrance: { x: entranceRoom.cx, y: entranceRoom.cy },
    bossPos: { x: bossRoom.cx, y: bossRoom.cy },
    bossRoom,
    waypoints, spawns,
    segs: buildEdgeSegments(grid),
    rarity: RARITY,
  };
}

function overlaps(a, b, pad) {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x &&
         a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

function carveRect(grid, x, y, w, h) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (i > 0 && i < GRID_W - 1 && j > 0 && j < GRID_H - 1) grid[j * GRID_W + i] = 1;
    }
  }
}

/** L-corridor with optional mid-point jitter; digs with a 2x2 brush. */
function carveCorridor(grid, rng, x1, y1, x2, y2, wind) {
  const points = [[x1, y1]];
  if (rng() < wind) {
    points.push([x1 + ((x2 - x1) * 0.5) | 0, y1 + (((rng() - 0.5) * 14) | 0)]);
  }
  points.push(rng() < 0.5 ? [x2, y1] : [x1, y2]);
  points.push([x2, y2]);
  for (let p = 0; p < points.length - 1; p++) {
    digLine(grid, points[p][0], points[p][1], points[p + 1][0], points[p + 1][1]);
  }
}

function digLine(grid, x1, y1, x2, y2) {
  let x = x1, y = y1;
  // horizontal then vertical, 2-wide
  const sx = Math.sign(x2 - x) || 1;
  while (x !== x2) { carveRect(grid, x, y, 2, 2); x += sx; }
  const sy = Math.sign(y2 - y) || 1;
  while (y !== y2) { carveRect(grid, x, y, 2, 2); y += sy; }
  carveRect(grid, x2, y2, 2, 2);
}

/** One segment per floor/wall boundary, tagged with its floor tile for fog checks. */
function buildEdgeSegments(grid) {
  const segs = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const idx = y * GRID_W + x;
      if (!grid[idx]) continue;
      if (!floorAt(grid, x, y - 1)) segs.push({ x1: x, y1: y, x2: x + 1, y2: y, tile: idx });
      if (!floorAt(grid, x, y + 1)) segs.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1, tile: idx });
      if (!floorAt(grid, x - 1, y)) segs.push({ x1: x, y1: y, x2: x, y2: y + 1, tile: idx });
      if (!floorAt(grid, x + 1, y)) segs.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, tile: idx });
    }
  }
  return segs;
}

export function floorAt(grid, x, y) {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return false;
  return grid[(y | 0) * GRID_W + (x | 0)] === 1;
}

/** BFS path between world points. Returns tile-center waypoints
    (start excluded, collinear points merged). Falls back to the
    reachable tile closest to the target when it sits in a wall. */
export function findPath(grid, sx, sy, tx, ty) {
  const start = (sy | 0) * GRID_W + (sx | 0);
  const goal = (ty | 0) * GRID_W + (tx | 0);
  if (!grid[start]) return null;
  const parent = new Int32Array(GRID_W * GRID_H).fill(-1);
  parent[start] = start;
  const queue = [start];
  let best = start, bestD = Infinity, found = false;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === goal) { found = true; break; }
    const cx = cur % GRID_W, cy = (cur / GRID_W) | 0;
    const dd = (cx - tx) * (cx - tx) + (cy - ty) * (cy - ty);
    if (dd < bestD) { bestD = dd; best = cur; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const ni = ny * GRID_W + nx;
      if (!grid[ni] || parent[ni] !== -1) continue;
      parent[ni] = cur;
      queue.push(ni);
    }
  }
  let end = found ? goal : best;
  if (parent[end] === -1) return null;
  const tiles = [];
  while (end !== start) { tiles.push(end); end = parent[end]; }
  tiles.reverse();
  const path = tiles.map((i) => ({ x: (i % GRID_W) + 0.5, y: ((i / GRID_W) | 0) + 0.5 }));
  // merge collinear runs so the walk looks smooth
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const prev = out[out.length - 2], a = out[out.length - 1], b = path[i];
    if (prev && a && Math.sign(a.x - prev.x) === Math.sign(b.x - a.x) &&
        Math.sign(a.y - prev.y) === Math.sign(b.y - a.y)) out[out.length - 1] = b;
    else out.push(b);
  }
  if (found) out[out.length - 1] = { x: tx, y: ty };
  return out;
}

/** Circle vs grid walkability for entity movement. */
export function canStand(grid, x, y, r) {
  return floorAt(grid, x - r, y) && floorAt(grid, x + r, y) &&
         floorAt(grid, x, y - r) && floorAt(grid, x, y + r) &&
         floorAt(grid, x, y);
}
