# instagib3d

[**▶ Play online**](https://instagib3d.vercel.app/)

![instagib3d screenshot](docs/screenshot.png)

A first-person WebGL shooter built on top of the gameplay logic of
[schibir/instagib.io](https://github.com/schibir/instagib.io). The original
2D engine has been fully replaced with a 3D renderer, but the simulation
(level generator, bot AI, projectile physics, instagib rules, lava/bridges,
networking) is preserved and runs untouched on a thin in-browser "server".

The renderer is a single first-person view:

- 3D walls / floor / lava / bridges with a baked, multi-light static
  lightmap (FBO) plus dynamic per-frame lights from projectiles and rail/shaft beams.
- Animated lava driven by the same per-tile velocity field as the original 2D
  shader (RG = vx, vy → wave displacement, B = noise mask).
- Per-pixel decals that live in a 1280–2048 px FBO with a slow exponential
  fade-out (~45 s half-life). Wall hits resolve a tight wall-face plane and
  spawn a separate 3D quad decal.
- Quake-2 MD2 models for players, world pickups and the first-person view
  weapon (see "Quake 2 assets" below).
- Q2-style FX (`q2fx.js`): muzzle flashes, blaster/plasma/rocket trails,
  rail beams, shaft lightning, blood bursts, impact sparks, explode flashes.
- Howler.js HRTF 3D audio: every world sound is panned and attenuated based
  on the listener (camera) position and yaw.
- Rotating circular minimap and a spectator overlay with a Play button.

Built with Vite.

## Run

```bash
npm install
npm run dev
```

Opens [http://localhost:3000](http://localhost:3000) (port set in `vite.config.js`).

Other scripts: `npm run build`, `npm run preview`, `npm run lint`,
`npm run format`.

## Play

By default the game connects to a shared global multiplayer room (see
"Multiplayer" below); add `?solo` for offline play against bots.

URL parameters (all optional):

- `nick` — player name (default `player`)
- `seed` — map seed (default `42`)
- `size_class` — map size `0`…`2`
- `room` — private room code for peer-to-peer multiplayer (default: shared
  global room, see below)
- `solo` — force offline single-player against bots
- `addr` — legacy dedicated WebSocket server address (`local` = offline)

## Multiplayer (peer-to-peer, no backend)

Multiplayer runs directly between browsers over WebRTC, so it needs **no
server of our own** and works on a pure static deploy like the Vercel build.

**By default everyone who opens the site joins one shared global room** — just
share the plain URL:

```
https://instagib3d.vercel.app/
```

For a private match, add any short alphanumeric room code (everyone uses the
same one):

```
https://instagib3d.vercel.app/?room=my-game-123
```

The first person to open a given room becomes the host (their browser runs the
authoritative game), and everyone else automatically joins them. Signaling is
handled by PeerJS' free public broker; once connected, game traffic is direct
peer-to-peer.

To play offline against bots only, add `?solo` (or `?addr=local`).

### Host migration

The host's browser is authoritative. If the host leaves, the remaining players
**automatically re-run the room election** — one of them claims the room code
and becomes the new host, the others re-join, all without manual action. The
match continues on the same map (same seed), and a lightweight score snapshot
(`frag` / `scores` by nickname) is restored by the new host. Full transient
simulation state such as exact positions, weapons, bullets, item timers and bot
AI state still resets, because thin clients don't carry the host's full
simulation state (seamless state transfer would require full game-state
replication).

Notes / limitations:

- Both players must be able to establish a WebRTC connection (most networks
  work via STUN; very restrictive NATs without a TURN server may fail).

In-game console commands (open with the backtick key):

- `sound on|off|toggle` — mute / unmute (default: on, master volume `0.12`).
- `soundVolume <0..1>` — global Howler volume.
- `god` — toggle invulnerability (local game only).
- `spectator [nick]` — switch camera to a bot; no arg = first available bot.
- `status`, `trafik` — diagnostics.

Audio context starts after the first user gesture (click / key / touch) and
mutes itself while the browser tab is hidden.

## Layout

```
src/
  index.js                  entry point, canvas setup
  main.scss
  instagib/
    launcher.js             startGame / stopGame
    runtime.js              WebGL, input, audio unlock, main loop
    api.js                  parallel dynamic-import bundle for client modules
    bootstrap.js            side-effect import order
    polyfill.js             Console, config, assert
    runtime-state.js        gl, canvas, input, client singletons
    mat4.js                 mat4 shim over gl-matrix
    client/                 renderer, HUD, bots, particles, audio, FX
      level3d.js              walls/floor/lava, lightmap FBO, decal FBO, minimap
      level.js                thin re-export of LevelRender3D
      decal.js                event glue → level3d's decal adapter
      bullet.js               BulletClient / BulletLine / BulletShaft
      bot.js, item.js, weapon.js, hud.js
      md2.js                  Quake-2 MD2 loader
      q2fx.js                 Q2-style particle / beam FX
      sound.js                Howler 3D HRTF audio
      particles.js            sparks, splashes, blood pools, explosions, respawn
      dynent.js               billboard / 3D beam draw helper
      fakesocket.js, game.js
      peernet.js              WebRTC P2P transport (PeerJS) for ?room= play
    engine/                 WebGL helpers: shaders, textures, FBO, text, console
    server/                 in-browser "server" (room, AI, physics, transport)
public/game/textures/, public/game/sounds/, public/game/models/   assets
```

Modules use plain ESM `import` / `export`. Shared runtime singletons (WebGL,
canvas, audio, references to loaded client classes) live in `runtime-state.js`
and are populated by `runtime.js` on startup.

## Quake 2 assets

Player visuals and animation come from the open-source
[id-Software/Quake-2](https://github.com/id-Software/Quake-2) release
(GPL source; assets from `pak0.pak`):

- MD2 player models (`male` / `female` / `cyborg`) with PNG-converted original skins.
- Per-body weapon meshes (`w_blaster.md2`, `w_railgun.md2`, …) — frames are
  indexed identically to body frames, matching `client/cl_ents.c` in Q2.
- First-person view weapons (`v_*.md2`) with the original `idle*` / `pow*`
  frame groups.
- World drop pickups (`g_*.md2`) that bob and rotate with a per-weapon neon outline.

## Licenses and attribution

- This repository's code — [MIT](LICENSE).
- Original gameplay logic — [schibir/instagib.io](https://github.com/schibir/instagib.io) (MIT).
- Quake 2 source code — [id-Software/Quake-2](https://github.com/id-Software/Quake-2)
  (GPL); only rendering ideas are borrowed (frame sequencing, attaching
  `w_*.md2` to player bodies, FX effects).
- Quake 2 assets (`*.md2`, converted `*.png` skins) — property of id Software; bundled here
  under their original license for educational / portfolio use only.
