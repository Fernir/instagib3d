import { Shader } from '../engine/shader.js';
import { Texture } from '../engine/texture.js';
import { Console } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { WEAPON } from '../server/game/global.js';
import { Event } from '../server/libs/event.js';
import { Dynent } from '../server/objects/dynent.js';
import { itemForEach } from '../server/objects/item.js';

class DebugRender
{
    constructor(game)
    {
        let vert = Shader.vertexShader(true, false, "gl_Position");

        let frag = "\n\
    #ifdef GL_ES\n\
    precision highp float;\n\
    #endif\n\
    \n\
    uniform sampler2D tex;\n\
    uniform sampler2D tex_visible;\n\
    uniform vec4 color;\n\
    varying vec4 texcoord;\n\
    \n\
    void main()\n\
    {\n\
        vec4 col = texture2D(tex, texcoord.xy);\n\
        vec4 visible = texture2D(tex_visible, texcoord.zw);\n\
        gl_FragColor = color * (1.0 - visible.r) * col.a;\n\
    }\n";

        let shader_dynent = new Shader(vert, frag,
        [
            "mat_pos", "tex", "tex_visible", "color",
        ]);

        let tex_dynent = new Texture("/game/textures/debug/dynent.png");
        let tex_line = new Texture("/game/textures/debug/line.png");

        function ready()
        {
            return tex_line.ready() && tex_dynent.ready();
        }

        let linebullets = [];
        let self = this;

        Event.on("lineshoot", function (bullet) {
            let render_debug = parseInt(Console.variable("render-debug", "render debug geometry", 0));
            if (render_debug) linebullets.push(bullet);
        });

        Event.on("keydown", function (key) {
            if (self.transport) {
                let cmd;
                if (key === "[") cmd = 1;
                else if (key === "]") cmd = 2;
                else return;

                self.transport.changeCamera(cmd);
            }
        });

        function renderDynents(camera, objs, size, color, isBot) {
            for (let i = 0; i < objs.length; i++) {
                let obj = objs[i];
                let col = color;
                if (isBot) {
                    if (!obj.alive) col = [0.5, 0, 0, 0];
                }
                Dynent.render(camera, tex_dynent, shader_dynent, obj.dynent.pos, size, obj.dynent.angle,
                    {
                        vectors: [{ location: shader_dynent.color, vec: col }],
                    });
            }
        }

        function renderBullets(camera) {
            for (let index = 0; index < linebullets.length;) {
                let bullet = linebullets[index];
                if (Date.now() < bullet.dead || bullet.type === WEAPON.SHAFT) {
                    Dynent.render(camera, tex_line, shader_dynent, bullet.dynent.pos, [0.1, bullet.dynent.size.y], bullet.dynent.angle,
                        {
                            vectors: [{ location: shader_dynent.color, vec: [1, 0, 0, 0] }],
                        });
                    if (bullet.type === WEAPON.SHAFT) {
                        linebullets.splice(index, 1);
                    } else index++;
                } else {
                    linebullets.splice(index, 1);
                }
            }
        }

        this.render = function (bot) {
            if (!ready())
                return;

            let render_debug = parseInt(Console.variable("render-debug", "render debug geometry", 0));
            if (render_debug) {
                state.gl.enable(state.gl.BLEND);
                state.gl.blendFunc(state.gl.ONE, state.gl.ONE);
                renderDynents(bot.dynent, game.bots, [1, 1], [0.5, 0.5, 1, 0], true);
                renderDynents(bot.dynent, game.bullets, [0.5, 0.5], [1, 0, 0, 0], false);

                let items = [];
                itemForEach(game, function (item) {
                    items.push(item);
                });

                renderDynents(bot.dynent, items, [0.5, 0.5], [0, 1, 0, 0], false);
                renderBullets(bot.dynent);
                state.gl.blendFunc(state.gl.SRC_ALPHA, state.gl.ONE_MINUS_SRC_ALPHA);
                state.gl.disable(state.gl.BLEND);
            }

            let render_ai = parseInt(Console.variable("render-ai", "render ai debug", 0));
            if (render_ai && bot.ai) {
                let Y = 0.85;
                let reaction_time = bot.ai.reaction_time;
                let angle_speed = bot.ai.angle_speed;
                let max_angle_speed = bot.ai.max_angle_speed;
                let accuracy = bot.ai.accuracy;
                state.text.render([0.6, Y -= 0.05], 2, "#greaction_time = #w" + reaction_time, 1);
                state.text.render([0.6, Y -= 0.05], 2, "#gangle_speed = #w" + angle_speed, 1);
                state.text.render([0.6, Y -= 0.05], 2, "#gmax_angle_speed = #w" + max_angle_speed, 1);
                state.text.render([0.6, Y -= 0.05], 2, "#gaccuracy = #w" + accuracy, 1);
            }
        };
    }
}

export { DebugRender };
