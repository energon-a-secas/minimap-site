// ── Map generation ───────────────────────────────────────────
// Biome-shaped terrain on a tile grid: 0 wall, 1 floor, 2 water.
// Only value 1 is walkable; water gets shoreline outlines for free
// because edge segments trace every floor/non-floor boundary.
// Guarantees: entrance on the leftmost land, boss arena far away
// and always dry, waypoints on the walked path, BFS-verified
// connectivity with a carved repair tunnel as the last resort.

import { mulberry32, randInt, pick, clamp } from './utils.js';
import { BIOMES, RARITY } from './defs.js';
import { GRID_W, GRID_H, carveBiome, scatterDecor } from './shapes.js';

export { GRID_W, GRID_H };

const MODIFIERS = ['fast', 'tanky', 'deadly'];
const ARENA_R = 5; // boss arena radius: 11 tiles across, no water inside
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Generate a full map for an atlas node. Same seed -> same map. */
export function generateMap(seed, node) {
  const rng = mulberry32(seed);
  const biome = BIOMES[node.biome];
  const grid = new Uint8Array(GRID_W * GRID_H);

  // Biome silhouettes live in shapes.js; this file owns the guarantees
  const terrain = carveBiome(rng, grid, biome.id, biome.gen);
  keepMainland(grid, biome.id);

  const ent = pickEntrance(grid);
  const bossT = pickBoss(grid, ent);
  carveArena(grid, bossT.x, bossT.y);
  ensureReachable(grid, ent, [bossT]);

  const entrance = { x: ent.x + 0.5, y: ent.y + 0.5 };
  const bossPos = { x: bossT.x + 0.5, y: bossT.y + 0.5 };
  const bossRoom = {
    x: bossT.x - ARENA_R, y: bossT.y - ARENA_R,
    w: ARENA_R * 2 + 1, h: ARENA_R * 2 + 1, cx: bossPos.x, cy: bossPos.y,
  };

  const waypoints = placeWaypoints(grid, ent, bossT, entrance);
  const spawns = buildSpawns(rng, grid, ent, node.tier);
  const decor = scatterDecor(rng, grid, biome.id, terrain);

  const monsterLevel = 80 + node.tier * 2;
  return {
    w: GRID_W, h: GRID_H, grid,
    seed, biome: biome.id, tier: node.tier, nodeId: node.id,
    name: node.name, bossName: node.boss, monsterLevel,
    quest: biome.quest,
    entrance, bossPos, bossRoom,
    waypoints, spawns, decor,
    segs: buildEdgeSegments(grid),
    rarity: RARITY,
  };
}

// ── Guarantees ──

/** BFS over walkable floor (=== 1 only). dist -1 = unreachable. */
function bfsFrom(grid, sx, sy) {
  const dist = new Int32Array(grid.length).fill(-1);
  const parent = new Int32Array(grid.length).fill(-1);
  const start = sy * GRID_W + sx;
  if (grid[start] !== 1) return { dist, parent };
  dist[start] = 0;
  parent[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const x = cur % GRID_W, y = (cur / GRID_W) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const ni = ny * GRID_W + nx;
      if (grid[ni] !== 1 || dist[ni] !== -1) continue;
      dist[ni] = dist[cur] + 1;
      parent[ni] = cur;
      queue.push(ni);
    }
  }
  return { dist, parent };
}

/** Keep the largest walkable component; orphans become scenery. */
function keepMainland(grid, biomeId) {
  const comp = new Int32Array(grid.length).fill(-1);
  let bestId = -1, bestSize = 0, id = 0;
  const queue = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== 1 || comp[i] !== -1) continue;
    let size = 0;
    comp[i] = id;
    queue.length = 0;
    queue.push(i);
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      size++;
      const x = cur % GRID_W, y = (cur / GRID_W) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
        const ni = ny * GRID_W + nx;
        if (grid[ni] === 1 && comp[ni] === -1) { comp[ni] = id; queue.push(ni); }
      }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id++;
  }
  const orphanFill = biomeId === 'wetlands' ? 2 : 0; // sunken isles read as shallows
  for (let i = 0; i < grid.length; i++)
    if (grid[i] === 1 && comp[i] !== bestId) grid[i] = orphanFill;
}

/** Leftmost pocket of land, with a carved 3x3 landing so spawning is safe. */
function pickEntrance(grid) {
  let minX = -1;
  for (let x = 1; x < GRID_W - 1 && minX < 0; x++)
    for (let y = 1; y < GRID_H - 1; y++)
      if (grid[y * GRID_W + x] === 1) { minX = x; break; }
  if (minX < 0) minX = 4; // barren carver output: invent a ledge, repair owns the rest
  let best = null, bestScore = -1;
  for (let x = minX; x < Math.min(minX + 4, GRID_W - 2); x++)
    for (let y = 2; y < GRID_H - 2; y++) {
      if (grid[y * GRID_W + x] !== 1) continue;
      let score = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx > 0 && ny > 0 && nx < GRID_W - 1 && ny < GRID_H - 1 &&
              grid[ny * GRID_W + nx] === 1) score++;
        }
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  if (!best) best = { x: clamp(minX, 2, GRID_W - 3), y: GRID_H >> 1 };
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = clamp(best.x + dx, 1, GRID_W - 2), ny = clamp(best.y + dy, 1, GRID_H - 2);
      grid[ny * GRID_W + nx] = 1;
    }
  return best;
}

