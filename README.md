# Dead Surge

`Survival` is a Decentraland SDK 7 multiplayer arena game focused on wave-based zombie combat, arena hazards, and short-session progression. Players enter an authoritative multiplayer match, survive escalating enemy waves, collect resources, buy stronger tools, and push as far as possible through a 100-wave survival ladder.

## Game Overview

The match is built around a simple loop:

1. Enter the arena and start the wave sequence.
2. Survive incoming zombie groups and special enemy variants.
3. Collect resources and temporary power-ups.
4. Buy or switch weapons, place bricks for cover, and adapt to lava hazards.
5. Clear the wave, take a short breather, then repeat at a higher difficulty.

The game is designed for co-op play, but the server also scales wave pressure by player count.

## Core Features

- 100-wave survival progression with increasing enemy count and pressure.
- Authoritative multiplayer match runtime.
- Multiple zombie archetypes:
  - `basic` for steady pressure
  - `quick` for fast flanking
  - `tank` for higher durability
  - `exploder` for burst threat and positioning checks
- Weapon options for different playstyles:
  - default gun
  - shotgun
  - minigun with heat/overheat management
- Buildable bricks that can block movement paths and provide elevated safety against lava.
- Potion pickups that grant health recovery, rage shield, or speed boosts.
- Arena lava hazards with several patterns, including sweep attacks that leave randomized safe corridors.
- Persistent player progression and loadout-related gold rewards.

## Wave Structure

Waves are paced to create repeated spikes of pressure and recovery:

- Active combat phase with server-planned zombie spawns.
- Short rest period between waves.
- Periodic boss-style milestone waves with heavier compositions.
- Late-game hazard escalation through denser enemies and more dangerous lava patterns.

For more design detail, see [WAVE_SYSTEM_DESIGN.md](./WAVE_SYSTEM_DESIGN.md).

## Match Economy And Survival Tools

- `ZC` is the in-match currency used for weapon access and brick placement.
- `Gold` is part of persistent progression and is awarded through wave milestones.
- Bricks can be placed on a snapped grid to create emergency cover or movement options.
- Potions add short tactical windows instead of permanent upgrades, so positioning still matters.

## Tech Notes

- Built with `@dcl/sdk` and `@dcl/js-runtime`.
- Uses authoritative multiplayer with `multiplayerId: survivalgame`.
- Client and server logic are both part of the scene project.
- Hazard, wave, weapon, and progression systems are split across `src/` modules for iteration.

## Running The Project

Install dependencies, then use the standard SDK commands:

```bash
npm install
npm run start
```

Useful commands:

- `npm run build` builds the scene and runs type checking.
- `npm run deploy:testing` deploys to the configured testing target.
- `npm run deploy:production` deploys to the configured production target.
- `npm run server-logs` streams SDK server logs.

## Project Structure

- [src/index.ts](./src/index.ts): scene bootstrap and system registration.
- [src/server/lobbyServer.ts](./src/server/lobbyServer.ts): authoritative multiplayer match server.
- [src/server/lavaHazardPatterns.ts](./src/server/lavaHazardPatterns.ts): lava pattern generation.
- [src/ui.tsx](./src/ui.tsx): gameplay HUD and action bar.
- [src/brick.ts](./src/brick.ts): brick placement and brick state.
- [src/potions.ts](./src/potions.ts): potion pickup and local effect handling.
- [src/waveManager.ts](./src/waveManager.ts): wave pacing and local wave-state helpers.

## Status

This repository is an active gameplay prototype and live iteration space. Systems such as hazards, balance, progression, and moment-to-moment combat are still being tuned.
