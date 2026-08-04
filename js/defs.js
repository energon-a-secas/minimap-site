// ── Game definitions ─────────────────────────────────────────
// Static data: classes, body options, biomes, atlas graph, rarities.
// Pure data + tiny deterministic builders. No DOM.

export const CLASSES = {
  druid: {
    id: 'druid', name: 'Druid', icon: '🜃',
    blurb: 'Hits things with the forest. Short reach, heavy paws.',
    dmgMult: 1.25, lifeMult: 1.2, range: 2.0, atkCd: 1.05, cleave: 1.4,
    skills: [
      { id: 'burst', name: 'Entangling Burst', icon: '🜃', kb: 'Q', type: 'burst',
        radius: 4.2, dmgMult: 3.0, snare: 2.0, mana: 60, cd: 5,
        desc: 'Roots and shreds everything around you.' },
      { id: 'vinepatch', name: 'Vine Patch', icon: '✿', kb: 'E', type: 'zoneCircle',
        radius: 2.8, dmgMult: 0.8, tick: 0.5, dur: 2.6, mana: 55, cd: 8,
        desc: 'Grows a patch of grabbing vines that holds and shreds for a few seconds.' },
      { id: 'vinewall', name: 'Vine Row', icon: '∿', kb: 'R', type: 'zoneLine',
        length: 8, width: 1.4, dmgMult: 0.7, tick: 0.5, dur: 2.8, mana: 85, cd: 12,
        desc: 'A row of green vines along your aim that stays and snares.' },
    ],
    vfx: 'thorn', color: '#7dbb5e',
  },
  archer: {
    id: 'archer', name: 'Archer', icon: '➵',
    blurb: 'Deletes dots from a polite distance.',
    dmgMult: 0.9, lifeMult: 1.0, range: 7.5, atkCd: 0.7, cleave: 0,
    skills: [
      { id: 'pierce', name: 'Piercing Shot', icon: '➵', kb: 'Q', type: 'pierce',
        length: 10, width: 1.1, dmgMult: 2.6, mana: 45, cd: 4,
        desc: 'One arrow, every dot in the line.' },
      { id: 'overcharge', name: 'Overcharge', icon: '⋔', kb: 'E', type: 'buff',
        buff: 'overcharge', dur: 6, extraTargets: 2, mana: 45, cd: 9,
        desc: 'Extra charged arrows: each shot also strikes 2 nearby dots for 6s.' },
      { id: 'chargedshot', name: 'Charged Shot', icon: '➹', kb: 'R', type: 'charged',
        channel: 0.8, length: 12, width: 1.5, dmgMult: 6.0, mana: 80, cd: 14,
        desc: 'Plant your feet, draw deep, and delete a whole lane.' },
    ],
    vfx: 'arrow', color: '#d8c06a',
  },
  mage: {
    id: 'mage', name: 'Mage', icon: '❄',
    blurb: 'Freezes the map. Squishy but dramatic.',
    dmgMult: 1.05, lifeMult: 0.85, range: 5.5, atkCd: 0.85, cleave: 0.9,
    skills: [
      { id: 'nova', name: 'Frost Nova', icon: '❄', kb: 'Q', type: 'nova',
        radius: 3.8, dmgMult: 2.2, slow: 0.45, slowDur: 3.0, mana: 70, cd: 4.5,
        desc: 'A ring of cold that slows the swarm.' },
      { id: 'surge', name: 'Arcane Surge', icon: '✦', kb: 'E', type: 'buff',
        buff: 'surge', dur: 4, atkSpeed: 1.4, moveSpeed: 1.25, mana: 50, cd: 10,
        desc: 'Overclock the wizard: cast and move faster for 4s.' },
      { id: 'comet', name: 'Comet', icon: '☄', kb: 'R', type: 'comet',
        radius: 3.0, dmgMult: 4.0, delay: 0.9, range: 8, mana: 90, cd: 12,
        desc: 'Call something heavy down on the thickest cluster.' },
    ],
    vfx: 'frost', color: '#7fd4f0',
  },
};

