// ── Game engine ──────────────────────────────────────────────
// Owns the live run: rAF loop, movement (click + WASD), combat,
// XP and death, boss fight, waypoints. Rendering is render.js,
// DOM overlay is hud.js.

import { state, save, activeChar, charStats, enemyStats, gainXp, applyDeathPenalty, monsterXp, clearNode } from './state.js';
import { CLASSES, RARITY, MOVES, atlasNode, DEATH_LINES } from './defs.js';
import { generateMap, canStand, findPath } from './mapgen.js';
import { dist, clamp, pick, mulberry32 } from './utils.js';
import { drawFrame, paintBackdrop, resizeCanvases } from './render.js';
import { updateHud, initHudForRun, showDeath, hideDeath, showCleared, toastXp } from './hud.js';
import { castSkill, updateSkills, wireSkills, effectiveAtkCd, moveSpeedMult, overchargeTargets } from './skills.js';
import { updateBoss, updateEnemies, wireBoss } from './boss.js';

const REVEAL_R = 9;
const PLAYER_R = 0.42;
const ACCEL = 12;         // 1/s: velocity eases toward the desired direction
const ROLL_BUFFER = 0.25; // s: pressing roll this close to ready queues one
const LOOK_AHEAD = 1.6;   // tiles the camera leads toward aim / held cursor
const LOOK_EASE = 3.5;    // 1/s: easing of the look-ahead offset

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
      atkTimer: 0, aim: { x: 1, y: 0 },
      cds: [0, 0, 0], buffs: { surge: 0, overcharge: 0 },
      channelT: 0, channelSkill: null,
      rollT: 0, rollCd: 0, rollDir: null, rollQueued: false,
      sprint: false, stunT: 0, stunGrace: 0,
      velX: 0, velY: 0,
    },
    enemies: buildEnemies(map),
    zones: [], impacts: [],
    vfx: [],
    seen: new Uint8Array(map.w * map.h),
    wpUnlocked: ['wp0'],
    input: { keys: {}, mouse: { down: false, x: 0, y: 0 }, target: null },
    camX: map.entrance.x, camY: map.entrance.y,
    lookX: 0, lookY: 0, shakeMag: 0,
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
    const p = run.player;
    if (p.stunT > 0) p.stunT -= dt;
    if (p.stunT <= 0 && p.stunGrace > 0) p.stunGrace -= dt;
    if (p.rollCd > 0) p.rollCd -= dt;
    movePlayer(run, dt);
    updateEnemies(run, dt);
    updateCombat(run, dt);
    updateSkills(run, dt);
    updateBoss(run, dt);
    regen(run, dt);
    checkWaypoints(run);
    reveal(run);
  }
  updateVfx(run, dt);
  // camera leads a little toward aim (or the held cursor), eased so
  // aim snaps during combat don't yank the view around
  const pl = run.player;
  let lx = pl.aim.x, ly = pl.aim.y;
  if (run.input.mouse.down) {
    const m = run.input.mouse, md = dist(pl.x, pl.y, m.x, m.y);
    if (md > 0.001) { lx = (m.x - pl.x) / md; ly = (m.y - pl.y) / md; }
  }
  const lk = Math.min(1, dt * LOOK_EASE);
  run.lookX += (lx * LOOK_AHEAD - run.lookX) * lk;
  run.lookY += (ly * LOOK_AHEAD - run.lookY) * lk;
  run.camX += (pl.x + run.lookX - run.camX) * Math.min(1, dt * 6);
  run.camY += (pl.y + run.lookY - run.camY) * Math.min(1, dt * 6);
  // screen shake (render reads shakeMag): fast linear decay to zero
  run.shakeMag = Math.max(0, (run.shakeMag || 0) - dt * 2.2);
  if (run.shakeMag < 0.001) run.shakeMag = 0;
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

/** True when moving to (x, y) would press into a living enemy.
    Rolling ignores bodies; escaping an overlap is always allowed. */
function blockedByEnemy(run, x, y, fromX, fromY) {
  if (run.player.rollT > 0) return false;
  for (const e of run.enemies) {
    if (e.dead) continue;
    const rr = e.isBoss ? 1.15 : 0.72;
    const nd = dist(x, y, e.x, e.y);
    if (nd < rr && nd < dist(fromX, fromY, e.x, e.y)) return true;
  }
  return false;
}

function stepPlayer(run, vx, vy, step) {
  const p = run.player;
  const nx = p.x + vx * step;
  if (canStand(run.map.grid, nx, p.y, PLAYER_R) && !blockedByEnemy(run, nx, p.y, p.x, p.y)) p.x = nx;
  const ny = p.y + vy * step;
  if (canStand(run.map.grid, p.x, ny, PLAYER_R) && !blockedByEnemy(run, p.x, ny, p.x, p.y)) p.y = ny;
}

