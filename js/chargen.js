// ── Character creation + roster ──────────────────────────────
// First-run flow: class, body options, name, silhouette preview,
// and a skip button. Roster screen manages multiple exiles.
// Portrait silhouettes are placeholder art with intent: layered
// SVG (arch backdrop, rim light, class props). Real art drops
// into assets/portraits/ later (see docs/ASSETS.md).

import { $, escHtml } from './utils.js';
import { CLASSES, BODY } from './defs.js';
import { state, activeChar } from './state.js';

// draft the user is editing, seeded with defaults
export const draft = {
  cls: 'archer',
  body: { sex: 'man', height: 'average', build: 'lean', hair: 'short' },
};

export function renderChargen() {
  renderClassPicker();
  renderBodyOptions();
  renderPortrait();
}

function renderClassPicker() {
  const box = $('classPicker');
  box.innerHTML = '';
  for (const cls of Object.values(CLASSES)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'class-card' + (draft.cls === cls.id ? ' class-card--active' : '');
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(draft.cls === cls.id));
    btn.dataset.cls = cls.id;
    btn.style.setProperty('--cls', cls.color);
    btn.innerHTML = `
      <span class="class-card__icon" style="color:${cls.color}">${cls.icon}</span>
      <span class="class-card__name">${cls.name}</span>
      <span class="class-card__blurb">${escHtml(cls.blurb)}</span>
      <span class="class-card__skill">${cls.skills.map((s) => escHtml(s.name)).join(' · ')}</span>`;
    box.appendChild(btn);
  }
}

function renderBodyOptions() {
  const box = $('bodyOptions');
  box.innerHTML = '';
  addOptionRow(box, 'Sex', 'sex', BODY.sex, draft.body.sex);
  addOptionRow(box, 'Height', 'height', BODY.height, draft.body.height);
  addOptionRow(box, 'Build', 'build', BODY.build[draft.body.sex], draft.body.build);
  addOptionRow(box, 'Hair', 'hair', BODY.hair[draft.body.sex], draft.body.hair);
}

function addOptionRow(box, label, key, options, current) {
  const row = document.createElement('div');
  row.className = 'opt-row';
  const lab = document.createElement('span');
  lab.className = 'opt-row__label';
  lab.textContent = label;
  row.appendChild(lab);
  const chips = document.createElement('div');
  chips.className = 'opt-row__chips';
  for (const opt of options) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (current === opt.id ? ' chip--active' : '');
    chip.dataset.key = key;
    chip.dataset.value = opt.id;
    chip.textContent = opt.label;
    chips.appendChild(chip);
  }
  row.appendChild(chips);
  box.appendChild(row);
}

/** Update draft from a chip click; keeps per-sex options valid. */
export function setDraftOption(key, value) {
  if (key === 'sex') {
    draft.body.sex = value;
    if (!BODY.build[value].some((o) => o.id === draft.body.build)) draft.body.build = BODY.build[value][0].id;
    if (!BODY.hair[value].some((o) => o.id === draft.body.hair)) draft.body.hair = BODY.hair[value][0].id;
  } else {
    draft.body[key] = value;
  }
  renderBodyOptions();
  renderPortrait();
}

export function setDraftClass(clsId) {
  draft.cls = clsId;
  renderClassPicker();
  renderPortrait();
}

// ── Portrait silhouette builder ──────────────────────────────
// Figure coordinate space: head center (0,-52) r13, torso down to
// y=44, legs to y=68 (the feet line). Height scaling anchors the
// feet so short/tall figures share the same ground plane.

const HEIGHT_SCALE = { short: 0.82, average: 1, tall: 1.16 };
const BUILD_SCALE = { lean: 0.8, broad: 1.22, stocky: 1.32, athletic: 1.0, sturdy: 1.18 };
const INK_BODY = '#2c3550';
const INK_HAIR = '#3a4568';

