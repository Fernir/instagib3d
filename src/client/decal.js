import { Event } from '@/core/event.js';
import { state } from '@/core/runtime-state.js';
import { Vector } from '@/core/vector.js';

import { WEAPON } from '@/global.js';

// Событийная обвязка декалей. Сам рендер реализован level3d.js (decalAdapter):
// здесь мы лишь маршрутизируем игровые события в его render_decal.
export class Decal {
  static render_decal(dynent, tex, color, sh_add = false) {
    const lr = state.gameClient && state.gameClient.getLevelRender();
    if (lr && lr.getDecal) lr.getDecal().render_decal(dynent, tex, color, sh_add);
  }
}

Event.on('cl_botdead', function (pos, dir, id) {
  const color = state.Bot.isMutant(id) ? [0, 0.5, 0, 1] : [0.5, 0, 0, 1];
  Decal.render_decal(
    {
      pos: pos,
      size: new Vector(3, 3),
      angle: Math.random() * Math.PI * 2,
    },
    state.Particle.splash_textures[20],
    color,
  );
});

Event.on('cl_bulletlinecollide', function (bullet, dest, norm_dir) {
  const radius = [0.45, 1.0, 0.45];
  const r = radius[bullet.type] || 0.45;
  Decal.render_decal(
    {
      pos: dest,
      pos_z: bullet.dest_z,
      dir: norm_dir,
      angle: Math.random() * Math.PI * 2,
      size: new Vector(r, r),
    },
    state.Weapon.tex_decal,
    [0, 0, 0, 1],
    bullet.type === WEAPON.SHAFT,
  );
});

Event.on('cl_bulletdead', function (bullet) {
  if (bullet.type !== WEAPON.PISTOL) return;

  const level = state.gameClient.getLevelRender().getLevel();
  if (level.collideLava(bullet.dynent.pos) && !level.getCollideBridges(bullet.dynent.pos)) return;

  const r = 0.45;
  Decal.render_decal(
    {
      pos: bullet.dynent.pos,
      pos_z: bullet.z,
      dir: bullet.dynent && bullet.dynent.vel ? bullet.dynent.vel : null,
      angle: Math.random() * Math.PI * 2,
      size: new Vector(r, r),
    },
    state.Weapon.tex_decal,
    [0, 0, 0, 1],
  );
});

state.Decal = Decal;