/** Farthest-by-walk floor tile that still fits the whole arena circle. */
function pickBoss(grid, ent) {
  const { dist } = bfsFrom(grid, ent.x, ent.y);
  let best = null, bestD = -1;
  for (let y = ARENA_R + 1; y < GRID_H - ARENA_R - 1; y++)
    for (let x = ARENA_R + 1; x < GRID_W - ARENA_R - 1; x++) {
      const d = dist[y * GRID_W + x];
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
  if (!best) best = { x: GRID_W - ARENA_R - 3, y: GRID_H >> 1 };
  return best;
}

/** Open circular fight space: all floor, no water, room to dodge. */
function carveArena(grid, cx, cy) {
  const r2 = ARENA_R * ARENA_R + 2;
  for (let dy = -ARENA_R; dy <= ARENA_R; dy++)
    for (let dx = -ARENA_R; dx <= ARENA_R; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx, y = cy + dy;
      if (x > 0 && y > 0 && x < GRID_W - 1 && y < GRID_H - 1) grid[y * GRID_W + x] = 1;
    }
}

/** Connectivity is sacred: BFS-verify targets, carve a repair tunnel if not. */
function ensureReachable(grid, ent, targets) {
  for (let round = 0; round < 4; round++) {
    const { dist } = bfsFrom(grid, ent.x, ent.y);
    const missing = targets.filter((t) => dist[t.y * GRID_W + t.x] < 0);
    if (!missing.length) return;
    for (const t of missing) tunnel(grid, ent.x, ent.y, t.x, t.y);
  }
}

/** Straight 2-wide land tunnel; overlapping 2x2 stamps stay 4-connected. */
function tunnel(grid, x1, y1, x2, y2) {
  const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x1 + (x2 - x1) * (i / n));
    const y = Math.round(y1 + (y2 - y1) * (i / n));
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const tx = clamp(x + dx, 1, GRID_W - 2), ty = clamp(y + dy, 1, GRID_H - 2);
        grid[ty * GRID_W + tx] = 1;
      }
  }
}

/** Entrance plus stones near 45% / 75% of the walked path to the boss. */
function placeWaypoints(grid, ent, bossT, entrance) {
  const waypoints = [{ id: 'wp0', name: 'Entrance', x: entrance.x, y: entrance.y }];
  const { dist, parent } = bfsFrom(grid, ent.x, ent.y);
  const start = ent.y * GRID_W + ent.x;
  let cur = bossT.y * GRID_W + bossT.x;
  const chain = [];
  if (dist[cur] > 0) {
    while (cur !== start) { chain.push(cur); cur = parent[cur]; }
    chain.reverse();
  }
  for (const [frac, label] of [[0.45, 'Halfway Stone'], [0.75, 'Almost There']]) {
    const i = chain.length ? clamp(Math.round(chain.length * frac) - 1, 0, chain.length - 1) : 0;
    const t = chain.length ? chain[i] : start;
    waypoints.push({
      id: 'wp' + waypoints.length, name: label,
      x: (t % GRID_W) + 0.5, y: ((t / GRID_W) | 0) + 0.5,
    });
  }
  return waypoints;
}

// ── Enemy packs ──

/** Packs of 3-6 on open floor, never near the entrance, leader may upgrade. */
function buildSpawns(rng, grid, ent, tier) {
  const { dist } = bfsFrom(grid, ent.x, ent.y);
  let floorCount = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === 1) floorCount++;
  const packTarget = clamp(Math.round(floorCount / 100) + tier, 12, 32);
  const spawns = [];
  let made = 0, guard = 0;
  while (made < packTarget && guard < 900) {
    guard++;
    const x = randInt(rng, 2, GRID_W - 3), y = randInt(rng, 2, GRID_H - 3);
    const i = y * GRID_W + x;
    if (grid[i] !== 1 || dist[i] < 9) continue; // reachable, entrance stays safe
    const cx = x + 0.5, cy = y + 0.5;
    if (Math.hypot(cx - ent.x - 0.5, cy - ent.y - 0.5) < 9.5) continue;
    if (!canStand(grid, cx, cy, 0.45)) continue;
    const size = randInt(rng, 3, 6);
    const roll = rng();
    const leaderRarity = roll < 0.08 + tier * 0.01 ? 'rare' : roll < 0.32 ? 'magic' : 'normal';
    for (let m = 0; m < size; m++) {
      let mx = cx + (rng() - 0.5) * 3, my = cy + (rng() - 0.5) * 3;
      if (!canStand(grid, mx, my, 0.35)) { mx = cx; my = cy; }
      const rarity = m === 0 ? leaderRarity : 'normal';
      spawns.push({
        x: mx, y: my, rarity,
        mod: rarity === 'normal' ? null : pick(rng, MODIFIERS),
      });
    }
    made++;
  }
  return spawns;
}

// ── Renderer + movement queries (public contract) ──

/** One segment per floor/non-floor boundary, tagged with its floor tile
    for fog checks. Water tiles get shoreline outlines from the floor side. */
function buildEdgeSegments(grid) {
  const segs = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const idx = y * GRID_W + x;
      if (grid[idx] !== 1) continue;
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
  if (grid[start] !== 1) return null;
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
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const ni = ny * GRID_W + nx;
      if (grid[ni] !== 1 || parent[ni] !== -1) continue;
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
