import { Event } from '@/core/event.js';
import { Console } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

import { MobileControls } from '@/engine/mobilecontrols.js';
import { UILayout } from '@/engine/render_text.js';
import { Viewport } from '@/engine/viewport.js';
import { Shader } from './shader.js';

const SLIDE_SPEED = 14;
const INPUT_PAD = 0.04;

Event.on('keydown', function (key, code) {
  if (code === Console.TILDA_CODE || key === Console.TILDA_MAC || key === Console.TILDA_WIN) {
    Console.toggle();
  } else if (Console.show) {
    if (MobileControls.isActive() && document.activeElement === Console._mobileInput) return;
    if (key.length === 1) {
      Console.current_command += key;
    } else if (key === Console.ENTER) {
      Console.dispatchCommand(Console.current_command);
      Console.current_command = '';
    } else if (key === Console.BACKSPACE) {
      Console.current_command = Console.current_command.substr(
        0,
        Console.current_command.length - 1,
      );
    } else if (key === Console.UP || key === Console.DOWN) {
      if (key === Console.UP) Console.current_pos--;
      if (key === Console.DOWN) Console.current_pos++;
      if (Console.current_pos < 0) Console.current_pos = 0;
      if (Console.current_pos >= Console.stack.length) {
        Console.current_pos = Console.stack.length;
        Console.current_command = '';
      } else if (Console.stack.length > 0) {
        Console.current_command = Console.stack[Console.current_pos];
      }
    } else if (key === Console.TAB) {
      Console.current_command = Console.getAutocomplete();
    }
  }
});

Event.on('mousewheel', function (delta) {
  if (Console.show) {
    if (delta < 0) Console.scroll += 2;
    if (delta > 0) Console.scroll -= 2;
    if (Console.scroll < 0) Console.scroll = 0;
    if (Console.scroll > Console.messages.length - 1) Console.scroll = Console.messages.length - 1;
  }
});

Console.addMessage = function (tag, ...args) {
  let str = args.join(' ');
  let msg = '#w' + str;
  if (tag === Console.ERROR) {
    str = '[ERROR] ' + str;
    msg = '#r[ERROR] ' + msg;
  } else if (tag === Console.INFO) {
    str = '[INFO] ' + str;
    msg = '#g[INFO] ' + msg;
  } else if (tag === Console.WARN) {
    str = '[WARN] ' + str;
    msg = '#y[WARN] ' + msg;
  }

  Console.messages.push(msg);
  const MAX_MESSAGES = 300;
  if (Console.messages.length > MAX_MESSAGES) {
    Console.messages.splice(0, Console.messages.length - MAX_MESSAGES);
    if (Console.scroll > Console.messages.length - 1) {
      Console.scroll = Math.max(0, Console.messages.length - 1);
    }
  }
};

Console.debug = function (...args) {
  Console.addMessage(Console.DEBUG, ...args);
};

Console.info = function (...args) {
  Console.addMessage(Console.INFO, ...args);
};

Console.error = function (...args) {
  Console.addMessage(Console.ERROR, ...args);
};

Console.warn = function (...args) {
  Console.addMessage(Console.WARN, ...args);
};

Console.dispatchCommand = function (cmd) {
  Console.stack.push(cmd);
  Console.current_pos = Console.stack.length;
  Console.debug(cmd);
  let parsed = cmd.split(' ');
  let args = parsed.slice(1);
  if (Console.commands[parsed[0]]) {
    Console.commands[parsed[0]].callback(...args);
  } else if (Console.variables[parsed[0]]) {
    let variable = Console.variables[parsed[0]];
    if (parsed.length > 1) {
      if (args.length > 1) variable.value = args;
      else variable.value = args[0];
    }
    Console.debug(parsed[0], ' = ', variable.value);
  } else {
    Console.error('Unknown command or variable');
  }
};

Console.variable = function (name, description, def) {
  if (!Console.variables[name]) {
    Console.variables[name] = {
      desc: description,
      def: def,
      value: def,
    };
  }
  return Console.variables[name].value;
};

Console.addCommand = function (name, description, callback) {
  if (!Console.commands[name]) {
    Console.commands[name] = {
      desc: description,
      callback: callback,
    };
  }
};

Console.getAutocomplete = function () {
  let cur = Console.current_command;
  for (let cmd in Console.commands)
    if (cmd.toLowerCase().indexOf(cur.toLowerCase()) === 0) return cmd;
  for (let v in Console.variables) if (v.toLowerCase().indexOf(cur.toLowerCase()) === 0) return v;
  return '';
};

