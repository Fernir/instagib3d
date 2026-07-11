import { Event } from '@core/event.js';
import { state } from '@core/runtime-state.js';
import { Console } from '@game/polyfill.js';

import { Shader } from './shader.js';

Event.on('keydown', function (key, code) {
  if (code === Console.TILDA_CODE || key === Console.TILDA_MAC || key === Console.TILDA_WIN) {
    Console.show = !Console.show;
    if (Console.show && document.pointerLockElement) document.exitPointerLock?.();
  } else if (Console.show) {
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
    if (Console.scroll > Console.messages - 1) Console.scroll = Console.messages - 1;
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
  }
  console.log(str);

  Console.messages.push(msg);
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

  Console.show = false;
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
    // define default precision for float, vec, mat.\n\
    precision highp float;\n\
    #endif\n\
    \n\
    uniform vec4 color;\n\
    varying vec4 texcoord;\n\
    \n\
    void main()\n\
    {\n\
        gl_FragColor = color;\n\
    }\n';

  Console.shader = new Shader(vert, frag, ['mat_pos', 'color']);
};

Console.render = function () {
  function render_fon() {
    let gl = state.gl;
    let mat4 = state.mat4;
    gl.enable(gl.BLEND);
    let mat_pos = mat4.create();
    mat4.scal(mat_pos, [1, 0.5]);
    mat4.trans(mat_pos, [0, 1]);
    Console.shader.use();
    Console.shader.matrix(Console.shader.mat_pos, mat_pos);
    let color = Console.variable(
      'console-color',
      'background color of console',
      [0.5, 0.5, 0.2, 0.5],
    );
    Console.shader.vector(Console.shader.color, color);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }
  function render_messages() {
    let y = 0.1;
    for (let i = Console.messages.length - 1 - Console.scroll; i >= 0; i--) {
      state.text.render([-0.95, y], 2, Console.messages[i], 1);
      y += 0.06;
      if (y > 1) break;
    }
  }
  function render_command() {
    let cmd = Console.current_command;
    if ((((Date.now() % 1000) / 500) | 0) === 0) cmd += '|';
    state.text.render([-0.95, 0.04], 2, cmd, 1);

    let autocomplete = Console.getAutocomplete();
    state.text.render([-0.95, 0.04], 2, autocomplete, 1, { alpha: 0.5 });
  }

  if (Console.show) {
    render_fon();
    render_messages();
    render_command();
  }

  return Console.show;
};
