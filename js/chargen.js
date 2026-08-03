// ── Character creation + roster ──────────────────────────────
// First-run flow: class, body options, name, silhouette preview,
// and a skip button. Roster screen manages multiple exiles.

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

/** Placeholder portrait: an SVG silhouette shaped by the body choices.
    Real art drops into assets/portraits/ later (see docs/ASSETS.md). */
export function renderPortrait() {
  const cls = CLASSES[draft.cls];
  const h = { short: 0.86, average: 1, tall: 1.12 }[draft.body.height] || 1;
  const w = { lean: 0.85, broad: 1.18, stocky: 1.28, athletic: 1.0, sturdy: 1.15 }[draft.body.build] || 1;
  const hairMap = {
    bald: '', short: 'M-14,-8 A14,12 0 0 1 14,-8 L12,-2 A12,10 0 0 0 -12,-2 Z',
    wild: 'M-16,-6 L-10,-16 L-4,-9 L2,-18 L8,-9 L14,-14 L16,-4 A16,14 0 0 0 -16,-6 Z',
    topknot: 'M-13,-7 A13,11 0 0 1 13,-7 L11,-2 A11,9 0 0 0 -11,-2 Z M-3,-16 L3,-16 L2,-9 L-2,-9 Z',
    braid: 'M-13,-7 A13,11 0 0 1 13,-7 L11,-2 A11,9 0 0 0 -11,-2 Z M10,-4 L16,14 L11,15 L7,-1 Z',
    long: 'M-14,-7 A14,12 0 0 1 14,-7 L14,18 L9,18 L8,0 L-8,0 L-9,18 L-14,18 Z',
    bun: 'M-12,-7 A12,10 0 0 1 12,-7 L10,-2 A10,8 0 0 0 -10,-2 Z M-5,-16 A5,5 0 0 1 5,-16 A5,5 0 0 1 -5,-16 Z',
  };
  const item = {
    druid: `<path d="M30,-40 C40,-55 55,-55 58,-38 C60,-24 48,-18 42,-24 C48,-34 44,-42 36,-36 Z" fill="${cls.color}" opacity="0.85"/><line x1="34" y1="-30" x2="34" y2="46" stroke="${cls.color}" stroke-width="4" opacity="0.85"/>`,
    archer: `<path d="M36,-44 Q62,0 36,44" fill="none" stroke="${cls.color}" stroke-width="4" opacity="0.85"/><line x1="36" y1="-44" x2="36" y2="44" stroke="${cls.color}" stroke-width="2" opacity="0.6"/>`,
    mage: `<line x1="36" y1="-42" x2="36" y2="46" stroke="${cls.color}" stroke-width="4" opacity="0.85"/><circle cx="36" cy="-48" r="7" fill="${cls.color}" opacity="0.9"/>`,
  }[draft.cls];

  $('portraitBox').innerHTML = `
    <svg viewBox="-70 -90 140 180" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="0" cy="74" rx="46" ry="8" fill="rgba(125,211,252,0.10)"/>
      <g transform="scale(1, ${h})">
        <g fill="#2c3550">
          <circle cx="0" cy="-52" r="13"/>
          <path d="M ${-16 * w},-34 C ${-22 * w},-10 ${-18 * w},20 ${-13 * w},44 L ${13 * w},44 C ${18 * w},20 ${22 * w},-10 ${16 * w},-34 Q 0,-42 ${-16 * w},-34 Z"/>
          <rect x="${-14 * w}" y="44" width="${9 * w}" height="24" rx="4"/>
          <rect x="${5 * w}" y="44" width="${9 * w}" height="24" rx="4"/>
        </g>
        <g transform="translate(0,-52)" fill="#3a4568">${hairMap[draft.body.hair] ? `<path d="${hairMap[draft.body.hair]}"/>` : ''}</g>
        ${item}
      </g>
      <text x="0" y="86" text-anchor="middle" class="portrait-tag">${cls.name} · ${draft.body.height} · ${draft.body.build}</text>
    </svg>`;
}

// ── Roster ───────────────────────────────────────────────────

export function renderRoster() {
  const list = $('rosterList');
  list.innerHTML = '';
  if (state.roster.length === 0) {
    list.innerHTML = '<p class="roster__empty">No exiles yet. The Atlas waits.</p>';
    return;
  }
  for (const c of state.roster) {
    const cls = CLASSES[c.cls];
    const card = document.createElement('div');
    card.className = 'roster-card' + (c.id === state.activeId ? ' roster-card--active' : '');
    card.innerHTML = `
      <span class="roster-card__icon" style="color:${cls.color}">${cls.icon}</span>
      <div class="roster-card__info">
        <strong>${escHtml(c.name)}</strong>
        <span>Level ${c.level} ${cls.name} · ${c.atlas.cleared.length} maps cleared · ${c.deaths} deaths</span>
      </div>
      <div class="roster-card__actions">
        <button class="btn btn--primary btn--sm" data-play="${c.id}">Play</button>
        <button class="btn btn--danger btn--sm" data-del="${c.id}">Delete</button>
      </div>`;
    list.appendChild(card);
  }
}

export function hasActiveChar() { return Boolean(activeChar(state)); }
