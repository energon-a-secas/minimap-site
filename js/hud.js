// ── HUD (DOM overlay) ────────────────────────────────────────
// Orbs, XP bar, quest tracker, boss bar, skill cooldown,
// waypoint panel, death and clear overlays. Values are cached
// so the rAF loop only touches the DOM on change.

import { $, escHtml, fmtNum, showToast } from './utils.js';
import { xpForLevel, LEVEL_CAP } from './state.js';
import { CLASSES } from './defs.js';

const cache = {};

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
  $('skillIcon').textContent = cls.icon;
  $('skillBtn').title = `${cls.skill.name} (Q): ${cls.skill.desc} Costs ${cls.skill.mana} mana.`;
  $('bossName').textContent = run.map.bossName;
  $('bossBar').hidden = true;
  $('wpPanel').hidden = true;
  $('deathOverlay').hidden = true;
  $('clearedOverlay').hidden = true;
}

export function updateHud(run) {
  const p = run.player;
  const st = run.stats;
  const char = run.char;

  set('lifeFill', 'height', Math.round((p.life / st.maxLife) * 100) + '%');
  set('lifeLabel', 'text', `${fmtNum(Math.max(0, p.life))}/${fmtNum(st.maxLife)}`);
  set('manaFill', 'height', Math.round((p.mana / st.maxMana) * 100) + '%');
  set('manaLabel', 'text', `${fmtNum(p.mana)}/${fmtNum(st.maxMana)}`);

  const need = xpForLevel(char.level);
  const pct = char.level >= LEVEL_CAP ? 100 : Math.min(100, (char.xp / need) * 100);
  set('xpFill', 'width', pct.toFixed(2) + '%');
  set('xpLabel', 'text', char.level >= LEVEL_CAP
    ? 'Level 100. You are free now.'
    : `Level ${char.level}  ·  ${fmtNum(char.xp)} / ${fmtNum(need)} XP (${pct.toFixed(1)}%)`);
  set('charLine', 'text', `${char.name}, level ${char.level} ${CLASSES[char.cls].name}`);

  const cdFrac = Math.max(0, p.skillCd) / run.cls.skill.cd;
  set('skillCd', 'height', Math.round(cdFrac * 100) + '%');

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

export function toastXp(msg) {
  showToast(msg);
}
