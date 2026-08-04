// ── Class skills ─────────────────────────────────────────────
// Q/E/R casting, timed buffs, persistent vine zones, and delayed
// comet impacts. The engine (game.js) calls updateSkills each
// frame and damageEnemy is injected to avoid a circular import.

import { state } from './state.js';
import { dist, distToSegment } from './utils.js';

let dealDamage = null; // (run, enemy, amount) -> void, injected by game.js
export function wireSkills(fn) { dealDamage = fn; }

/** Cast skill slot 0/1/2 for the active run. */
export function castSkill(run, slot) {
  const p = run.player;
  const sk = run.cls.skills[slot];
  if (!sk || run.over || p.stunT > 0 || p.channelT > 0) return;
  if (p.cds[slot] > 0 || p.mana < sk.mana) return;
  p.mana -= sk.mana;
  p.cds[slot] = sk.cd;

  switch (sk.type) {
    case 'burst':
    case 'nova': {
      run.vfx.push({ type: sk.type === 'burst' ? 'burstRing' : 'novaRing', x: p.x, y: p.y, radius: sk.radius, t: 0, dur: 0.5 });
      for (const e of run.enemies) {
        if (e.dead) continue;
        if (dist(p.x, p.y, e.x, e.y) <= sk.radius) {
          dealDamage(run, e, run.stats.dmg * sk.dmgMult);
          if (sk.snare) e.snareT = sk.snare;
          if (sk.slow) { e.slowT = sk.slowDur; e.slowAmt = sk.slow; }
        }
      }
      break;
    }
    case 'pierce': {
      fireLine(run, sk, run.stats.dmg * sk.dmgMult);
      break;
    }
    case 'charged': {
      // plant your feet: movement locks, shot fires when the channel ends
      p.channelT = sk.channel;
      p.channelSkill = sk;
      run.input.target = null;
      run.input.path = null;
      break;
    }
    case 'buff': {
      p.buffs[sk.buff] = sk.dur;
      run.vfx.push({ type: 'levelRing', x: p.x, y: p.y, radius: 2.2, t: 0, dur: 0.5 });
      break;
    }
    case 'zoneCircle': {
      const at = aimPoint(run, sk.radius + 2.5);
      run.zones.push({
        shape: 'circle', x: at.x, y: at.y, r: sk.radius,
        until: run.time + sk.dur, nextTick: 0, tick: sk.tick,
        dmg: run.stats.dmg * sk.dmgMult, color: '#7dbb5e',
      });
      break;
    }
    case 'zoneLine': {
      const a = p.aim;
      run.zones.push({
        shape: 'line', x1: p.x + a.x * 0.8, y1: p.y + a.y * 0.8,
        x2: p.x + a.x * sk.length, y2: p.y + a.y * sk.length, width: sk.width,
        until: run.time + sk.dur, nextTick: 0, tick: sk.tick,
        dmg: run.stats.dmg * sk.dmgMult, color: '#7dbb5e',
      });
      break;
    }
    case 'comet': {
      const at = aimPoint(run, sk.range);
      run.impacts.push({ x: at.x, y: at.y, r: sk.radius, t: 0, dur: sk.delay, dmg: run.stats.dmg * sk.dmgMult });
      break;
    }
  }
}

/** Point to aim ground effects at: nearest living enemy in range, else ahead. */
function aimPoint(run, range) {
  const p = run.player;
  let best = null, bestD = range;
  for (const e of run.enemies) {
    if (e.dead) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d <= bestD) { best = e; bestD = d; }
  }
  return best ? { x: best.x, y: best.y } : { x: p.x + p.aim.x * range * 0.6, y: p.y + p.aim.y * range * 0.6 };
}

function fireLine(run, sk, dmg) {
  const p = run.player;
  const a = p.aim;
  const x2 = p.x + a.x * sk.length, y2 = p.y + a.y * sk.length;
  run.vfx.push({ type: 'pierceLine', x1: p.x, y1: p.y, x2, y2, t: 0, dur: 0.35 });
  for (const e of run.enemies) {
    if (e.dead) continue;
    if (distToSegment(e.x, e.y, p.x, p.y, x2, y2) <= sk.width) dealDamage(run, e, dmg);
  }
}

/** Per-frame skill upkeep: cooldowns, buffs, channel, zones, impacts. */
export function updateSkills(run, dt) {
  const p = run.player;
  for (let i = 0; i < p.cds.length; i++) if (p.cds[i] > 0) p.cds[i] -= dt;
  for (const k of Object.keys(p.buffs)) if (p.buffs[k] > 0) p.buffs[k] -= dt;

  // channeled shot
  if (p.channelT > 0) {
    p.channelT -= dt;
    if (p.stunT > 0) { p.channelT = 0; p.channelSkill = null; }
    else if (p.channelT <= 0 && p.channelSkill) {
      fireLine(run, p.channelSkill, run.stats.dmg * p.channelSkill.dmgMult);
      p.channelSkill = null;
    }
  }

  // vine zones: tick damage + hold anything inside
  run.zones = run.zones.filter((z) => z.until > run.time);
  for (const z of run.zones) {
    z.nextTick -= dt;
    if (z.nextTick > 0) continue;
    z.nextTick = z.tick;
    for (const e of run.enemies) {
      if (e.dead) continue;
      const inside = z.shape === 'circle'
        ? dist(e.x, e.y, z.x, z.y) <= z.r
        : distToSegment(e.x, e.y, z.x1, z.y1, z.x2, z.y2) <= z.width;
      if (inside) {
        dealDamage(run, e, z.dmg);
        e.snareT = Math.max(e.snareT, z.tick + 0.1);
      }
    }
  }

  // comet impacts
  for (const im of run.impacts) {
    im.t += dt;
    if (im.t >= im.dur && !im.fired) {
      im.fired = true;
      run.shakeMag = Math.max(run.shakeMag || 0, 0.25);
      run.vfx.push({ type: 'cometSlam', x: im.x, y: im.y, radius: im.r, t: 0, dur: 0.4 });
      for (const e of run.enemies) {
        if (e.dead) continue;
        if (dist(e.x, e.y, im.x, im.y) <= im.r) dealDamage(run, e, im.dmg);
      }
    }
  }
  run.impacts = run.impacts.filter((im) => im.t < im.dur + 0.1);
}

/** Effective attack cooldown after buffs (mage surge). */
export function effectiveAtkCd(run) {
  const surge = run.player.buffs.surge > 0 ? (run.cls.skills.find((s) => s.buff === 'surge')?.atkSpeed || 1) : 1;
  return run.cls.atkCd / surge;
}

/** Effective move speed multiplier from buffs. */
export function moveSpeedMult(run) {
  return run.player.buffs.surge > 0 ? (run.cls.skills.find((s) => s.buff === 'surge')?.moveSpeed || 1) : 1;
}

/** Extra targets per attack while overcharged (archer). */
export function overchargeTargets(run) {
  if (run.player.buffs.overcharge <= 0) return 0;
  return run.cls.skills.find((s) => s.buff === 'overcharge')?.extraTargets || 0;
}

export function activeRun() { return state.run; }
