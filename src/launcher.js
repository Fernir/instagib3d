import { setupPeerSession, hasPeerSignaling } from '@/net/peernet.js';
import { Console } from '@/core/polyfill.js';

import { createInstagibRuntime } from './runtime.js';

let runtime = null;

const GLOBAL_ROOM = 'instagib3d-global';
const SCORE_STATE_PREFIX = 'instagib3d:score-state:';
const DEFAULT_NICK = 'player';
const DEFAULT_SEED = '42';
const DEFAULT_SIZE_CLASS = '0';

let migrating = false;

// Called when a joined player loses the host. Reloads once (debounced) so the
// peer election runs fresh: a remaining player becomes the new host and the
// others re-join the same room code automatically.
function onHostLost() {
  if (migrating) return;
  migrating = true;
  Console.info('Host left — migrating room, reconnecting…');
  setTimeout(() => window.location.reload(), 500);
}

function getScoreStorageKey(roomCode) {
  return SCORE_STATE_PREFIX + roomCode;
}

function loadScoreState(roomCode) {
  try {
    const raw = window.sessionStorage.getItem(getScoreStorageKey(roomCode));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function getParams() {
  const nick = DEFAULT_NICK;
  const seed = DEFAULT_SEED;
  const sizeClass = DEFAULT_SIZE_CLASS;
  const env = typeof import.meta !== 'undefined' ? import.meta.env : {};
  const peerDefaultMp = env.VITE_PEER_DEFAULT_MP === 'true';
  const solo = !peerDefaultMp || !hasPeerSignaling();

  if (!solo) {
    const roomCode = GLOBAL_ROOM;
    const scoreStorageKey = getScoreStorageKey(roomCode);
    try {
      const session = await setupPeerSession(roomCode);
      if (session.role === 'join') {
        return {
          nick,
          mode: 'join',
          netSocket: session.socket,
          seed,
          size_class: sizeClass,
          scoreStorageKey,
          // Host left: re-run the election (one of the remaining players claims
          // the room code and becomes the new host, the rest re-join). A clean
          // reload guarantees no stale game/event state survives the handoff.
          onConnectionLost: onHostLost,
        };
      }
      return {
        nick,
        mode: 'host',
        local: 'true',
        addr: 'local',
        attachHost: session.attach,
        seed,
        size_class: sizeClass,
        scoreStorageKey,
        scoreState: loadScoreState(roomCode),
      };
    } catch (e) {
      Console.error('P2P session failed, starting local game instead:', e);
    }
  }

  return { nick, local: 'true', addr: 'local', seed, size_class: sizeClass };
}

export async function startGame(canvas) {
  if (runtime) runtime.destroy();
  runtime = await createInstagibRuntime(canvas, { sens: 0.1 });
  runtime.start(await getParams());
  return runtime;
}

export function stopGame() {
  if (runtime) {
    runtime.destroy();
    runtime = null;
  }
}
