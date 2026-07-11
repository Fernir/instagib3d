import { createGlobalMat4 } from '@core/mat4.js';
import { state, VK } from '@core/runtime-state.js';
import { Howl, Howler } from 'howler';

import { getGameApi } from './api.js';

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
    Q2FX,
    normalizeAngle,
    Vector,
  } = await getGameApi();

  const options = { sens: 0.1, ...userOptions };
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
  if (typeof window !== 'undefined') window.__instagibState = state;
  state.Console = Console;
  state.Event = Event;
  state.Vector = Vector;
  state.sun_direction = new Vector(-0.25, -0.5);

  const input = {
    mouse_angle: 0,
    mouse_pitch: 0,
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
  state.audioUnlocked = false;

  Howler.autoUnlock = true;

  function updateAudioMute() {
    Howler.mute(!state.soundEnabled || !audioUnlocked || document.hidden);
  }
  state.updateAudioMute = updateAudioMute;

  function setAudioUnlocked(value) {
    audioUnlocked = value;
    state.audioUnlocked = value;
    updateAudioMute();
  }

  function unlockAudio() {
    if (audioUnlocked) return;
    const ctx = Howler.ctx;
    if (ctx?.state === 'suspended') {
      ctx
        .resume()
        .then(() => setAudioUnlocked(true))
        .catch(() => updateAudioMute());
      return;
    }
    setAudioUnlocked(true);
  }
  state.unlockAudio = unlockAudio;

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
    Sound.setup();
    updateAudioMute();
    Item.load();
    Weapon.load();
    HUD.load();
    Bot.load();
    Particle.load();
    Q2FX.load();
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
  state.getMousePitch = function getMousePitch() {
    const pitch = ((-input.mouse_pitch * options.sens) / 360.0) * (2 * Math.PI);
    const limit = Math.PI * 0.48;
    return Math.max(-limit, Math.min(limit, pitch));
  };

  function glInit() {
    canvas.style.display = 'block';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;

    gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      stencil: false,
    });
    if (!gl) return false;
    state.gl = gl;

    const buffer = gl.createBuffer();
    state.quadBuffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.enableVertexAttribArray(0);
    return true;
  }

  function isConsoleToggleKey(event) {
    return (
      event.code === Console.TILDA_CODE ||
      event.key === Console.TILDA_MAC ||
      event.key === Console.TILDA_WIN
    );
  }

  function initEvents() {
    document.addEventListener(
      'keydown',
      (event) => {
        if (isConsoleToggleKey(event) || Console.show) {
          Event.emit('keydown', event.key, event.code);
          event.preventDefault();
          return;
        }
        if (!state.playing) {
          event.preventDefault();
          return;
        }
        Event.emit('keydown', event.key, event.code);
        input.keys[event.keyCode] = true;
        event.preventDefault();
      },
      false,
    );
    document.addEventListener(
      'keyup',
      (event) => {
        if (Console.show) {
          event.preventDefault();
          return;
        }
        if (!state.playing) {
          event.preventDefault();
          return;
        }
        Event.emit('keyup', event.key, event.code);
        input.keys[event.keyCode] = false;
        event.preventDefault();
      },
      false,
    );
    canvas.addEventListener(
      'click',
      (e) => {
        startAssetLoads();
        if (Console.show) return;
        if (gameClient && !gameClient.isPlaying()) {
          const rect = canvas.getBoundingClientRect();
          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
          const btn = gameClient.playButtonHitTest();
          if (Math.abs(nx - btn.x) <= btn.w && Math.abs(ny - btn.y) <= btn.h) {
            gameClient.handlePlayClick();
            return;
          }
        }
        if (gameClient && gameClient.isPlaying()) {
          canvas.requestPointerLock?.();
        }
      },
      false,
    );
    canvas.addEventListener(
      'mouseup',
      () => {
        if (!state.playing) return;
        input.mouse_down = false;
      },
      false,
    );
    canvas.addEventListener(
      'mousedown',
      () => {
        if (!state.playing) return;
        input.mouse_down = true;
      },
      false,
    );
    canvas.addEventListener(
      'mousemove',
      (event) => {
        if (!state.playing) {
          // В overlay-режиме (до нажатия Play) отслеживаем курсор в NDC,
          // чтобы кнопки могли подсвечиваться при наведении.
          const rect = canvas.getBoundingClientRect();
          state.overlayMouse = {
            x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
            y: -(((event.clientY - rect.top) / rect.height) * 2 - 1),
          };
          return;
        }
        if (event.movementX !== undefined) {
          input.mouse_angle += event.movementX;
          input.mouse_pitch += event.movementY || 0;
        } else input.mouse_angle = event.pageX;
      },
      false,
    );
    let lastWheel = 0;
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (Console.show) {
          const delta = e.deltaY || e.detail || e.wheelDelta;
          if (Date.now() > lastWheel) {
            lastWheel = Date.now() + 60;
            Event.emit('mousewheel', delta);
          }
          e.preventDefault();
          return;
        }
        if (!state.playing) {
          e.preventDefault();
          return;
        }
        if (Date.now() > lastWheel) {
          lastWheel = Date.now() + 60;
          const delta = e.deltaY || e.detail || e.wheelDelta;
          if (delta > 0) input.mouse_wheel += 1;
          else if (delta < 0) input.mouse_wheel -= 1;
          Event.emit('mousewheel', delta);
          e.preventDefault();
        }
      },
      false,
    );
    window.addEventListener(
      'resize',
      () => {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        gl.viewport(0, 0, canvas.width, canvas.height);
      },
      false,
    );
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
    return (
      assetsStarted &&
      textReady() &&
      Item.ready() &&
      Weapon.ready() &&
      HUD.ready() &&
      Bot.ready() &&
      Particle.ready()
    );
  }
  function gameReady() {
    return contentReady() && gameClient && gameClient.ready();
  }

  function renderLoading() {
    if (gameReady()) {
      renderLoop();
      return;
    }
    if (!assetsStarted) startAssetLoads();
    if (textReady()) {
      text.render([0, 0], 2, '#rLoading...', 2, { center: true });
    }
    Console.render();
    animationId = requestAnimationFrame(renderLoading);
  }

  function renderLoop() {
    if (destroyed) return;
    gameClient.render();
    Console.render();
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
