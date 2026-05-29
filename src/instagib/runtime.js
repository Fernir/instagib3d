import { Howl, Howler } from 'howler';

import { getGameApi } from './api.js';
import { createGlobalMat4 } from './mat4.js';
import { state, VK } from './runtime-state.js';

export async function createInstagibRuntime(canvas, userOptions = {}) {
  state.Howler = Howler;
  state.Howl = Howl;
  state.mat4 = createGlobalMat4();
  const glm = await import('gl-matrix');
  state.vec2 = glm.vec2;
  state.vec3 = glm.vec3;
  state.vec4 = glm.vec4;
  state.quat = glm.quat;

  const {
    Console,
    Event,
    GameClient,
    Text,
    Item,
    Weapon,
    HUD,
    Bot,
    Particle,
    Sound,
    normalizeAngle,
    Vector,
  } = await getGameApi();

  const options = { sens: 0.1, highQuality: true, ...userOptions };
  const stats = {
    count_kadr: 0,
    count_dynent_rendering: 0,
    count_decal: 0,
    count_net_package: 0,
    memory_all_package: 0,
    fps: 0,
  };

  state.canvas = canvas;
  state.options = options;
  state.stats = stats;
  state.gameClient = null;
  state.Console = Console;
  state.Event = Event;
  state.Vector = Vector;
  state.sun_direction = new Vector(-0.25, -0.5);

  const input = {
    mouse_angle: 0,
    mouse_down: false,
    mouse_wheel: 0,
    keys: new Array(256),
  };
  state.input = input;

  VK.W = () => input.keys['W'.charCodeAt(0)] || input.keys[0x26];
  VK.A = () => input.keys['A'.charCodeAt(0)] || input.keys[0x25];
  VK.S = () => input.keys['S'.charCodeAt(0)] || input.keys[0x28];
  VK.D = () => input.keys['D'.charCodeAt(0)] || input.keys[0x27];

  let gl = null;
  let text = null;
  let gameClient = null;
  let animationId = 0;
  let destroyed = false;
  let assetsStarted = false;
  let audioUnlocked = false;

  Howler.autoUnlock = true;

  function updateAudioMute() {
    Howler.mute(!audioUnlocked || document.hidden);
  }

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    const ctx = Howler.ctx;
    if (ctx?.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    updateAudioMute();
  }

  function bindVisibility() {
    document.addEventListener('visibilitychange', () => {
      updateAudioMute();
      if (!document.hidden && audioUnlocked && Howler.ctx?.state === 'suspended') {
        Howler.ctx.resume().catch(() => {});
      }
    });
  }

  function startAssetLoads() {
    if (assetsStarted) return;
    assetsStarted = true;
    unlockAudio();
    Sound.setup();
    updateAudioMute();
    Item.load();
    Weapon.load();
    HUD.load();
    Bot.load();
    Particle.load();
  }

  function bindFirstGesture() {
    const onGesture = () => startAssetLoads();
    const opts = { once: true, passive: true };
    document.addEventListener('pointerdown', onGesture, opts);
    document.addEventListener('keydown', onGesture, opts);
    document.addEventListener('touchstart', onGesture, opts);
  }

  state.getMouseAngle = function getMouseAngle() {
    const angle = (input.mouse_angle * options.sens) % 360;
    return normalizeAngle((-angle / 360.0) * (2 * Math.PI));
  };

  function glInit() {
    canvas.style.display = 'block';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;

    gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      stencil: false,
    });
    if (!gl) return false;
    state.gl = gl;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, 1, 1,
    ]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.enableVertexAttribArray(0);
    return true;
  }

  function initEvents() {
    document.addEventListener('keydown', (event) => {
      Event.emit('keydown', event.key);
      if (!Console.show) input.keys[event.keyCode] = true;
      event.preventDefault();
    }, false);
    document.addEventListener('keyup', (event) => {
      Event.emit('keyup', event.key);
      if (!Console.show) input.keys[event.keyCode] = false;
      event.preventDefault();
    }, false);
    canvas.addEventListener('click', () => {
      startAssetLoads();
      canvas.requestPointerLock?.();
    }, false);
    canvas.addEventListener('mouseup', () => { input.mouse_down = false; }, false);
    canvas.addEventListener('mousedown', () => { input.mouse_down = true; }, false);
    canvas.addEventListener('mousemove', (event) => {
      if (event.movementX !== undefined) input.mouse_angle += event.movementX;
      else input.mouse_angle = event.pageX;
    }, false);
    let lastWheel = 0;
    canvas.addEventListener('wheel', (e) => {
      if (Date.now() > lastWheel) {
        lastWheel = Date.now() + 60;
        const delta = e.deltaY || e.detail || e.wheelDelta;
        if (delta > 0) input.mouse_wheel += 1;
        else if (delta < 0) input.mouse_wheel -= 1;
        Event.emit('mousewheel', delta);
        e.preventDefault();
      }
    }, false);
    window.addEventListener('resize', () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }, false);
  }

  let gFrameCount = 0;
  let gSeconds = Date.now();
  function calcFps() {
    const now = Date.now();
    gFrameCount += 1;
    if (now > gSeconds) {
      gSeconds = now + 1000;
      stats.fps = gFrameCount;
      gFrameCount = 0;
    }
  }

  function textReady() {
    return text && text.ready();
  }
  function contentReady() {
    return assetsStarted
      && textReady()
      && Item.ready()
      && Weapon.ready()
      && HUD.ready()
      && Bot.ready()
      && Particle.ready();
  }
  function gameReady() {
    return contentReady() && gameClient && gameClient.ready();
  }

  function renderLoading() {
    if (gameReady()) {
      renderLoop();
      return;
    }
    if (textReady()) {
      const msg = assetsStarted ? '#rLoading...' : '#rClick to start';
      text.render([0, 0], 2, msg, 2, { center: true });
    }
    animationId = requestAnimationFrame(renderLoading);
  }

  function renderLoop() {
    if (destroyed) return;
    gameClient.render();
    calcFps();
    stats.count_kadr += 1;
    animationId = requestAnimationFrame(renderLoop);
  }

  function clearFakeSocketEvents() {
    if (!Event?.events) return;
    for (const key of Object.keys(Event.events)) {
      if (key.startsWith('fake')) delete Event.events[key];
    }
  }

  return {
    start(param) {
      if (!glInit()) throw new Error('WebGL not available');
      clearFakeSocketEvents();
      initEvents();
      bindVisibility();
      bindFirstGesture();
      Console.load();
      text = new Text();
      state.text = text;

      renderLoading();

      function waitForReady() {
        if (contentReady() && !gameClient) {
          gameClient = new GameClient(param);
          state.gameClient = gameClient;
        }
        if (!gameReady()) setTimeout(waitForReady, 100);
      }
      waitForReady();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(animationId);
      Howler.stop();
      clearFakeSocketEvents();
      if (state.localRoom) {
        state.localRoom.destroy();
        state.localRoom = null;
      }
      gameClient = null;
      state.gameClient = null;
    },
  };
}
