import { createInstagibRuntime } from './runtime.js';

let runtime = null;

function getParams() {
  const params = new URLSearchParams(window.location.search);
  const addr = params.get('addr');
  const nick = params.get('nick') || 'player';
  const seed = params.get('seed') || '42';
  const sizeClass = params.get('size_class') || '0';

  if (addr && addr !== 'local') {
    return { nick, local: 'false', addr, seed, size_class: sizeClass };
  }
  return { nick, local: 'true', addr: 'local', seed, size_class: sizeClass };
}

export async function startGame(canvas) {
  if (runtime) runtime.destroy();
  runtime = await createInstagibRuntime(canvas, { sens: 0.1 });
  runtime.start(getParams());
  return runtime;
}

export function stopGame() {
  if (runtime) {
    runtime.destroy();
    runtime = null;
  }
}
