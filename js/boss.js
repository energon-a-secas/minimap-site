// ── Boss fight ───────────────────────────────────────────────
// Activation, telegraphed slams, and add waves. The engine
// injects hitPlayer/makeEnemy to avoid a circular import.

import { canStand } from './mapgen.js';
import { dist, mulberry32 } from './utils.js';
import { toastXp } from './hud.js';

let deps = null; // { hitPlayer(run, dmg, e), makeEnemy(map, x, y, rarity, mod) }
export function wireBoss(d) { deps = d; }

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
      if (dist(p.x, p.y, tg.x, tg.y) <= tg.r) deps.hitPlayer(run, b.dmg * 2.2, { hitCd: 0 });
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
