// ── Atlas hub ────────────────────────────────────────────────
// SVG node map of all maps. Locked / open / cleared states come
// from the active character's atlas progress.

import { $, escHtml } from './utils.js';
import { ATLAS, BIOMES, atlasNode } from './defs.js';
import { state, activeChar, monsterLevel } from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function renderHub() {
  const char = activeChar(state);
  if (!char) return;
  $('hubCharLine').textContent =
    `${char.name}, level ${char.level}. Maps cleared: ${char.atlas.cleared.length} of ${ATLAS.length}.`;

  const svg = $('atlasSvg');
  svg.innerHTML = '';

  // edges first, under the nodes
  const drawn = new Set();
  for (const n of ATLAS) {
    for (const id of n.links) {
      const key = [n.id, id].sort().join('-');
      if (drawn.has(key)) continue;
      drawn.add(key);
      const m = atlasNode(id);
      const lit = isUnlocked(char, n.id) && isUnlocked(char, id);
      const line = el('line', {
        x1: n.x, y1: n.y, x2: m.x, y2: m.y,
        class: 'atlas-edge' + (lit ? ' atlas-edge--lit' : ''),
      });
      svg.appendChild(line);
    }
  }

  for (const n of ATLAS) {
    const cleared = char.atlas.cleared.includes(n.id);
    const unlocked = isUnlocked(char, n.id);
    const g = el('g', {
      class: 'atlas-node' +
        (cleared ? ' atlas-node--cleared' : unlocked ? ' atlas-node--open' : ' atlas-node--locked') +
        (state.selectedNode === n.id ? ' atlas-node--selected' : ''),
      'data-node': n.id,
      tabindex: unlocked ? 0 : -1,
      role: 'button',
      'aria-label': `${n.name}, tier ${n.tier}${cleared ? ', cleared' : unlocked ? '' : ', locked'}`,
    });
    g.appendChild(el('circle', { cx: n.x, cy: n.y, r: 16, class: 'atlas-node__ring' }));
    g.appendChild(el('circle', { cx: n.x, cy: n.y, r: 10, class: 'atlas-node__core', fill: unlocked ? biomeColor(n) : 'transparent' }));
    const t = el('text', { x: n.x, y: n.y + 4.5, class: 'atlas-node__tier' });
    t.textContent = cleared ? '✓' : n.tier;
    g.appendChild(t);
    svg.appendChild(g);
  }

  renderDetail();
}

function isUnlocked(char, id) { return char.atlas.unlocked.includes(id); }

function biomeColor(n) { return BIOMES[n.biome].wpColor; }

export function selectNode(id) {
  const char = activeChar(state);
  if (!char || !isUnlocked(char, id)) return;
  state.selectedNode = id;
  renderHub();
}

function renderDetail() {
  const box = $('hubDetail');
  const n = state.selectedNode ? atlasNode(state.selectedNode) : null;
  const char = activeChar(state);
  if (!n || !char || !isUnlocked(char, n.id)) { box.hidden = true; return; }
  box.hidden = false;
  $('hubMapName').textContent = `${n.name} (Tier ${n.tier})`;
  const cleared = char.atlas.cleared.includes(n.id);
  $('hubMapInfo').innerHTML =
    `${escHtml(BIOMES[n.biome].name)} · Monster level ${monsterLevel(n.tier)} · Boss: ${escHtml(n.boss)}` +
    (cleared ? ' · Cleared (layouts reroll every run)' : '');
}
