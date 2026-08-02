// ── Game definitions ─────────────────────────────────────────
// Static data: classes, body options, biomes, atlas graph, rarities.
// Pure data + tiny deterministic builders. No DOM.

export const CLASSES = {
  druid: {
    id: 'druid', name: 'Druid', icon: '🜃',
    blurb: 'Hits things with the forest. Short reach, heavy paws.',
    dmgMult: 1.25, lifeMult: 1.2, range: 2.0, atkCd: 1.05, cleave: 1.4,
    skill: {
      name: 'Entangling Burst', key: 'burst', radius: 4.2, dmgMult: 3.0,
      snare: 2.0, mana: 60, cd: 5, desc: 'Roots and shreds everything around you.',
    },
    vfx: 'thorn', color: '#7dbb5e',
  },
  archer: {
    id: 'archer', name: 'Archer', icon: '➵',
    blurb: 'Deletes dots from a polite distance.',
    dmgMult: 0.9, lifeMult: 1.0, range: 7.5, atkCd: 0.7, cleave: 0,
    skill: {
      name: 'Piercing Shot', key: 'pierce', length: 10, width: 1.1, dmgMult: 2.6,
      mana: 45, cd: 4, desc: 'One arrow, every dot in the line.',
    },
    vfx: 'arrow', color: '#d8c06a',
  },
  mage: {
    id: 'mage', name: 'Mage', icon: '❄',
    blurb: 'Freezes the map. Squishy but dramatic.',
    dmgMult: 1.05, lifeMult: 0.85, range: 5.5, atkCd: 0.85, cleave: 0.9,
    skill: {
      name: 'Frost Nova', key: 'nova', radius: 3.8, dmgMult: 2.2,
      slow: 0.45, slowDur: 3.0, mana: 70, cd: 4.5, desc: 'A ring of cold that slows the swarm.',
    },
    vfx: 'frost', color: '#7fd4f0',
  },
};

export const BODY = {
  sex: [
    { id: 'man', label: 'Man' },
    { id: 'woman', label: 'Woman' },
  ],
  height: [
    { id: 'short', label: 'Short' },
    { id: 'average', label: 'Average' },
    { id: 'tall', label: 'Tall' },
  ],
  build: {
    man: [
      { id: 'lean', label: 'Lean' },
      { id: 'broad', label: 'Broad' },
      { id: 'stocky', label: 'Stocky' },
    ],
    woman: [
      { id: 'lean', label: 'Lean' },
      { id: 'athletic', label: 'Athletic' },
      { id: 'sturdy', label: 'Sturdy' },
    ],
  },
  hair: {
    man: [
      { id: 'bald', label: 'Bald' },
      { id: 'short', label: 'Short crop' },
      { id: 'wild', label: 'Wild' },
      { id: 'topknot', label: 'Topknot' },
    ],
    woman: [
      { id: 'short', label: 'Short crop' },
      { id: 'braid', label: 'Braid' },
      { id: 'long', label: 'Long' },
      { id: 'bun', label: 'War bun' },
    ],
  },
};

export const RARITY = {
  normal: { id: 'normal', color: '#e6e2d8', hpMult: 1, xpMult: 1, dmgMult: 1, r: 3 },
  magic:  { id: 'magic',  color: '#7f9bff', hpMult: 3, xpMult: 3, dmgMult: 1.3, r: 4 },
  rare:   { id: 'rare',   color: '#ffd955', hpMult: 8, xpMult: 8, dmgMult: 1.7, r: 5 },
  boss:   { id: 'boss',   color: '#ff9040', hpMult: 28, xpMult: 60, dmgMult: 3.2, r: 8 },
};

