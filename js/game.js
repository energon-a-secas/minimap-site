// ── Game engine ──────────────────────────────────────────────
// Owns the live run: rAF loop, movement (click + WASD), combat,
// XP and death, boss fight, waypoints. Rendering is render.js,
// DOM overlay is hud.js.

import { state, save, activeChar, charStats, enemyStats, gainXp, applyDeathPenalty, monsterXp, clearNode } from './state.js';
import { CLASSES, RARITY, atlasNode, DEATH_LINES } from './defs.js';
import { generateMap, canStand, findPath } from './mapgen.js';
import { dist, clamp, distToSegment, pick, mulberry32 } from './utils.js';
import { drawFrame, paintBackdrop, resizeCanvases } from './render.js';
import { updateHud, initHudForRun, showDeath, hideDeath, showCleared, toastXp } from './hud.js';

const AGGRO = 11;
const CONTACT = 1.0;
const REVEAL_R = 9;
const PLAYER_R = 0.42;

let rafId = null;
let lastT = 0;

export function startRun(nodeId) {
  const char = activeChar(state);
  const node = atlasNode(nodeId);
  if (!char || !node) return;
  const map = generateMap((Math.random() * 2 ** 31) | 0, node);
  const stats = charStats(char);
  const cls = CLASSES[char.cls];

  const run = {
    map, char, cls, stats, tier: node.tier,
    player: {
      x: map.entrance.x, y: map.entrance.y,
      life: stats.maxLife, mana: stats.maxMana,
      atkTimer: 0, skillCd: 0, aim: { x: 1, y: 0 },
    },
    enemies: buildEnemies(map),
    vfx: [],
    seen: new Uint8Array(map.w * map.h),
    wpUnlocked: ['wp0'],
    input: { keys: {}, mouse: { down: false, x: 0, y: 0 }, target: null },
    camX: map.entrance.x, camY: map.entrance.y,
    over: null, cleared: false, bossShown: false,
    time: 0,
  };
  run.boss = run.enemies.find((e) => e.isBoss);
  state.run = run;

  resizeCanvases();
  paintBackdrop(map);
  initHudForRun(run);
  reveal(run);

  lastT = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function buildEnemies(map) {
  const list = map.spawns.map((sp) => makeEnemy(map, sp.x, sp.y, sp.rarity, sp.mod));
  const boss = makeEnemy(map, map.bossPos.x, map.bossPos.y, 'boss', null);
  boss.isBoss = true;
  boss.phase = 0;
  boss.slamTimer = 2.5;
  boss.telegraphs = [];
  boss.adds = { t66: false, t33: false };
  list.push(boss);
  return list;
}

function makeEnemy(map, x, y, rarity, mod) {
  const rdef = RARITY[rarity];
  const st = enemyStats(map.tier, rdef);
  const e = {
    x, y, rarity, mod, r: rdef.r,
    hp: st.hp, maxHp: st.hp, dmg: st.dmg, speed: st.speed,
    slowT: 0, slowAmt: 0, snareT: 0, hitCd: 0, dead: false,
  };
  if (mod === 'fast') e.speed *= 1.7;
  if (mod === 'tanky') { e.hp *= 1.8; e.maxHp = e.hp; }
  if (mod === 'deadly') e.dmg *= 1.8;
  return e;
}

export function stopRun() {
  cancelAnimationFrame(rafId);
  rafId = null;
  if (state.run) { save(state); state.run = null; }
}

// ── Main loop ────────────────────────────────────────────────

function tick(t) {
  const run = state.run;
  if (!run) return;
  const dt = clamp((t - lastT) / 1000, 0, 0.05);
  lastT = t;
  advance(run, dt);
  drawFrame(run);
  updateHud(run);
  rafId = requestAnimationFrame(tick);
}

function advance(run, dt) {
  run.time += dt;
  if (!run.over) {
    movePlayer(run, dt);
    updateEnemies(run, dt);
    updateCombat(run, dt);
    updateBoss(run, dt);
    regen(run, dt);
    checkWaypoints(run);
    reveal(run);
  }
  updateVfx(run, dt);
  run.camX += (run.player.x - run.camX) * Math.min(1, dt * 6);
  run.camY += (run.player.y - run.camY) * Math.min(1, dt * 6);
}

/** Advance the sim without rAF, in fixed 60fps slices. Used by
    automated tests (rAF pauses when the tab is hidden). */
export function debugStep(seconds) {
  const run = state.run;
  if (!run) return;
  for (let t = 0; t < seconds; t += 1 / 60) advance(run, 1 / 60);
  drawFrame(run);
  updateHud(run);
}

// ── Movement ─────────────────────────────────────────────────

/** Click-to-move destination: computes a BFS path through the maze. */
export function setMoveTarget(x, y) {
  const run = state.run;
  if (!run || run.over) return;
  run.input.target = { x, y };
  run.input.path = findPath(run.map.grid, run.player.x, run.player.y, x, y);
}

function movePlayer(run, dt) {
  const p = run.player;
  const { keys, mouse } = run.input;
  let vx = 0, vy = 0;
  if (keys.w || keys.arrowup) vy -= 1;
  if (keys.s || keys.arrowdown) vy += 1;
  if (keys.a || keys.arrowleft) vx -= 1;
  if (keys.d || keys.arrowright) vx += 1;

  if (vx || vy) {
    run.input.target = null;
    run.input.path = null;
  } else {
    if (mouse.down) {
      // held mouse: re-path toward the cursor a few times per second
      run.pathTimer = (run.pathTimer ?? 0) - dt;
      if (run.pathTimer <= 0) {
        run.pathTimer = 0.15;
        setMoveTarget(mouse.x, mouse.y);
      }
    }
    const path = run.input.path;
    if (path && path.length) {
      while (path.length && dist(p.x, p.y, path[0].x, path[0].y) < 0.35) path.shift();
      if (!path.length) {
        run.input.target = null;
        run.input.path = null;
      } else {
        const n = path[0];
        const d = dist(p.x, p.y, n.x, n.y) || 1;
        vx = (n.x - p.x) / d;
        vy = (n.y - p.y) / d;
      }
    }
  }
  if (!vx && !vy) return;

  const len = Math.hypot(vx, vy);
  vx /= len; vy /= len;
  p.aim = { x: vx, y: vy };
  const step = run.stats.speed * dt;
  // axis-separated so walls let you slide along them
  const nx = p.x + vx * step;
  if (canStand(run.map.grid, nx, p.y, PLAYER_R)) p.x = nx;
  const ny = p.y + vy * step;
  if (canStand(run.map.grid, p.x, ny, PLAYER_R)) p.y = ny;
}

// ── Enemies ──────────────────────────────────────────────────

function updateEnemies(run, dt) {
  const p = run.player;
  for (const e of run.enemies) {
    if (e.dead) continue;
    if (e.slowT > 0) e.slowT -= dt;
    if (e.snareT > 0) { e.snareT -= dt; continue; }
    if (e.hitCd > 0) e.hitCd -= dt;

    const d = dist(e.x, e.y, p.x, p.y);
    const aggro = e.isBoss ? 13 : AGGRO;
    if (d > aggro || d < CONTACT * 0.7) {
      // in contact: bite
      if (d < CONTACT && e.hitCd <= 0) hitPlayer(run, e.dmg, e);
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
    if (dist(e.x, e.y, p.x, p.y) < CONTACT && e.hitCd <= 0) hitPlayer(run, e.dmg, e);
  }
}

function hitPlayer(run, dmg, e) {
  e.hitCd = 0.9;
  run.player.life -= dmg;
  run.vfx.push({ type: 'hurt', x: run.player.x, y: run.player.y, t: 0, dur: 0.25 });
  if (run.player.life <= 0) onDeath(run);
}

// ── Player combat ────────────────────────────────────────────

function updateCombat(run, dt) {
  const p = run.player;
  if (p.atkTimer > 0) p.atkTimer -= dt;
  if (p.skillCd > 0) p.skillCd -= dt;
  if (p.atkTimer > 0) return;

  const target = nearestEnemy(run, run.cls.range);
  if (!target) return;
  p.atkTimer = run.cls.atkCd;
  const d = dist(p.x, p.y, target.x, target.y) || 1;
  p.aim = { x: (target.x - p.x) / d, y: (target.y - p.y) / d };

  // auto attack: main target + small cleave for melee-ish classes
  damageEnemy(run, target, run.stats.dmg);
  pushAttackVfx(run, target);
  if (run.cls.cleave) {
    for (const e of run.enemies) {
      if (e.dead || e === target) continue;
      if (dist(e.x, e.y, target.x, target.y) <= run.cls.cleave) damageEnemy(run, e, run.stats.dmg * 0.6);
    }
  }
}

function nearestEnemy(run, range) {
  const p = run.player;
  let best = null, bestD = range;
  for (const e of run.enemies) {
    if (e.dead) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d <= bestD) { best = e; bestD = d; }
  }
  return best;
}

function pushAttackVfx(run, target) {
  const p = run.player;
  const kind = run.cls.vfx; // thorn | arrow | frost
  run.vfx.push({ type: kind, x1: p.x, y1: p.y, x2: target.x, y2: target.y, t: 0, dur: kind === 'arrow' ? 0.18 : 0.28 });
}

export function useSkill() {
  const run = state.run;
  if (!run || run.over) return;
  const p = run.player;
  const sk = run.cls.skill;
  if (p.skillCd > 0 || p.mana < sk.mana) return;
  p.mana -= sk.mana;
  p.skillCd = sk.cd;

  if (sk.key === 'burst' || sk.key === 'nova') {
    run.vfx.push({ type: sk.key === 'burst' ? 'burstRing' : 'novaRing', x: p.x, y: p.y, radius: sk.radius, t: 0, dur: 0.5 });
    for (const e of run.enemies) {
      if (e.dead) continue;
      if (dist(p.x, p.y, e.x, e.y) <= sk.radius) {
        damageEnemy(run, e, run.stats.dmg * sk.dmgMult);
        if (sk.snare) e.snareT = sk.snare;
        if (sk.slow) { e.slowT = sk.slowDur; e.slowAmt = sk.slow; }
      }
    }
  } else if (sk.key === 'pierce') {
    const a = p.aim;
    const x2 = p.x + a.x * sk.length, y2 = p.y + a.y * sk.length;
    run.vfx.push({ type: 'pierceLine', x1: p.x, y1: p.y, x2, y2, t: 0, dur: 0.35 });
    for (const e of run.enemies) {
      if (e.dead) continue;
      if (distToSegment(e.x, e.y, p.x, p.y, x2, y2) <= sk.width) {
        damageEnemy(run, e, run.stats.dmg * sk.dmgMult);
      }
    }
  }
}

function damageEnemy(run, e, amount) {
  if (e.dead) return;
  e.hp -= amount;
  run.vfx.push({ type: 'num', x: e.x, y: e.y, text: Math.round(amount), t: 0, dur: 0.6 });
  if (e.hp > 0) return;
  e.dead = true;
  run.vfx.push({ type: 'pop', x: e.x, y: e.y, color: RARITY[e.rarity].color, t: 0, dur: 0.4 });
  onKill(run, e);
}

function onKill(run, e) {
  const char = run.char;
  char.kills++;
  const xp = monsterXp(char, run.tier) * RARITY[e.rarity].xpMult;
  const ups = gainXp(char, xp);
  if (ups > 0) onLevelUp(run, ups);
  if (e.isBoss) onBossKill(run);
}

function onLevelUp(run, ups) {
  run.stats = charStats(run.char);
  run.player.life = run.stats.maxLife;
  run.player.mana = run.stats.maxMana;
  toastXp(`Level up! You are now level ${run.char.level}.`);
  run.vfx.push({ type: 'levelRing', x: run.player.x, y: run.player.y, radius: 6, t: 0, dur: 1.0 });
  save(state);
}

// ── Boss ─────────────────────────────────────────────────────

function updateBoss(run, dt) {
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
      if (dist(p.x, p.y, tg.x, tg.y) <= tg.r) hitPlayer(run, b.dmg * 2.2, { hitCd: 0 });
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
      run.enemies.push(makeEnemy(run.map, x, y, 'normal', null));
    }
  }
  toastXp(`${run.map.bossName} calls for backup.`);
}

