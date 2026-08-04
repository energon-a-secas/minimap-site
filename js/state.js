// ── State management ─────────────────────────────────────────
// Roster + atlas progress persist to localStorage. The live map
// run (state.run) is ephemeral: leaving a map discards it.

import { CLASSES, ATLAS, START_NODES, DEFAULT_NAMES, atlasNode } from './defs.js';

export const STORAGE_KEY = 'minimap-v1';

export const state = {
  roster: [],       // persisted characters
  activeId: null,   // persisted selection
  screen: 'loading',
  run: null,        // live map run, never persisted
  selectedNode: null, // hub selection
};

export function loadSaved(s) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.roster)) s.roster = saved.roster;
    if (saved.activeId) s.activeId = saved.activeId;
    migrateAtlas(s);
  } catch { /* ignore corrupted data */ }
}

/** Drop atlas node ids that no longer exist and guarantee every
    character can still start somewhere (their class root). */
function migrateAtlas(s) {
  const valid = new Set(ATLAS.map((n) => n.id));
  for (const c of s.roster) {
    if (!c.atlas) c.atlas = { unlocked: [], cleared: [] };
    c.atlas.unlocked = (c.atlas.unlocked || []).filter((id) => valid.has(id));
    c.atlas.cleared = (c.atlas.cleared || []).filter((id) => valid.has(id));
    const root = START_NODES[c.cls] || 't1a';
    if (!c.atlas.unlocked.includes(root)) c.atlas.unlocked.push(root);
  }
}

export function save(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ roster: s.roster, activeId: s.activeId }));
  } catch { /* quota exceeded or private browsing */ }
}

// ── Characters ───────────────────────────────────────────────

export function createCharacter(s, { name, cls, body }) {
  const char = {
    id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    name: (name || '').trim() || DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)],
    cls,
    body,
    level: 80,
    xp: 0,
    kills: 0,
    deaths: 0,
    maps: 0,
    atlas: { unlocked: [START_NODES[cls] || 't1a'], cleared: [] },
    createdAt: Date.now(),
  };
  s.roster.push(char);
  s.activeId = char.id;
  save(s);
  return char;
}

export function defaultCharacter() {
  return { name: 'Exile', cls: 'archer', body: { sex: 'woman', height: 'average', build: 'athletic', hair: 'braid' } };
}

export function activeChar(s) {
  return s.roster.find((c) => c.id === s.activeId) || null;
}

export function deleteCharacter(s, id) {
  s.roster = s.roster.filter((c) => c.id !== id);
  if (s.activeId === id) s.activeId = s.roster[0]?.id || null;
  save(s);
}

// ── Leveling ─────────────────────────────────────────────────

export const LEVEL_CAP = 100;

/** XP needed to go from `level` to `level + 1`. Steepens hard, that is the game. */
export function xpForLevel(level) {
  return Math.floor(60000 * Math.pow(1.22, level - 80));
}

/** Grant xp; returns number of levels gained. */
export function gainXp(char, amount) {
  if (char.level >= LEVEL_CAP) return 0;
  char.xp += Math.max(0, Math.round(amount));
  let ups = 0;
  while (char.level < LEVEL_CAP && char.xp >= xpForLevel(char.level)) {
    char.xp -= xpForLevel(char.level);
    char.level++;
    ups++;
  }
  if (char.level >= LEVEL_CAP) char.xp = 0;
  return ups;
}

/** Death penalty: lose 10% of the current level bar, never de-level. */
export function applyDeathPenalty(char) {
  const loss = Math.floor(xpForLevel(char.level) * 0.10);
  const actual = Math.min(char.xp, loss);
  char.xp -= actual;
  char.deaths++;
  return actual;
}

/** XP for one normal monster at a map tier, with an over-leveling penalty. */
export function monsterXp(char, tier) {
  const base = 150 * Math.pow(tier, 1.5);
  const monsterLevel = 80 + tier * 2;
  const over = Math.max(0, char.level - monsterLevel - 3);
  const eff = Math.max(0.05, 1 - over * 0.12);
  return base * eff;
}

export function monsterLevel(tier) { return 80 + tier * 2; }

// ── Derived combat stats ─────────────────────────────────────

export function charStats(char) {
  const c = CLASSES[char.cls];
  const l = char.level - 80;
  return {
    maxLife: Math.round((2600 + l * 220) * c.lifeMult),
    maxMana: Math.round(240 + l * 16),
    dmg: Math.round(220 * Math.pow(1.09, l) * c.dmgMult),
    speed: 5.6, // tiles per second
    lifeRegen: 0.035, // fraction of max per second
    manaRegen: 0.06,
  };
}

export function enemyStats(tier, rarityDef) {
  const scale = Math.pow(1.32, tier - 1);
  return {
    hp: Math.round(220 * scale * rarityDef.hpMult),
    dmg: Math.round((16 + tier * 8) * rarityDef.dmgMult),
    speed: 3.1,
  };
}

// ── Atlas progress ───────────────────────────────────────────

/** Mark node cleared and open its links. Returns newly unlocked node ids. */
export function clearNode(s, char, nodeId) {
  const fresh = [];
  if (!char.atlas.cleared.includes(nodeId)) char.atlas.cleared.push(nodeId);
  const node = atlasNode(nodeId);
  for (const id of node?.links || []) {
    if (!char.atlas.unlocked.includes(id)) {
      char.atlas.unlocked.push(id);
      fresh.push(id);
    }
  }
  char.maps++;
  save(s);
  return fresh;
}
