# Harbour Line — a three.js tactical FPS

A tactical first-person shooter in the round-based style Counter-Strike
made famous, running on three.js 0.187.0 from plain static files — no build
step, no network requests. One player, nine bots, on the docks of Port
Meridian at dusk.

## What it is

- **Two teams, short rounds.** You lead Vanguard (teal) against Ember
  (orange). The first team to 7 rounds wins the match.
- **The objective.** Vanguard carries a charge. Plant it at Site A (below
  the gantry crane) or Site B (next to the warehouse) and hold it until it
  blows — or wipe out the Ember team. Ember wins by elimination, by letting
  the clock run out, or by defusing a planted charge.
- **Money and buying.** A kill pays $300, a round win $3,250, and a loss
  pays a streak bonus that grows the more you lose in a row. Between rounds
  press **B** to open the shop: AR-77 Longshot rifle, VK-9 Repeater SMG,
  M12 Breacher shotgun, LR-90 Deadeye sniper, P9 Sidearm, frag grenades and
  a Kevlar vest.
- **Gunplay that rewards accuracy.** Hitscan weapons with headshots (4×),
  recoil, spread that widens as you move and fire and tightens when you
  crouch or aim down sights, plus damage falloff over distance. Plant your
  feet and aim, and you win duels.
- **Bots that play the objective.** Nine bots walk the map on a waypoint
  graph, hold angles, fight enemies they can see, react after a human-like
  delay, plant the charge, defuse it, and pull back when they are badly
  hurt. They hear gunfire and remember the last place they saw you.
- **The map.** Port Meridian: three lanes (west yard, mid containers, east
  yard) joining two plant sites, stacked shipping containers, a gantry
  crane, a warehouse, sodium lamps and a low dusk sun.
- **HUD.** Health and armour, ammunition, money, round timer and score,
  how many are alive on each side, killfeed, hitmarkers, a live minimap,
  plant/defuse progress, and a flash showing which way damage came from.
- **Sound.** Every effect is synthesised live with WebAudio — gunshots,
  reloads, hit ticks, plant beeps, explosions, round stingers — so the game
  ships zero audio files.

## Controls

| Key | Action |
| --- | ------ |
| WASD | Move |
| Mouse | Look (click the game to capture the mouse) |
| Click | Fire |
| Right-click | Aim down sights |
| R | Reload |
| G | Throw a frag grenade |
| E | Plant / defuse the charge (hold) |
| B | Buy menu |
| 1–5 | Weapons, Q swaps weapon |
| Ctrl | Crouch, Space jump, M mute |

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

## Handing the entry in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` into the output directory and
writes `dossier.json` through the kit's `buildDossier`. The screenshots are
real renders of the game taken in headless Chrome from the deterministic
`?shot=` scenes listed in `shots.json`: start screen, a mid-round
firefight, the buy menu, and a round won.

## Files

- `game/index.html` — the page, the HUD and the import map
- `game/src/main.js` — boot, fixed-step loop, shooting, shot scenes
- `game/src/map.js` — Port Meridian: geometry, colliders, waypoint graph
- `game/src/bots.js` — bot bodies and AI (route, hold, engage, plant, defuse)
- `game/src/match.js` — rounds, economy, plant/defuse, win conditions
- `game/src/weapons.js` — weapon data and first-person viewmodels
- `game/src/player.js` — movement and collision
- `game/src/effects.js` — tracers, sparks, explosions, grenades
- `game/src/hud.js` — HUD, buy menu, overlays, minimap
- `game/src/audio.js` — synthesised sound effects
- `game/src/input.js` — keyboard, mouse and pointer lock
- `game/src/palette.js` — the dusk palette
- `game/vendor/three/` — three.js 0.187.0, byte for byte from the kit

## License

MIT. three.js is (c) its authors, MIT licensed.