function onBossKill(run) {
  run.cleared = true;
  run.over = 'cleared';
  const char = run.char;
  const bonus = monsterXp(char, run.tier) * RARITY.boss.xpMult;
  const ups = gainXp(char, bonus);
  if (ups > 0) onLevelUp(run, ups);
  const fresh = clearNode(state, char, run.map.nodeId);
  showCleared(run, fresh.length);
}

// ── Death / respawn ──────────────────────────────────────────

function onDeath(run) {
  if (run.over) return;
  run.over = 'death';
  run.player.life = 0;
  const lost = applyDeathPenalty(run.char);
  save(state);
  showDeath(pick(mulberry32(Date.now() >>> 0), DEATH_LINES), lost, run.char);
}

export function respawn() {
  const run = state.run;
  if (!run || run.over !== 'death') return;
  const p = run.player;
  p.life = run.stats.maxLife;
  p.mana = run.stats.maxMana;
  p.x = run.map.entrance.x;
  p.y = run.map.entrance.y;
  run.input.target = null;
  run.over = null;
  for (const e of run.enemies) { if (!e.dead) { e.hitCd = 0.5; } }
  if (run.boss) run.boss.telegraphs = [];
  hideDeath();
}

// ── World interactions ───────────────────────────────────────

function checkWaypoints(run) {
  for (const wp of run.map.waypoints) {
    if (run.wpUnlocked.includes(wp.id)) continue;
    if (dist(run.player.x, run.player.y, wp.x, wp.y) < 1.7) {
      run.wpUnlocked.push(wp.id);
      toastXp(`Waypoint unlocked: ${wp.name}`);
    }
  }
}

