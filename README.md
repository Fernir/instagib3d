# instagib3d

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

## Local play

Single-player against bots by default.

URL parameters (all optional):

- `nick` — player name (default `player`)
- `seed` — map seed (default `42`)
- `size_class` — map size `0`…`2`
- `addr` — server address; `local` (or omitted) means local mode

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
      md2.js, pcx.js          Quake-2 MD2 + PCX loaders
      q2fx.js                 Q2-style particle / beam FX
      sound.js                Howler 3D HRTF audio
      particles.js            sparks, splashes, blood pools, explosions, respawn
      dynent.js               billboard / 3D beam draw helper
      fakesocket.js, game.js
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

- MD2 player models (`male` / `female` / `cyborg`) with their original PCX skins.
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
- Quake 2 assets (`*.md2`, `*.pcx`) — property of id Software; bundled here
  under their original license for educational / portfolio use only.