export const BIOMES = {
  caverns: {
    id: 'caverns', name: 'Caverns',
    line: '#cfd6ef', wpColor: '#6fc3ff',
    bg: ['#120d08', '#2a1c10', '#3d2a14', '#1a1410', '#241207'],
    gen: { roomMin: 5, roomMax: 11, rooms: 15, wind: 0.5 },
    maps: ['The Fetid Pool', 'Gutter of Echoes', 'The Dripping Dark', 'Chamber of Regret'],
    bosses: ['The Azak Bog Rat', 'Gnarl, Fist of Gravel', 'The Damp Custodian'],
    quest: { title: 'The Slithering Dead', body: 'Find whatever keeps squeaking in the dark and make it stop.' },
  },
  wetlands: {
    id: 'wetlands', name: 'Wetlands',
    line: '#c9e3d8', wpColor: '#63e0c0',
    bg: ['#0a1410', '#12291c', '#1d3a24', '#0d1c12', '#25331a'],
    gen: { roomMin: 6, roomMax: 13, rooms: 13, wind: 0.75 },
    maps: ['Chimeral Wetlands', 'The Sunken Commute', 'Mosquito Republic', 'Bog of Mild Peril'],
    bosses: ['Ignagduk the Moist', 'The Tax Heron', 'Queen of Wet Socks'],
    quest: { title: 'Tribal Vengeance', body: 'Travel to the wetlands and slay whoever flooded the basement.' },
  },
  forest: {
    id: 'forest', name: 'Forest',
    line: '#d7e8c9', wpColor: '#8fe06a',
    gen: { roomMin: 5, roomMax: 10, rooms: 17, wind: 0.9 },
    bg: ['#0c130a', '#1c2b14', '#2c401c', '#132008', '#3a4a1e'],
    maps: ['The Carver Village', 'Root Tangle', 'Grove of Second Thoughts', 'The Mushroom HOA'],
    bosses: ['Ignagduk, Bark Prophet', 'The Landlord of Leaves', 'Sap Tyrant Vex'],
    quest: { title: 'Legacy of the Vaal', body: 'Find the carver village and ask, firmly, about the noises.' },
  },
  ruins: {
    id: 'ruins', name: 'Ruins',
    line: '#e3d9c2', wpColor: '#e0b463',
    gen: { roomMin: 7, roomMax: 14, rooms: 12, wind: 0.3 },
    bg: ['#14100a', '#2e2718', '#453a22', '#1c170e', '#332a14'],
    maps: ['Vaults of Deprecation', 'The Broken Colonnade', 'Legacy Codebase', 'Halls of the Unmaintained'],
    bosses: ['The Azak Archivist', 'Doryani of the Spreadsheet', 'The Last Stakeholder'],
    quest: { title: 'The Unpaid Invoice', body: 'Recover the artifact. It is load-bearing.' },
  },
  crypt: {
    id: 'crypt', name: 'Crypt',
    line: '#d9cfe8', wpColor: '#b48fe0',
    gen: { roomMin: 4, roomMax: 9, rooms: 18, wind: 0.4 },
    bg: ['#0d0a14', '#1d1430', '#2a1c45', '#120e1c', '#241433'],
    maps: ['Tomb of the First Squint', 'The Quiet Floor', 'Ossuary of Alt Accounts', 'The Refund Crypt'],
    bosses: ['Kadaka the Undying-ish', 'The Silent Necromancer', 'Bishop of Bones'],
    quest: { title: 'Whispers Below', body: 'Descend into the crypt and source the whispering. Poison is suspected.' },
  },
};

const BIOME_ORDER = ['caverns', 'wetlands', 'forest', 'ruins', 'crypt'];

/** Atlas graph: 8 tiers x 3 rows on a 1000x560 canvas. Deterministic layout. */
export const ATLAS = buildAtlas();

function buildAtlas() {
  const nodes = [];
  const rows = [110, 285, 460];
  const jitter = [18, -26, 8, -12, 22, -6, 14, -20]; // fixed per tier, keeps layout organic
  for (let tier = 1; tier <= 8; tier++) {
    for (let row = 0; row < 3; row++) {
      const biome = BIOMES[BIOME_ORDER[(tier + row * 2) % BIOME_ORDER.length]];
      const nameIdx = (tier * 3 + row) % biome.maps.length;
      nodes.push({
        id: `t${tier}${'abc'[row]}`,
        tier, row,
        biome: biome.id,
        name: biome.maps[nameIdx],
        boss: biome.bosses[(tier + row) % biome.bosses.length],
        x: 75 + (tier - 1) * 122 + (row % 2 ? -jitter[tier - 1] : jitter[tier - 1]) * 0.6,
        y: rows[row] + jitter[(tier + row) % 8],
        links: [],
      });
    }
  }
  // Links: same row to next tier, plus a zigzag cross-link so paths branch
  for (const n of nodes) {
    if (n.tier < 8) {
      link(nodes, n.id, `t${n.tier + 1}${'abc'[n.row]}`);
      if ((n.tier + n.row) % 2 === 0) {
        const crossRow = n.row === 2 ? 1 : n.row + 1;
        link(nodes, n.id, `t${n.tier + 1}${'abc'[crossRow]}`);
      }
    }
  }
  return nodes;
}

function link(nodes, a, b) {
  const na = nodes.find((n) => n.id === a);
  const nb = nodes.find((n) => n.id === b);
  if (na && nb && !na.links.includes(b)) { na.links.push(b); nb.links.push(a); }
}

export function atlasNode(id) { return ATLAS.find((n) => n.id === id); }

/** Nodes open at the start of every new character. */
export const STARTING_NODES = ['t1a', 't1b', 't1c'];

export const DEATH_LINES = [
  'The minimap regrets to inform you.',
  'You were 2% from leveling. Everyone saw.',
  'A dot got you. A white one. Embarrassing.',
  'The floor circle was, in fact, not decorative.',
  'Your build was fine. Your dodging was not.',
];

export const DEFAULT_NAMES = ['Exile', 'Dot Enjoyer', 'Cartographer', 'Squintlord', 'Waypoint Andy'];