export function teleportTo(wpId) {
  const run = state.run;
  if (!run || run.over === 'death') return;
  const wp = run.map.waypoints.find((w) => w.id === wpId);
  if (!wp || !run.wpUnlocked.includes(wpId)) return;
  run.player.x = wp.x;
  run.player.y = wp.y;
  run.input.target = null;
  run.vfx.push({ type: 'novaRing', x: wp.x, y: wp.y, radius: 2, t: 0, dur: 0.4 });
}

function regen(run, dt) {
  const p = run.player;
  p.life = clamp(p.life + run.stats.maxLife * run.stats.lifeRegen * dt, 0, run.stats.maxLife);
  p.mana = clamp(p.mana + run.stats.maxMana * run.stats.manaRegen * dt, 0, run.stats.maxMana);
}

function reveal(run) {
  const { seen, map, player } = run;
  const cx = player.x | 0, cy = player.y | 0;
  for (let y = cy - REVEAL_R; y <= cy + REVEAL_R; y++) {
    if (y < 0 || y >= map.h) continue;
    for (let x = cx - REVEAL_R; x <= cx + REVEAL_R; x++) {
      if (x < 0 || x >= map.w) continue;
      const dx = x - player.x, dy = y - player.y;
      if (dx * dx + dy * dy <= REVEAL_R * REVEAL_R) seen[y * map.w + x] = 1;
    }
  }
}

function updateVfx(run, dt) {
  for (const v of run.vfx) v.t += dt;
  run.vfx = run.vfx.filter((v) => v.t < v.dur);
}
