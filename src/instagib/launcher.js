import { setupPeerSession, hasPeerSignaling } from './client/peernet.js';
import { createInstagibRuntime } from './runtime.js';

let runtime = null;

// Everyone joins a shared room only when ?mp or ?room= is set. Default is solo
// (no signaling WebSocket). Use ?room=CODE for a private match.
const GLOBAL_ROOM = 'instagib3d-global';
const SCORE_STATE_PREFIX = 'instagib3d:score-state:';

let migrating = false;

// Called when a joined player loses the host. Reloads once (debounced) so the
// peer election runs fresh: a remaining player becomes the new host and the
// others re-join the same room code automatically.
function onHostLost() {
  if (migrating) return;
  migrating = true;
  console.log('Host left — migrating room, reconnecting…');
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
  const params = new URLSearchParams(window.location.search);
  const addr = params.get('addr');
  const room = params.get('room');
  const env = typeof import.meta !== 'undefined' ? import.meta.env : {};
  const peerDefaultMp = env.VITE_PEER_DEFAULT_MP === 'true';
  const multiplayer = params.has('mp') || room !== null || (peerDefaultMp && hasPeerSignaling());
  const solo = params.has('solo') || addr === 'local' || !multiplayer;
  const nick = params.get('nick') || 'player';
  const seed = params.get('seed') || '42';
  const sizeClass = params.get('size_class') || '0';

  // Legacy dedicated WebSocket server.
  if (!solo && addr && addr !== 'local') {
    return { nick, local: 'false', addr, seed, size_class: sizeClass };
  }

  // P2P multiplayer: ?mp / ?room= / VITE_PEER_DEFAULT_MP. Signaling via your
  // own PeerServer (see docker-compose.yml) — not 0.peerjs.com.
  if (!solo) {
    if (!hasPeerSignaling()) {
      console.warn(
        'Multiplayer needs a signaling server. Deploy peerjs-server (docker-compose.yml) ' +
          'and set VITE_PEER_HOST, or add ?peer_host=YOUR_SERVER&mp to the URL.',
      );
    } else {
      const roomCode = room || GLOBAL_ROOM;
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
        // Fall back to a local game if signaling fails.
        console.error('P2P session failed, starting local game instead:', e);
      }
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
