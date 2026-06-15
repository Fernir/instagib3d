# instagib3d

[**▶ Play online**](https://instagib3d.vercel.app/)

![instagib3d screenshot](docs/screenshot.png)

A 3D first-person remake of [schibir/instagib.io](https://github.com/schibir/instagib.io).
The 2D engine is replaced with a WebGL renderer (lightmaps, animated lava, decals,
Quake 2 MD2 models, 3D audio), but the original gameplay — level generation, bot AI,
physics and instagib rules — runs unchanged in the browser.

## Run

```bash
pnpm install
pnpm dev
```

Opens http://localhost:3000. Other scripts: `build`, `preview`, `lint`, `format`, `test`.

## URL parameters

All optional:

- `nick` — player name
- `seed` — map seed
- `size_class` — map size `0`…`2`
- `room` — private multiplayer room code
- `solo` — offline play against bots

## Multiplayer

Multiplayer is peer-to-peer over WebRTC (PeerJS for signaling), so there's no backend.
Opening the site puts you in a shared global room; add `?room=code` for a private match
or `?solo` to play offline.

The first player in a room is the host and runs the authoritative game; others join
automatically. If the host leaves, the remaining players re-elect a new host and the
match continues on the same map (scores are kept; positions/weapons reset).

## Console

Open with the backtick key:

- `sound on|off|toggle`, `soundVolume <0..1>`
- `god` — toggle invulnerability (offline only)
- `spectator [nick]` — follow a bot

## Licenses

- This repo's code — [MIT](LICENSE).
- Gameplay logic — [schibir/instagib.io](https://github.com/schibir/instagib.io) (MIT).
- Quake 2 source — [id-Software/Quake-2](https://github.com/id-Software/Quake-2) (GPL);
  only rendering ideas are borrowed.
- Quake 2 assets (`*.md2`, converted skins) — property of id Software, bundled for
  educational use only.
