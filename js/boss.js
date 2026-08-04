// ── Enemies & boss ───────────────────────────────────────────
// Regular-enemy chase AI with pack separation, plus the boss
// fight: activation, telegraphed slams, and add waves. The
// engine injects hitPlayer/makeEnemy to avoid a circular import.

import { canStand } from './mapgen.js';
import { dist, mulberry32 } from './utils.js';
import { toastXp } from './hud.js';

let deps = null; // { hitPlayer(run, dmg, e), makeEnemy(map, x, y, rarity, mod) }
export function wireBoss(d) { deps = d; }

const AGGRO = 11;
const CONTACT = 1.0;
const SEP_R = 0.85;    // tiles: enemies closer than this push apart
const SEP_ACTIVE = 25; // tiles: only separate packs near the player
const SEP_FORCE = 2.2; // tiles/s of push at full overlap

export function updateEnemies(run, dt) {
  const p = run.player;
  for (const e of run.enemies) {
    if (e.dead) continue;
    if (e.flashT > 0) e.flashT = Math.max(0, e.flashT - dt); // hit flash fades
    if (e.slowT > 0) e.slowT -= dt;
    if (e.snareT > 0) { e.snareT -= dt; continue; }
    if (e.hitCd > 0) e.hitCd -= dt;

    const d = dist(e.x, e.y, p.x, p.y);
    const aggro = e.isBoss ? 13 : AGGRO;
    if (d > aggro || d < CONTACT * 0.7) {
      // in contact: bite
      if (d < CONTACT && e.hitCd <= 0) deps.hitPlayer(run, e.dmg, e);
      continue;
    }
    let sp = e.speed * (e.slowT > 0 ? 1 - e.slowAmt : 1);
    if (e.isBoss) sp *= 0.85;
    const vx = ((p.x - e.x) / d) * sp * dt;
    const vy = ((p.y - e.y) / d) * sp * dt;
    const nx = e.x + vx;
    if (canStand(run.map.grid, nx, e.y, 0.35)) e.x = nx;
    const ny = e.y + vy;
    if (canStand(run.map.grid, e.x, ny, 0.35)) e.y = ny;
    if (dist(e.x, e.y, p.x, p.y) < CONTACT && e.hitCd <= 0) deps.hitPlayer(run, e.dmg, e);
  }
  separateEnemies(run, dt);
}

/** Packs softly push apart so they read as distinct dots. Only pairs
    near the player, deterministic, capped, never pushed into walls. */
function separateEnemies(run, dt) {
  const p = run.player;
  const near = [];
  for (const e of run.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    if (dx * dx + dy * dy <= SEP_ACTIVE * SEP_ACTIVE) near.push(e);
  }
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= SEP_R * SEP_R) continue;
      if (d2 < 1e-6) { dx = 0.01; dy = 0; } // exact overlap: fixed nudge axis
      const d = Math.sqrt(dx * dx + dy * dy);
      const push = SEP_FORCE * (1 - d / SEP_R) * dt;
      nudgeEnemy(run, a, (-dx / d) * push, (-dy / d) * push);
      nudgeEnemy(run, b, (dx / d) * push, (dy / d) * push);
    }
  }
}

/** Axis-wise nudge that respects walls; the boss never budges. */
function nudgeEnemy(run, e, mx, my) {
  if (e.isBoss) return;
  const nx = e.x + mx;
  if (canStand(run.map.grid, nx, e.y, 0.35)) e.x = nx;
  const ny = e.y + my;
  if (canStand(run.map.grid, e.x, ny, 0.35)) e.y = ny;
}

export function updateBoss(run, dt) {
  const b = run.boss;
  if (!b || b.dead) return;
  const p = run.player;
  const d = dist(b.x, b.y, p.x, p.y);

  if (!run.bossShown && d < 14) run.bossShown = true;
  if (!run.bossShown) return;

  // adds at 66% / 33%
  const frac = b.hp / b.maxHp;
  if (frac < 0.66 && !b.adds.t66) { b.adds.t66 = true; spawnAdds(run, b, 5); }
  if (frac < 0.33 && !b.adds.t33) { b.adds.t33 = true; spawnAdds(run, b, 6); }

  // telegraphed slams
  if (d < 15) {
    b.slamTimer -= dt;
    if (b.slamTimer <= 0) {
      b.slamTimer = Math.max(2.4, 4.2 - run.tier * 0.15);
      const n = 1 + (b.adds.t66 ? 1 : 0) + (b.adds.t33 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        b.telegraphs.push({
          x: i === 0 ? p.x : p.x + (Math.random() - 0.5) * 6,
          y: i === 0 ? p.y : p.y + (Math.random() - 0.5) * 6,
          r: 2.6, t: 0, dur: 1.15,
        });
      }
    }
  }
  for (const tg of b.telegraphs) {
    tg.t += dt;
    if (tg.t >= tg.dur && !tg.fired) {
      tg.fired = true;
      run.vfx.push({ type: 'slam', x: tg.x, y: tg.y, radius: tg.r, t: 0, dur: 0.35 });
      if (dist(p.x, p.y, tg.x, tg.y) <= tg.r) {
        deps.hitPlayer(run, b.dmg * 2.2, { hitCd: 0 });
        if (p.rollT <= 0) run.shakeMag = Math.max(run.shakeMag || 0, 0.45); // only when it lands
      }
    }
  }
  b.telegraphs = b.telegraphs.filter((tg) => tg.t < tg.dur + 0.1);
}

function spawnAdds(run, b, n) {
  const rng = mulberry32((run.map.seed ^ (n * 7919)) >>> 0);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const x = b.x + Math.cos(ang) * (2 + rng() * 2);
    const y = b.y + Math.sin(ang) * (2 + rng() * 2);
    if (canStand(run.map.grid, x, y, 0.35)) {
      run.enemies.push(deps.makeEnemy(run.map, x, y, 'normal', null));
    }
  }
  toastXp(`${run.map.bossName} calls for backup.`);
}