/** Movement abilities shared by every class. */
export const MOVES = {
  roll: { dist: 3.2, dur: 0.3, cd: 1.6 },              // Space: dash with i-frames, passes through enemies
  sprint: { speedMult: 1.55, stun: 2.5, grace: 1.2 },  // Shift: fast, but a hit while sprinting stuns you
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
      { id: 'ponytail', label: 'Ponytail' },
      { id: 'mohawk', label: 'Mohawk' },
    ],
    woman: [
      { id: 'short', label: 'Short crop' },
      { id: 'braid', label: 'Braid' },
      { id: 'long', label: 'Long' },
      { id: 'bun', label: 'War bun' },
      { id: 'twintails', label: 'Twin tails' },
      { id: 'sidecut', label: 'Sidecut' },
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
    maps: ['The Fetid Pool', 'Gutter of Echoes', 'The Dripping Dark', 'Chamber of Regret', 'The Unlit Stairwell', 'Hall of Persistent Dripping'],
    bosses: ['The Azak Bog Rat', 'Gnarl, Fist of Gravel', 'The Damp Custodian', 'Echo, Herald of Echoes', 'The Stalactite Inspector'],
    quest: { title: 'The Slithering Dead', body: 'Something in the dark keeps squeaking. Find it. Make it stop.' },
  },
  wetlands: {
    id: 'wetlands', name: 'Wetlands',
    line: '#c9e3d8', wpColor: '#63e0c0',
    bg: ['#0a1410', '#12291c', '#1d3a24', '#0d1c12', '#25331a'],
    gen: { roomMin: 6, roomMax: 13, rooms: 13, wind: 0.75 },
    maps: ['Chimeral Wetlands', 'The Sunken Commute', 'Mosquito Republic', 'Bog of Mild Peril', 'Delta of Diminishing Returns', 'Fen of Soft Commitments'],
    bosses: ['Ignagduk the Moist', 'The Tax Heron', 'Queen of Wet Socks', 'Chancellor Leech', 'The Puddle That Fights Back'],
    quest: { title: 'Tribal Vengeance', body: 'Wade into the wetlands and slay whoever flooded the basement. Bring boots.' },
  },
  forest: {
    id: 'forest', name: 'Forest',
    line: '#d7e8c9', wpColor: '#8fe06a',
    gen: { roomMin: 5, roomMax: 10, rooms: 17, wind: 0.9 },
    bg: ['#0c130a', '#1c2b14', '#2c401c', '#132008', '#3a4a1e'],
    maps: ['The Carver Village', 'Root Tangle', 'Grove of Second Thoughts', 'The Mushroom HOA', 'Thicket of Unsolicited Advice', 'The Ominous Clearing'],
    bosses: ['Ignagduk, Bark Prophet', 'The Landlord of Leaves', 'Sap Tyrant Vex', 'Mulch, the Patient', 'The Compost Warden'],
    quest: { title: 'Legacy of the Vaal', body: 'Find the carver village and ask, firmly, about the noises.' },
  },
  ruins: {
    id: 'ruins', name: 'Ruins',
    line: '#e3d9c2', wpColor: '#e0b463',
    gen: { roomMin: 7, roomMax: 14, rooms: 12, wind: 0.3 },
    bg: ['#14100a', '#2e2718', '#453a22', '#1c170e', '#332a14'],
    maps: ['Vaults of Deprecation', 'The Broken Colonnade', 'Legacy Codebase', 'Halls of the Unmaintained', 'The Sunset Wing', 'Atrium of Broken Promises'],
    bosses: ['The Azak Archivist', 'Doryani of the Spreadsheet', 'The Last Stakeholder', 'The Scope Creep', 'Auditor Prime'],
    quest: { title: 'The Unpaid Invoice', body: 'Recover the artifact. It is load-bearing.' },
  },
  crypt: {
    id: 'crypt', name: 'Crypt',
    line: '#d9cfe8', wpColor: '#b48fe0',
    gen: { roomMin: 4, roomMax: 9, rooms: 18, wind: 0.4 },
    bg: ['#0d0a14', '#1d1430', '#2a1c45', '#120e1c', '#241433'],
    maps: ['Tomb of the First Squint', 'The Quiet Floor', 'Ossuary of Alt Accounts', 'The Refund Crypt', 'Catacomb of Unread Scrolls', 'The Do Not Disturb Wing'],
    bosses: ['Kadaka the Undying-ish', 'The Silent Necromancer', 'Bishop of Bones', 'The Reanimated Intern', 'Curator of the Fourth Rib'],
    quest: { title: 'Whispers Below', body: 'Descend and source the whispering. Poison is suspected. It always is.' },
  },
};

