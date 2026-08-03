# Minimap, game design reference

The numbers behind the grind. Everything here lives in `js/defs.js` and `js/state.js`; this doc is the tuning map.

## Core loop

Pick a map on the Atlas -> generated dungeon -> explore (fog reveals outlines) -> melt packs -> touch waypoints -> find the boss room at the far end -> dodge telegraphs, kill boss -> map cleared, adjacent atlas nodes unlock -> repeat until level 100.

## Progression

- Start: level 80. Cap: level 100.
- XP to next level: `60000 * 1.22^(level - 80)` (`xpForLevel` in state.js). Level 81 costs 60k; level 99 costs ~2.6M.
- Death: lose 10% of the current level bar, never de-level (`applyDeathPenalty`). Respawn at the map entrance.
- Normal monster XP: `150 * tier^1.5`, scaled by an over-leveling penalty: past `monsterLevel + 3`, each extra player level cuts 12%, floored at 5% (`monsterXp`). Climbing tiers is mandatory to keep leveling.
- Monster level: `80 + tier * 2` (tier 1 = 82, tier 8 = 96).
- Rarity XP multipliers: magic x3, rare x8, boss x60. Boss kill also awards a second boss-sized XP bonus on clear.

## Player

Derived in `charStats(char)`:

| Stat | Formula (l = level - 80) |
|---|---|
| Life | `(2600 + 220*l) * lifeMult` |
| Mana | `240 + 16*l` |
| Damage | `220 * 1.09^l * dmgMult` |
| Move speed | 5.6 tiles/s |
| Life regen | 3.5%/s |
| Mana regen | 6%/s |

### Movement layer (`MOVES` in defs.js)

- **Body-blocking:** living enemies block the player (0.72 tile radius, 1.15 for bosses). You cannot walk through a pack; you fight it or roll past it. Escaping an existing overlap is always allowed.
- **Roll (Space):** 3.2-tile dash over 0.3s in the aim direction, 1.6s cooldown. Passes through enemies and grants full immunity while rolling. Cancels a channel.
- **Sprint (hold Shift, or HUD toggle):** x1.55 move speed. Any hit taken while sprinting stuns you: no movement or rolling for 2.5s, then a 1.2s grace window before you can be stun-caught again.
- **Channeling** (Charged Shot) also locks movement until the shot fires; a stun cancels it.

### Classes (`CLASSES` in defs.js), three skills each: Q / E / R

| Class | dmgMult | lifeMult | Range | Attack cd | Cleave |
|---|---|---|---|---|---|
| Druid | 1.25 | 1.2 | 2.0 | 1.05s | 1.4 |
| Archer | 0.9 | 1.0 | 7.5 | 0.7s | none |
| Mage | 1.05 | 0.85 | 5.5 | 0.85s | 0.9 |

| Class | Q | E | R (the big one) |
|---|---|---|---|
| Druid | Entangling Burst: r4.2, x3.0, 2s snare, 60 mana, 5s | Vine Patch: r2.8 zone, x0.8 per 0.5s tick + hold, 2.6s, 55 mana, 8s | Vine Row: 8-long line zone, x0.7 ticks + hold, 2.8s, 85 mana, 12s |
| Archer | Piercing Shot: 10-long line, x2.6, 45 mana, 4s | Overcharge: shots hit +2 extra dots at 70% for 6s, 45 mana, 9s | Charged Shot: 0.8s channel (rooted), 12-long line, x6.0, 80 mana, 14s |
| Mage | Frost Nova: r3.8, x2.2, 45% slow 3s, 70 mana, 4.5s | Arcane Surge: +40% attack speed, +25% move speed, 4s, 50 mana, 10s | Comet: r3.0 at the nearest cluster after 0.9s, x4.0, 90 mana, 12s |

Cleave hits secondary targets near the main target for 60% damage. Vine zones re-snare everything inside on every tick.

## Enemies

`enemyStats(tier, rarity)`: hp `220 * 1.32^(tier-1) * hpMult`, damage `(16 + 8*tier) * dmgMult`, speed 3.1 tiles/s, aggro radius 11 tiles, contact bite every 0.9s.

| Rarity | Color | hp x | xp x | dmg x | Spawn rule |
|---|---|---|---|---|---|
| Normal | white `#e6e2d8` | 1 | 1 | 1 | pack filler |
| Magic | blue `#7f9bff` | 3 | 3 | 1.3 | ~24% of pack leaders |
| Rare | yellow `#ffd955` | 8 | 8 | 1.7 | 8% + 1%/tier of pack leaders |
| Boss | orange `#ff9040` | 28 | 60 | 3.2 | one per map |

Magic and rare leaders roll one modifier: fast (x1.7 speed), tanky (x1.8 hp), deadly (x1.8 dmg).

### Boss behavior (`updateBoss` in game.js)

- Activates when the player comes within 14 tiles; shows the top bar.
- Telegraphed slams: every `max(2.4, 4.2 - 0.15*tier)`s, drops 1 to 3 circles (r2.6, 1.15s fuse, first one on the player). Standing in one when it fires costs `bossDmg * 2.2`.
- Adds: 5 normals at 66% hp, 6 more at 33%.

## Maps

`generateMap(seed, node)` in mapgen.js. Grid 96x64, rooms-and-corridors digger, 2-wide corridors, boss arena widened by 2 tiles per side.

Per-biome generator parameters and palettes live in `BIOMES` (defs.js):

| Biome | Rooms | Room size | Wind | Flavor |
|---|---|---|---|---|
| Caverns | 15 | 5-11 | 0.5 | brown/amber blobs |
| Wetlands | 13 | 6-13 | 0.75 | green/teal |
| Forest | 17 | 5-10 | 0.9 | leafy greens |
| Ruins | 12 | 7-14 | 0.3 | sandstone |
| Crypt | 18 | 4-9 | 0.4 | purple dark |

Waypoints: entrance + rooms nearest to 45% and 75% of the entrance-to-boss distance, drawn as totems (green entrance, blue midpoints). Leaving a map always asks for confirmation. Fog: 9-tile reveal radius; wall segments render only once their floor tile is seen. Enemies render within 14 tiles and only on seen tiles.

## Atlas (`ATLAS` in defs.js)

24 nodes, 8 tiers x 3 rows, deterministic layout with fixed jitter. Links: same row to next tier, plus a zigzag cross-link on alternating nodes. New characters start with the three tier-1 nodes open. Clearing a node opens everything it links to. Cleared nodes stay replayable (layouts reroll).

## v2 ideas, in rough priority order

- Loot: minimap-sized item drops (colored squares, obviously), a tiny inventory, one or two stat affixes
- Flasks: a life flask charge system so regen can be lowered again
- More classes: necromancer (pet dots), gladiator (spin), trickster (blink)
- Atlas endgame: tier 9+ "red map" loop with stacked modifiers after level 100... sorry, after the first level 100
- Leaderboard: Convex backend, fastest 80-to-100 and deepest tier
- Sound: one drone per biome, a squish per kill, a gong per boss
- Hardcore mode: one death deletes the character (the checkbox says "I understand")