const HAIR_PATHS = {
  bald: '',
  short: 'M-14,-8 A14,12 0 0 1 14,-8 L12,-2 A12,10 0 0 0 -12,-2 Z',
  wild: 'M-16,-6 L-10,-16 L-4,-9 L2,-18 L8,-9 L14,-14 L16,-4 A16,14 0 0 0 -16,-6 Z',
  topknot: 'M-13,-7 A13,11 0 0 1 13,-7 L11,-2 A11,9 0 0 0 -11,-2 Z M-3,-16 L3,-16 L2,-9 L-2,-9 Z',
  braid: 'M-13,-7 A13,11 0 0 1 13,-7 L11,-2 A11,9 0 0 0 -11,-2 Z M10,-4 L16,14 L11,15 L7,-1 Z',
  long: 'M-14,-7 A14,12 0 0 1 14,-7 L14,18 L9,18 L8,0 L-8,0 L-9,18 L-14,18 Z',
  bun: 'M-12,-7 A12,10 0 0 1 12,-7 L10,-2 A10,8 0 0 0 -10,-2 Z M-5,-16 A5,5 0 0 1 5,-16 A5,5 0 0 1 -5,-16 Z',
  ponytail: 'M-13,-7 A13,11 0 0 1 13,-7 L11,-2 A11,9 0 0 0 -11,-2 Z M8,-6 C15,-1 15,9 12,18 L8,17 C10,9 9,1 5,-2 Z',
  mohawk: 'M-5,-4 L-4,-16 L-1,-20 L2,-15 L5,-18 L6,-4 Z',
  twintails: 'M-13,-7 A13,11 0 0 1 13,-7 L11,-2 A11,9 0 0 0 -11,-2 Z M-11,-4 L-17,12 L-12,14 L-7,-1 Z M11,-4 L17,12 L12,14 L7,-1 Z',
  sidecut: 'M-14,-5 A14,12 0 0 1 11,-10 L13,-4 C5,-10 -4,-9 -9,-2 L-10,10 L-14,8 Z',
};

/** Class prop overlays, drawn in figure space in the class color. */
function classProp(clsId, c) {
  if (clsId === 'druid') {
    return `
      <g stroke="${c}" fill="none" stroke-linecap="round">
        <path d="M33,-46 C29,-30 39,-18 33,0 C28,16 38,30 34,50" stroke-width="4" opacity="0.9"/>
        <path d="M33,-46 C40,-58 54,-56 55,-44 C56,-34 46,-30 42,-36" stroke-width="3.5" opacity="0.85"/>
        <path d="M33,-20 L40,-25 M34,6 L27,1 M34,26 L40,22" stroke-width="2.2" opacity="0.55"/>
      </g>
      <g transform="translate(0,-52)" stroke="${c}" fill="none" stroke-linecap="round" stroke-width="2" opacity="0.55">
        <path d="M-9,-9 C-13,-14 -12,-19 -16,-24 M-12,-15 L-17,-17"/>
        <path d="M9,-9 C13,-14 12,-19 16,-24 M12,-15 L17,-17"/>
      </g>`;
  }
  if (clsId === 'archer') {
    return `
      <g transform="translate(-24,-26) rotate(16)">
        <rect x="-6" y="-2" width="12" height="26" rx="4" fill="${c}" opacity="0.3"/>
        <rect x="-6" y="-2" width="12" height="26" rx="4" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.7"/>
        <g stroke="${c}" stroke-width="2" stroke-linecap="round" opacity="0.8">
          <path d="M-2,-11 L-2,-2 M3,-13 L3,-2"/>
          <path d="M-2,-11 L-5,-8 M-2,-11 L1,-8 M3,-13 L0,-10 M3,-13 L6,-10" stroke-width="1.5"/>
        </g>
      </g>
      <g stroke="${c}" fill="none" stroke-linecap="round">
        <path d="M36,-46 Q66,0 36,46" stroke-width="4" opacity="0.9"/>
        <line x1="36" y1="-46" x2="36" y2="46" stroke-width="1.5" opacity="0.5"/>
      </g>`;
  }
  // mage: staff, floating orb, faint frost motes
  return `
    <g stroke="${c}" fill="none" stroke-linecap="round">
      <line x1="35" y1="-38" x2="35" y2="48" stroke-width="3.5" opacity="0.9"/>
      <path d="M28,-38 L42,-38" stroke-width="2.5" opacity="0.7"/>
    </g>
    <circle cx="35" cy="-52" r="11" fill="${c}" opacity="0.15"/>
    <circle cx="35" cy="-52" r="6.5" fill="${c}" opacity="0.9"/>
    <g fill="${c}">
      <circle cx="-30" cy="-46" r="2" opacity="0.4"/>
      <circle cx="-40" cy="-16" r="1.5" opacity="0.3"/>
      <circle cx="48" cy="-12" r="1.7" opacity="0.35"/>
      <circle cx="-22" cy="22" r="1.4" opacity="0.25"/>
    </g>`;
}

/** Build the layered silhouette SVG. opts.compact drops the arch,
    tag, and breathe animation for roster-sized thumbnails. */