Console.load = function () {
  Console.TILDA_CODE = 'Backquote';
  Console.TILDA_MAC = '§';
  Console.TILDA_WIN = '`';
  Console.ENTER = 'Enter';
  Console.BACKSPACE = 'Backspace';
  Console.UP = 'ArrowUp';
  Console.DOWN = 'ArrowDown';
  Console.TAB = 'Tab';

  Console.DEBUG = 0;
  Console.INFO = 1;
  Console.ERROR = 2;
  Console.WARN = 3;

  Console.show = false;
  Console.slide = 0;
  Console._lastTick = 0;
  Console.scroll = 0;
  Console.current_command = '';

  Console.messages = [];
  Console.variables = [];
  Console.commands = [];
  Console.stack = [];
  Console.current_pos = 0;

  Console.addCommand('help', 'list of all commands', function () {
    for (let v in Console.commands) {
      let command = Console.commands[v];
      Console.debug('#y' + v, '#w', command.desc);
    }
  });
  Console.addCommand('listvars', 'list of all variables', function () {
    for (let v in Console.variables) {
      let variable = Console.variables[v];
      Console.debug(
        '#y' + v,
        '#g=',
        variable.value,
        '#w',
        variable.desc,
        'default =',
        variable.def,
      );
    }
  });
  Console.addCommand('clear', 'clear console', function () {
    Console.messages.splice(0, Console.messages.length);
  });
  Console.addCommand('history', 'print all typed commands', function () {
    Console.debug('---------------');
    Console.stack.forEach(function (cmd) {
      Console.debug(cmd);
    });
  });

  let vert = Shader.vertexShader(true, false);
  let frag =
    '\n\
    #ifdef GL_ES\n\
    precision highp float;\n\
    #endif\n\
    uniform vec4 color;\n\
    varying vec4 texcoord;\n\
    void main()\n\
    {\n\
        gl_FragColor = color;\n\
    }\n';

  Console.shader = new Shader(vert, frag, ['mat_pos', 'color']);
  Console.panelBuffer = null;
  Console.ensureMobileInput();
};

Console.ensureMobileInput = function () {
  if (Console._mobileInput || typeof document === 'undefined') return Console._mobileInput;
  const el = document.createElement('input');
  el.type = 'text';
  el.className = 'console-mobile-input';
  el.autocomplete = 'off';
  el.autocapitalize = 'off';
  el.autocorrect = 'off';
  el.spellcheck = false;
  el.setAttribute('enterkeyhint', 'send');
  el.setAttribute('inputmode', 'text');
  el.setAttribute('aria-label', 'Console command');
  el.style.display = 'none';
  document.body.appendChild(el);

  el.addEventListener('input', () => {
    if (Console.show) Console.current_command = el.value;
  });
  el.addEventListener('keydown', (e) => {
    if (!Console.show) return;
    e.stopPropagation();
    if (e.key === 'Enter') {
      Console.dispatchCommand(Console.current_command);
      Console.current_command = '';
      el.value = '';
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      Console.current_pos--;
      if (Console.current_pos < 0) Console.current_pos = 0;
      if (Console.current_pos >= Console.stack.length) {
        Console.current_pos = Console.stack.length;
        Console.current_command = '';
      } else if (Console.stack.length > 0) {
        Console.current_command = Console.stack[Console.current_pos];
      }
      el.value = Console.current_command;
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      Console.current_pos++;
      if (Console.current_pos >= Console.stack.length) {
        Console.current_pos = Console.stack.length;
        Console.current_command = '';
      } else if (Console.stack.length > 0) {
        Console.current_command = Console.stack[Console.current_pos];
      }
      el.value = Console.current_command;
      e.preventDefault();
    } else if (e.key === 'Tab') {
      Console.current_command = Console.getAutocomplete();
      el.value = Console.current_command;
      e.preventDefault();
    }
  });

  Console._mobileInput = el;
  return el;
};

Console.syncMobileInputLayout = function () {
  const el = Console._mobileInput;
  if (!el || !Console.show) return;
  const vv = window.visualViewport;
  const h = 48;
  if (vv) {
    el.style.top = `${Math.round(vv.offsetTop + vv.height - h)}px`;
    el.style.bottom = 'auto';
    el.style.left = `${Math.round(vv.offsetLeft)}px`;
    el.style.width = `${Math.round(vv.width)}px`;
  } else {
    el.style.top = 'auto';
    el.style.bottom = '0';
    el.style.left = '0';
    el.style.width = '100%';
  }
};

