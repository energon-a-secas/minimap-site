// ── Atlas hub ────────────────────────────────────────────────
// Stylized world-map view of all maps. Locked / open / cleared
// states come from the active character's atlas progress. The
// painterly terrain underlay is drawn by atlasart.js; this file
// renders the SVG route lines and medallion markers on top.

import { $, escHtml } from './utils.js';
import { ATLAS, BIOMES, CLASSES, atlasNode } from './defs.js';
import { state, activeChar, monsterLevel } from './state.js';
import { paintAtlasTerrain } from './atlasart.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Dashed expedition route: a gently bowed quadratic curve.
    Bow side and size derive from the edge key, so it is stable. */
function edgePath(a, b, key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(16, len * 0.12) * (h % 2 ? 1 : -1);
  const cx = (a.x + b.x) / 2 - (dy / len) * bow;
  const cy = (a.y + b.y) / 2 + (dx / len) * bow;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/** Path of `count` radial tick marks between radii r1 and r2. */
function radialTicks(x, y, r1, r2, count, offset = -Math.PI / 2) {
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    d += `M ${(x + c * r1).toFixed(1)} ${(y + s * r1).toFixed(1)} ` +
         `L ${(x + c * r2).toFixed(1)} ${(y + s * r2).toFixed(1)} `;
  }
  return d;
}

export function renderHub() {
  const char = activeChar(state);
  if (!char) return;
  $('hubCharLine').textContent =
    `${char.name}, level ${char.level}. Maps cleared: ${char.atlas.cleared.length} of ${ATLAS.length}.`;

  const svg = $('atlasSvg');
  paintAtlasTerrain(svg.closest('.atlas-wrap'));
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
      svg.appendChild(el('path', {
        d: edgePath(n, m, key),
        class: 'atlas-edge' + (lit ? ' atlas-edge--lit' : ''),
      }));
    }
  }

  for (const n of ATLAS) drawNode(svg, n, char);

  renderDetail();
}

function drawNode(svg, n, char) {
  const cleared = char.atlas.cleared.includes(n.id);
  const unlocked = isUnlocked(char, n.id);
  const isApex = n.id === 'apex';
  const cls = n.classStart ? CLASSES[n.classStart] : null;
  const R = isApex ? 22 : 16;
  const g = el('g', {
    class: 'atlas-node' +
      (cleared ? ' atlas-node--cleared' : unlocked ? ' atlas-node--open' : ' atlas-node--locked') +
      (state.selectedNode === n.id ? ' atlas-node--selected' : '') +
      (cls ? ' atlas-node--root' : '') +
      (isApex ? ' atlas-node--apex' : ''),
    'data-node': n.id,
    tabindex: unlocked ? 0 : -1,
    role: 'button',
    'aria-label': `${n.name}, tier ${n.tier}` +
      (cleared ? ', cleared' : unlocked ? '' : ', locked') +
      (cls ? `, ${cls.name} start` : ''),
  });
  // per-node marker color: class color on roots, gold on apex, else biome
  g.style.setProperty('--np', isApex ? 'var(--mm-gold, #c8aa6e)' : cls ? cls.color : biomeColor(n));

  g.appendChild(el('circle', { cx: n.x, cy: n.y, r: R + 9, class: 'atlas-node__halo' }));
  if (isApex) {
    g.appendChild(el('path', {
      d: radialTicks(n.x, n.y, R + 9, R + 16, 12, -Math.PI / 2 + Math.PI / 12),
      class: 'atlas-node__rays',
    }));
  }
  g.appendChild(el('circle', { cx: n.x, cy: n.y, r: R + 4.5, class: 'atlas-node__outer' }));
  g.appendChild(el('path', { d: radialTicks(n.x, n.y, R + 4.5, R + 8, 8), class: 'atlas-node__ticks' }));
  g.appendChild(el('circle', { cx: n.x, cy: n.y, r: R, class: 'atlas-node__ring' }));
  g.appendChild(el('circle', {
    cx: n.x, cy: n.y, r: R - 6, class: 'atlas-node__core',
    fill: unlocked ? (isApex ? '#c8aa6e' : biomeColor(n)) : 'transparent',
  }));
  const t = el('text', { x: n.x, y: n.y + (isApex ? 5 : 4.5), class: 'atlas-node__tier' });
  t.textContent = cleared ? '✓' : n.tier;
  g.appendChild(t);

  if (cls) {
    const glyph = el('text', { x: n.x, y: n.y - R - 9, class: 'atlas-node__glyph' });
    glyph.textContent = cls.icon;
    g.appendChild(glyph);
    const cap = el('text', { x: n.x, y: n.y + R + 18, class: 'atlas-node__caption' });
    cap.textContent = `${cls.name} start`;
    g.appendChild(cap);
  }
  if (isApex) {
    const cap = el('text', { x: n.x, y: n.y + R + 26, class: 'atlas-node__caption atlas-node__caption--apex' });
    cap.textContent = 'The Apex';
    g.appendChild(cap);
  }
  svg.appendChild(g);
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