const BIOME_ORDER = ['caverns', 'wetlands', 'forest', 'ruins', 'crypt'];

/** Atlas graph: three class roots climb tiers 1-7 (separate for the
    first two tiers, interweaving from tier 3) and converge on a
    single apex node holding the final boss. 22 nodes, 1000x560. */
export const ATLAS = buildAtlas();

/** Each class begins its climb at its own root node. */
export const START_NODES = { druid: 't1a', archer: 't1b', mage: 't1c' };

function buildAtlas() {
  const nodes = [];
  const rows = [110, 285, 460];
  const jitter = [18, -26, 8, -12, 22, -6, 14]; // fixed per tier, keeps layout organic
  for (let tier = 1; tier <= 7; tier++) {
    for (let row = 0; row < 3; row++) {
      const biome = BIOMES[BIOME_ORDER[(tier + row * 2) % BIOME_ORDER.length]];
      const nameIdx = (tier * 3 + row) % biome.maps.length;
      nodes.push({
        id: `t${tier}${'abc'[row]}`,
        tier, row,
        biome: biome.id,
        name: biome.maps[nameIdx],
        boss: biome.bosses[(tier + row) % biome.bosses.length],
        x: 68 + (tier - 1) * 118 + (row % 2 ? -jitter[tier - 1] : jitter[tier - 1]) * 0.6,
        y: rows[row] + jitter[(tier + row) % 7],
        links: [],
        classStart: tier === 1 ? ['druid', 'archer', 'mage'][row] : null,
      });
    }
  }
  nodes.push({
    id: 'apex', tier: 8, row: 1,
    biome: 'crypt',
    name: 'The Apex of Squinting',
    boss: 'The Overseer of the Minimap',
    x: 68 + 6 * 118 + 118, y: rows[1],
    links: [], classStart: null,
  });
  for (const n of nodes) {
    if (n.tier < 7) {
      link(nodes, n.id, `t${n.tier + 1}${'abc'[n.row]}`);
      // branches stay pure for tiers 1-2, then start crossing over
      if (n.tier >= 3 && (n.tier + n.row) % 2 === 0) {
        const crossRow = n.row === 2 ? 1 : n.row + 1;
        link(nodes, n.id, `t${n.tier + 1}${'abc'[crossRow]}`);
      }
    } else if (n.tier === 7) {
      link(nodes, n.id, 'apex');
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

export const DEATH_LINES = [
  'The minimap regrets to inform you.',
  'You were 2% from leveling. Everyone saw.',
  'A dot got you. A white one. Embarrassing.',
  'The floor circle was, in fact, not decorative.',
  'Your build was fine. Your dodging was not.',
  'Cause of death: standing still with confidence.',
  'The boss telegraphed that twice. In orange.',
  'Ten percent of your XP now belongs to the void.',
  'You died as you lived: slightly out of range.',
  'The waypoint was right there.',
  'Death recap unavailable. It was the dots.',
  'Somewhere, a hardcore exile is judging you.',
];

export const DEFAULT_NAMES = [
  'Exile', 'Dot Enjoyer', 'Cartographer', 'Squintlord', 'Waypoint Andy',
  'Map Goblin', 'Fog Appreciator', 'Corner Camper', 'The Second Monitor',
];