Console.syncMobileInputVisibility = function () {
  const el = Console._mobileInput;
  if (!el) return;
  const active = Console.show && MobileControls.isActive();
  el.style.display = active ? 'block' : 'none';
  el.style.pointerEvents = active ? 'auto' : 'none';
  if (active) Console.syncMobileInputLayout();
  else el.blur();
};

Console.focusMobileInput = function () {
  if (!MobileControls.isActive() || !Console.show) return;
  const el = Console.ensureMobileInput();
  if (!el) return;
  Console.syncMobileInputVisibility();
  el.value = Console.current_command || '';
  const focusInput = () => {
    Console.syncMobileInputLayout();
    el.focus();
    const len = el.value.length;
    if (el.setSelectionRange) el.setSelectionRange(len, len);
  };
  if (state.canvas) Viewport.resizeCanvas(state.canvas, state.gl);
  requestAnimationFrame(focusInput);
  setTimeout(focusInput, 100);
};

Console.blurMobileInput = function () {
  Console.syncMobileInputVisibility();
  Console._mobileInput?.blur();
};

Console.toggle = function () {
  Console.show = !Console.show;
  Console.syncMobileInputVisibility();
  if (Console.show) {
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (state.canvas) Viewport.resizeCanvas(state.canvas, state.gl);
    Console.focusMobileInput();
  } else {
    if (state.canvas) Viewport.resizeCanvas(state.canvas, state.gl);
    Console.blurMobileInput();
  }
};

function ensureConsolePanelBuffer() {
  if (Console.panelBuffer) return Console.panelBuffer;
  const gl = state.gl;
  Console.panelBuffer = gl.createBuffer();
  return Console.panelBuffer;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function panelBounds(ease) {
  const panelBottom = 1.0 - ease;
  const panelTop = 2.0 - ease;
  return { panelBottom, panelTop };
}

Console.render = function () {
  const now = Date.now();
  const dt = Console._lastTick ? Math.min(0.05, (now - Console._lastTick) * 0.001) : 0.016;
  Console._lastTick = now;
  const target = Console.show ? 1 : 0;
  Console.slide += (target - Console.slide) * Math.min(1, dt * SLIDE_SPEED);
  if (Console.slide < 0.004 && !Console.show) return false;

  const ease = smoothstep(Console.slide);
  const { panelBottom, panelTop } = panelBounds(ease);

  const lineHalf = UILayout.snapHalfNdc(0.028);
  const textSize = UILayout.textSizeForHalfNdc(lineHalf, 2, 0.028);
  const lineStep = UILayout.lineStep(lineHalf);
  const inputHalf = UILayout.snapHalfNdc(0.022);
  const inputSize = UILayout.textSizeForHalfNdc(inputHalf, 2, 0.022);
  const inputY = panelBottom + INPUT_PAD + inputHalf;
  const msgTop = panelTop - INPUT_PAD - lineHalf;
  const msgLimit = inputY + lineStep * 1.1;

  function render_fon() {
    const gl = state.gl;
    const mat4 = state.mat4;
    const buf = ensureConsolePanelBuffer();
    const verts = new Float32Array([
      -1, panelBottom,
      1, panelBottom,
      -1, panelTop,
      1, panelTop,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const mat_pos = mat4.create();
    Console.shader.use();
    Console.shader.matrix(Console.shader.mat_pos, mat_pos);
    const color = Console.variable(
      'console-color',
      'background color of console',
      [0.5, 0.5, 0.2, 0.5],
    );
    Console.shader.vector(Console.shader.color, [color[0], color[1], color[2], color[3] * ease]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);

    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
  }

  function render_messages() {
    let y = msgTop;
    for (let i = Console.messages.length - 1 - Console.scroll; i >= 0; i--) {
      if (y < msgLimit) break;
      state.text.render([-0.95, y], textSize, Console.messages[i], 1, { alpha: ease });
      y -= lineStep;
    }
  }

  function render_command() {
    let cmd = Console.current_command;
    if ((((Date.now() % 1000) / 500) | 0) === 0) cmd += '|';
    state.text.render([-0.95, inputY], inputSize, cmd, 1, { alpha: ease });
    const autocomplete = Console.getAutocomplete();
    state.text.render([-0.95, inputY], inputSize, autocomplete, 1, { alpha: 0.45 * ease });
  }

  render_fon();
  render_messages();
  render_command();

  return Console.show || Console.slide > 0.004;
};
