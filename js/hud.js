// ── HUD (DOM overlay) ────────────────────────────────────────
// Orbs, XP bar, quest tracker, boss bar, skill cooldown,
// waypoint panel, death and clear overlays. Values are cached
// so the rAF loop only touches the DOM on change.

import { $, escHtml, fmtNum, showToast } from './utils.js';
import { xpForLevel, LEVEL_CAP } from './state.js';
import { CLASSES, MOVES } from './defs.js';

const cache = {};
let xpPulseTimer = 0;

function set(id, prop, value) {
  const key = id + ':' + prop;
  if (cache[key] === value) return;
  cache[key] = value;
  const el = $(id);
  if (!el) return;
  if (prop === 'text') el.textContent = value;
  else if (prop === 'hidden') el.hidden = value;
  else el.style[prop] = value;
}

export function initHudForRun(run) {
  Object.keys(cache).forEach((k) => delete cache[k]);
  const cls = CLASSES[run.char.cls];
  $('trkMapName').textContent = run.map.name;
  $('trkMonsterLevel').textContent = `Monster Level: ${run.map.monsterLevel}`;
  $('trkQuestTitle').textContent = run.map.quest.title;
  $('trkQuestBody').textContent = `${run.map.quest.body} Then defeat ${run.map.bossName}.`;
  buildSkillbar(cls);
  $('bossName').textContent = run.map.bossName;
  $('bossBar').hidden = true;
  $('wpPanel').hidden = true;
  $('deathOverlay').hidden = true;
  $('clearedOverlay').hidden = true;
  $('leaveConfirm').hidden = true;
}

/** Rebuild the skill bar for the active class: Q/E/R + roll/sprint/utility. */
function buildSkillbar(cls) {
  const bar = $('skillbar');
  const parts = [];
  cls.skills.forEach((sk, i) => {
    parts.push(`
      <button class="skill" data-slot="${i}" aria-label="${escHtml(sk.name)} (${sk.kb})"
              title="${escHtml(sk.name)} (${sk.kb}): ${escHtml(sk.desc)} Costs ${sk.mana} mana, ${sk.cd}s cooldown.">
        <span class="skill__icon">${sk.icon}</span>
        <span class="skill__cd" id="skillCd${i}"></span>
        <span class="skill__cdnum" id="skillCdNum${i}"></span>
        <span class="skill__key">${sk.kb}</span>
      </button>`);
  });
  parts.push(`
      <button class="skill skill--move" data-action="roll" aria-label="Dodge roll (Space)"
              title="Dodge roll (Space): dash through enemies with brief immunity.">
        <span class="skill__icon skill__icon--svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14c0-5.5 4.5-10 10-10 3.4 0 6.4 1.7 8.2 4.3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M22.5 3v5.6h-5.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.5" cy="17.5" r="3.4" fill="currentColor"/></svg></span>
        <span class="skill__cd" id="rollCdEl"></span>
        <span class="skill__cdnum" id="rollCdNum"></span>
        <span class="skill__key">Spc</span>
      </button>
      <button class="skill skill--move" data-action="sprint" id="sprintBtn" aria-label="Sprint (hold Shift)"
              title="Sprint (hold Shift): move much faster, but a hit while sprinting stuns you.">
        <span class="skill__icon skill__icon--svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5l7 7-7 7M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="skill__key">Shf</span>
      </button>
      <button class="skill skill--util" data-action="wp" aria-label="Waypoints (T)" title="Waypoints (T)">
        <span class="skill__icon">◈</span>
        <span class="skill__key">T</span>
      </button>
      <button class="skill skill--util" data-action="leave" aria-label="Leave map (Esc)" title="Leave map (Esc)">
        <span class="skill__icon">⏏</span>
        <span class="skill__key">Esc</span>
      </button>`);
  bar.innerHTML = parts.join('');
}