function portraitSvg(clsId, body = {}, opts = {}) {
  const cls = CLASSES[clsId] || CLASSES.archer;
  const c = cls.color;
  const h = HEIGHT_SCALE[body.height] || 1;
  const w = BUILD_SCALE[body.build] || 1;
  const lift = (68 * (1 - h)).toFixed(1);
  const hairD = HAIR_PATHS[body.hair] || '';
  const compact = Boolean(opts.compact);

  const bodyShapes = `
    <circle cx="0" cy="-52" r="13"/>
    <path d="M ${-16 * w},-34 C ${-22 * w},-10 ${-18 * w},20 ${-13 * w},44 L ${13 * w},44 C ${18 * w},20 ${22 * w},-10 ${16 * w},-34 Q 0,-42 ${-16 * w},-34 Z"/>
    <rect x="${-14 * w}" y="44" width="${9 * w}" height="24" rx="4"/>
    <rect x="${5 * w}" y="44" width="${9 * w}" height="24" rx="4"/>`;
  const hairShape = hairD ? `<g transform="translate(0,-52)"><path d="${hairD}"/></g>` : '';

  const backdrop = compact
    ? `<circle cx="0" cy="-10" r="52" fill="${c}" opacity="0.06"/>`
    : `
      <path d="M-48,76 L-48,-34 A48,52 0 0 1 48,-34 L48,76 Z" fill="${c}" opacity="0.05"/>
      <path d="M-42,76 L-42,-32 A42,46 0 0 1 42,-32 L42,76" fill="none" stroke="${c}" stroke-opacity="0.14" stroke-width="1.5"/>
      <path d="M-15,-92 L15,-92 L15,-16 L0,-26 L-15,-16 Z" fill="${c}" opacity="0.07"/>`;

  const shRx = 26 * w + 12;
  const tag = compact ? '' :
    `<text x="0" y="86" text-anchor="middle" class="portrait-tag">${cls.name} · ${body.height || ''} · ${body.build || ''}</text>`;

  return `
    <svg viewBox="${compact ? '-56 -100 112 184' : '-70 -100 140 190'}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${backdrop}
      <ellipse cx="0" cy="74" rx="${shRx.toFixed(1)}" ry="7" fill="rgba(0,0,0,0.5)"/>
      <ellipse cx="0" cy="74" rx="${(shRx * 0.55).toFixed(1)}" ry="4" fill="${c}" opacity="0.12"/>
      <g transform="translate(0, ${lift}) scale(1, ${h})">
        <g${compact ? '' : ' class="portrait-breathe"'}>
          <g fill="${c}" opacity="0.5" transform="translate(-1.8,-1.4)">${bodyShapes}${hairShape}</g>
          <g fill="${INK_BODY}">${bodyShapes}</g>
          <g fill="${INK_HAIR}">${hairShape}</g>
          ${classProp(cls.id, c)}
        </g>
      </g>
      ${tag}
    </svg>`;
}

/** Placeholder portrait preview for the chargen screen. */
export function renderPortrait() {
  $('portraitBox').innerHTML = portraitSvg(draft.cls, draft.body);
}

// ── Roster ───────────────────────────────────────────────────

/** Max tier among cleared atlas nodes; 'apex' counts as tier 8. */
function deepestTier(char) {
  let deep = 0;
  for (const id of char.atlas?.cleared || []) {
    if (id === 'apex') { deep = Math.max(deep, 8); continue; }
    const m = /^t(\d+)/.exec(id);
    if (m) deep = Math.max(deep, Number(m[1]));
  }
  return deep;
}

export function renderRoster() {
  const list = $('rosterList');
  list.innerHTML = '';
  if (state.roster.length === 0) {
    list.innerHTML = '<p class="roster__empty">No exiles yet. The Atlas waits.</p>';
    return;
  }
  for (const c of state.roster) {
    const cls = CLASSES[c.cls];
    const deep = deepestTier(c);
    const card = document.createElement('div');
    card.className = 'roster-card' + (c.id === state.activeId ? ' roster-card--active' : '');
    card.style.setProperty('--cls', cls.color);
    card.innerHTML = `
      <span class="roster-card__thumb">${portraitSvg(c.cls, c.body || {}, { compact: true })}</span>
      <div class="roster-card__info">
        <strong>${escHtml(c.name)}</strong>
        <span>Level ${c.level} ${cls.name} · ${c.atlas.cleared.length} maps cleared · ${c.deaths} deaths</span>
        <span class="roster-card__tier">${deep > 0 ? `Deepest map: tier ${deep}` : 'Deepest map: none yet'}</span>
      </div>
      <div class="roster-card__actions">
        <button class="btn btn--primary btn--sm" data-play="${c.id}">Play</button>
        <button class="btn btn--danger btn--sm" data-del="${c.id}">Delete</button>
      </div>`;
    list.appendChild(card);
  }
}

export function hasActiveChar() { return Boolean(activeChar(state)); }