function movePlayer(run, dt) {
  const p = run.player;

  // buffered roll fires the moment it is legal again (never while stunned)
  if (p.rollQueued && p.rollT <= 0 && p.rollCd <= 0 && p.stunT <= 0) { p.rollQueued = false; doRoll(run); }

  // roll: fast dash, passes through enemies, i-frames
  if (p.rollT > 0) {
    p.rollT -= dt;
    stepPlayer(run, p.rollDir.x, p.rollDir.y, (MOVES.roll.dist / MOVES.roll.dur) * dt);
    // dash done: re-path to the surviving click-target from where we landed
    if (p.rollT <= 0 && run.input.target) setMoveTarget(run.input.target.x, run.input.target.y);
    return;
  }
  if (p.stunT > 0 || p.channelT > 0) { p.velX = 0; p.velY = 0; return; } // recovery or planted feet: no walking

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
      // held mouse: re-path on a cadence, or instantly on a sharp (>45°) turn
      run.pathTimer = (run.pathTimer ?? 0) - dt;
      const md = dist(p.x, p.y, mouse.x, mouse.y);
      const mx = (mouse.x - p.x) / (md || 1), my = (mouse.y - p.y) / (md || 1);
      const turned = md > 1 && run.pathDir && mx * run.pathDir.x + my * run.pathDir.y < 0.7071;
      if (run.pathTimer <= 0 || turned) {
        run.pathTimer = 0.10;
        run.pathDir = { x: mx, y: my };
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

  // ease velocity toward the desired direction: ~80ms to full speed,
  // near-instant stop, so it reads snappy rather than floaty
  let speed = 0, nx = 0, ny = 0;
  if (vx || vy) {
    const len = Math.hypot(vx, vy);
    nx = vx / len; ny = vy / len;
    p.aim = { x: nx, y: ny };
    speed = run.stats.speed * moveSpeedMult(run);
    if (p.sprint) speed *= MOVES.sprint.speedMult;
  }
  const k = speed > 0 ? Math.min(1, dt * ACCEL) : 1;
  p.velX += (nx * speed - p.velX) * k;
  p.velY += (ny * speed - p.velY) * k;
  if (!p.velX && !p.velY) return;
  stepPlayer(run, p.velX, p.velY, dt);
}

/** Space: dodge roll in the current move/aim direction. Pressing it
    mid-roll or in the last beat of cooldown queues exactly one roll. */
export function startRoll() {
  const run = state.run;
  if (!run || run.over) return;
  const p = run.player;
  if (p.stunT > 0) return;
  if (p.rollT > 0 || (p.rollCd > 0 && p.rollCd <= ROLL_BUFFER)) { p.rollQueued = true; return; }
  if (p.rollCd > 0) return;
  doRoll(run);
}

function doRoll(run) {
  const p = run.player;
  p.rollT = MOVES.roll.dur;
  p.rollCd = MOVES.roll.cd;
  p.rollDir = { x: p.aim.x, y: p.aim.y };
  p.channelT = 0;
  p.channelSkill = null;
  run.vfx.push({ type: 'rollStreak', x1: p.x, y1: p.y, x2: p.x + p.aim.x * MOVES.roll.dist, y2: p.y + p.aim.y * MOVES.roll.dist, t: 0, dur: 0.3 });
}

/** Shift / HUD button: sprint on or off. */
export function setSprint(on) {
  const run = state.run;
  if (!run) return;
  run.player.sprint = on && run.player.stunT <= 0;
}

// ── Enemies (chase + separation AI lives in boss.js) ─────────

function hitPlayer(run, dmg, e) {
  const p = run.player;
  if (p.rollT > 0) return; // i-frames: the roll is sacred
  e.hitCd = 0.9;
  p.life -= dmg;
  run.vfx.push({ type: 'hurt', x: p.x, y: p.y, t: 0, dur: 0.25 });
  // caught sprinting: knocked into recovery, no moving for a bit
  if (p.sprint && p.stunT <= 0 && p.stunGrace <= 0) {
    p.stunT = MOVES.sprint.stun;
    p.stunGrace = MOVES.sprint.stun + MOVES.sprint.grace;
    p.sprint = false;
    p.rollQueued = false; // a knockdown drops buffered inputs
    run.input.target = null;
    run.input.path = null;
    toastXp('Stunned! Caught sprinting.');
  }
  if (p.life <= 0) onDeath(run);
}

// ── Player combat ────────────────────────────────────────────

function updateCombat(run, dt) {
  const p = run.player;
  if (p.atkTimer > 0) p.atkTimer -= dt;
  if (p.atkTimer > 0 || p.rollT > 0) return;

  const target = nearestEnemy(run, run.cls.range);
  if (!target) return;
  p.atkTimer = effectiveAtkCd(run);
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
  // overcharged: extra arrows strike other dots in range
  let extra = overchargeTargets(run);
  if (extra > 0) {
    for (const e of run.enemies) {
      if (extra <= 0) break;
      if (e.dead || e === target) continue;
      if (dist(p.x, p.y, e.x, e.y) <= run.cls.range) {
        damageEnemy(run, e, run.stats.dmg * 0.7);
        pushAttackVfx(run, e);
        extra--;
      }
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

export function useSkill(slot = 0) {
  const run = state.run;
  if (!run) return;
  castSkill(run, slot);
}

wireSkills(damageEnemy);
wireBoss({ hitPlayer, makeEnemy });

function damageEnemy(run, e, amount) {
  if (e.dead) return;
  e.hp -= amount;
  e.flashT = 0.12; // white hit flash (render reads, updateEnemies decays)
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

// ── Boss (fight logic lives in boss.js) ──────────────────────

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
  run.shakeMag = Math.max(run.shakeMag || 0, 0.6);
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
  p.cds = [0, 0, 0];
  p.buffs = { surge: 0, overcharge: 0 };
  p.channelT = 0; p.channelSkill = null;
  p.rollT = 0; p.rollCd = 0; p.rollQueued = false;
  p.sprint = false; p.stunT = 0; p.stunGrace = 0;
  p.velX = 0; p.velY = 0;
  run.input.target = null;
  run.input.path = null; run.pathDir = null;
  run.zones = [];
  run.impacts = [];
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
  run.player.velX = 0; run.player.velY = 0; run.player.rollQueued = false;
  run.input.target = null;
  run.input.path = null; run.pathDir = null; // a stale path would resume from the old spot
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