export function updateHud(run) {
  const p = run.player;
  const st = run.stats;
  const char = run.char;

  set('lifeFill', 'height', Math.round((p.life / st.maxLife) * 100) + '%');
  set('lifeLabel', 'text', `${fmtNum(Math.max(0, p.life))}/${fmtNum(st.maxLife)}`);
  set('manaFill', 'height', Math.round((p.mana / st.maxMana) * 100) + '%');
  set('manaLabel', 'text', `${fmtNum(p.mana)}/${fmtNum(st.maxMana)}`);

  // low-life vignette on the stage, with hysteresis so it does not flicker
  const lifeFrac = p.life / st.maxLife;
  let low = cache['lowlife'] === true;
  if (lifeFrac < 0.35) low = true;
  else if (lifeFrac > 0.40) low = false;
  if (cache['lowlife'] !== low) {
    cache['lowlife'] = low;
    $('stage')?.classList.toggle('stage--lowlife', low);
  }

  const need = xpForLevel(char.level);
  const pct = char.level >= LEVEL_CAP ? 100 : Math.min(100, (char.xp / need) * 100);
  // xp gained: flare the fill briefly (level rollover drops pct, no flare)
  const prevPct = cache['xppct'];
  cache['xppct'] = pct;
  if (prevPct !== undefined && pct > prevPct) {
    const fill = $('xpFill');
    if (fill) {
      clearTimeout(xpPulseTimer);
      fill.classList.remove('xpbar__fill--pulse');
      void fill.offsetWidth; // restart the animation
      fill.classList.add('xpbar__fill--pulse');
      xpPulseTimer = setTimeout(() => fill.classList.remove('xpbar__fill--pulse'), 600);
    }
  }
  set('xpFill', 'width', pct.toFixed(2) + '%');
  set('xpLabel', 'text', char.level >= LEVEL_CAP
    ? 'Level 100. You are free now.'
    : `Level ${char.level}  ·  ${fmtNum(char.xp)} / ${fmtNum(need)} XP (${pct.toFixed(1)}%)`);
  set('charLine', 'text', p.stunT > 0
    ? 'STUNNED. This is what sprinting gets you.'
    : `${char.name}, level ${char.level} ${CLASSES[char.cls].name}`);

  // skill cooldowns + a flash when one comes back up
  run.cls.skills.forEach((sk, i) => {
    const frac = Math.max(0, p.cds[i]) / sk.cd;
    set('skillCd' + i, 'height', Math.round(frac * 100) + '%');
    set('skillCdNum' + i, 'text', p.cds[i] > 1 ? p.cds[i].toFixed(1) : '');
    const wasCooling = cache['cdstate:' + i];
    const cooling = p.cds[i] > 0;
    cache['cdstate:' + i] = cooling;
    const btn = document.querySelector(`#skillbar [data-slot="${i}"]`);
    if (btn) {
      if (wasCooling && !cooling) {
        btn.classList.add('skill--flash');
        setTimeout(() => btn.classList.remove('skill--flash'), 500);
      }
      btn.classList.toggle('skill--buffed', Boolean(sk.buff && p.buffs[sk.buff] > 0));
    }
  });
  const rollFrac = Math.max(0, p.rollCd) / MOVES.roll.cd;
  set('rollCdEl', 'height', Math.round(rollFrac * 100) + '%');
  set('rollCdNum', 'text', p.rollCd > 1 ? p.rollCd.toFixed(1) : '');
  const sprintBtn = $('sprintBtn');
  if (sprintBtn) sprintBtn.classList.toggle('skill--active', p.sprint);

  const b = run.boss;
  const showBoss = run.bossShown && b && !b.dead;
  set('bossBar', 'hidden', !showBoss);
  if (showBoss) set('bossFill', 'width', Math.max(0, (b.hp / b.maxHp) * 100).toFixed(1) + '%');
}

// ── Waypoint panel ───────────────────────────────────────────

export function renderWaypointPanel(run, onTeleport, onLeave) {
  const list = $('wpList');
  list.innerHTML = '';
  for (const wp of run.map.waypoints) {
    const unlocked = run.wpUnlocked.includes(wp.id);
    const btn = document.createElement('button');
    btn.className = 'wp-item' + (unlocked ? '' : ' wp-item--locked');
    btn.disabled = !unlocked;
    btn.innerHTML = `<span>◈</span> ${escHtml(wp.name)}${unlocked ? '' : ' (undiscovered)'}`;
    if (unlocked) btn.addEventListener('click', () => onTeleport(wp.id));
    list.appendChild(btn);
  }
  const leave = document.createElement('button');
  leave.className = 'wp-item wp-item--leave';
  leave.innerHTML = '<span>↩</span> Atlas of Worms (leave map)';
  leave.addEventListener('click', onLeave);
  list.appendChild(leave);
}

export function toggleWaypointPanel(force) {
  const panel = $('wpPanel');
  panel.hidden = force !== undefined ? !force : !panel.hidden;
  return !panel.hidden;
}

// ── Overlays + toasts ────────────────────────────────────────

export function showDeath(line, xpLost, char) {
  $('deathLine').textContent = line;
  $('deathPenalty').textContent = xpLost > 0
    ? `${fmtNum(xpLost)} XP lost. Deaths so far: ${char.deaths}.`
    : `Nothing left to lose. Deaths so far: ${char.deaths}.`;
  $('deathOverlay').hidden = false;
}

export function hideDeath() {
  $('deathOverlay').hidden = true;
}

export function showCleared(run, freshCount) {
  $('clearedLine').textContent = freshCount > 0
    ? `${run.map.bossName} is down. ${freshCount} new ${freshCount === 1 ? 'map' : 'maps'} unlocked on the Atlas.`
    : `${run.map.bossName} is down. The Atlas remembers.`;
  $('clearedOverlay').hidden = false;
}

export function hideCleared() {
  $('clearedOverlay').hidden = true;
}

export function showLeaveConfirm() {
  $('leaveConfirm').hidden = false;
}

export function hideLeaveConfirm() {
  $('leaveConfirm').hidden = true;
}

export function leaveConfirmOpen() {
  return !$('leaveConfirm').hidden;
}

export function toastXp(msg) {
  showToast(msg);
}
