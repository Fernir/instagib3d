import Peer from 'peerjs';

import { Console } from '@/core/polyfill.js';

// Serialization "none" makes PeerJS pass ArrayBuffers straight through the
// underlying RTCDataChannel without re-packing them, so both sides receive the
// exact binary frames the game protocol expects (Transport does `new DataView(data)`).
const CONN_OPTS = { serialization: 'none', reliable: true };

const PEER_CFG_STORAGE = 'instagib3d:peer-config';

// PeerJS cloud (0.peerjs.com) is blocked in some regions — never use it.
// Signaling server priority: sessionStorage → VITE_* env → localhost dev proxy
// (/peerjs → :9000 via vite.config.js).
function readStoredPeerConfig() {
  try {
    const raw = window.sessionStorage.getItem(PEER_CFG_STORAGE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getPeerConfig() {
  const stored = readStoredPeerConfig();
  if (stored && stored.host) return stored;

  const env = typeof import.meta !== 'undefined' ? import.meta.env : {};
  if (env.VITE_PEER_HOST) {
    return {
      host: env.VITE_PEER_HOST,
      port: parseInt(env.VITE_PEER_PORT || '443', 10),
      path: env.VITE_PEER_PATH || '/peerjs',
      secure: env.VITE_PEER_SECURE !== 'false',
      key: env.VITE_PEER_KEY || 'peerjs',
    };
  }

  // Local dev: Vite proxies /peerjs → localhost:9000 (pnpm peer:serve).
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') {
    const port = window.location.port ? parseInt(window.location.port, 10) : 3000;
    return {
      host: h,
      port: port,
      path: '/peerjs',
      secure: false,
      key: 'peerjs',
    };
  }

  return null;
}

// True when a signaling broker is configured (env, storage, or dev proxy).
function hasPeerSignaling() {
  return getPeerConfig() !== null;
}

function forceArrayBufferBinary(conn) {
  // Make sure incoming messages arrive as ArrayBuffer, not Blob.
  if (conn && conn.dataChannel) conn.dataChannel.binaryType = 'arraybuffer';
}

// Client-facing wrapper around a PeerJS DataConnection that mimics the subset of
// the WebSocket API used by GameClient + Transport (onopen/onmessage/onclose/
// onerror, send, connect, binaryType, readyState/OPEN).
class PeerSocketClient {
  constructor(conn) {
    const self = this;
    this._conn = conn;
    this.binaryType = 'arraybuffer';
    this.OPEN = 1;
    this.readyState = 0;

    this.onopen = function () {};
    this.onmessage = function () {};
    this.onclose = function () {};
    this.onerror = function () {};

    this._open = false; // data channel is open
    this._connectCalled = false; // GameClient called connect() => onopen handler is set
    this._opened = false; // onopen already fired
    this._buffer = [];

    conn.on('open', function () {
      forceArrayBufferBinary(conn);
      self.readyState = 1;
      self._open = true;
      self._fireOpen();
    });
    conn.on('data', function (data) {
      if (self._opened) self.onmessage({ data: data });
      else self._buffer.push(data);
    });
    conn.on('close', function () {
      self.readyState = 3;
      self.onclose({});
    });
    conn.on('error', function (e) {
      Console.error('Peer connection error', e && e.type);
      self.onerror(e || {});
    });
  }

  _fireOpen() {
    if (this._opened) return;
    if (!this._open || !this._connectCalled) return;
    this._opened = true;
    this.onopen();
    // Flush anything that arrived before onopen wired up onmessage.
    const buf = this._buffer;
    this._buffer = [];
    for (let i = 0; i < buf.length; i++) this.onmessage({ data: buf[i] });
  }

  connect() {
    this._connectCalled = true;
    this._fireOpen();
  }

  send(data) {
    if (this._conn && this._conn.open) this._conn.send(data);
  }
}

// Server-facing wrapper used on the host. Mimics the FakeSocketServer / ws
// interface that Transport expects on the server side (.on('message'|'close'|
// 'error'), .send(data), readyState/OPEN).
class PeerSocketServer {
  constructor(conn) {
    const self = this;
    this._conn = conn;
    this.OPEN = 1;
    this.readyState = 1;
    this._cbs = {};
    this._pending = [];

    forceArrayBufferBinary(conn);

    conn.on('data', function (data) {
      const cb = self._cbs['message'];
      if (cb) cb(data);
      else self._pending.push(data);
    });
    conn.on('close', function () {
      self.readyState = 3;
      if (self._cbs['close']) self._cbs['close']();
    });
    conn.on('error', function (e) {
      if (self._cbs['error']) self._cbs['error'](e);
    });
  }

  on(event, callback) {
    this._cbs[event] = callback;
    if (event === 'message' && this._pending.length) {
      const pending = this._pending;
      this._pending = [];
      for (let i = 0; i < pending.length; i++) callback(pending[i]);
    }
  }

  send(data) {
    if (this._conn && this._conn.open) this._conn.send(data);
  }
}

// How long to wait for a join connection to actually open before assuming the
// advertised host is stale/gone and re-running the election.
const JOIN_TIMEOUT_MS = 4000;
// Backoff between election attempts (also covers the window during which a dead
// host's peer id is still reserved on the broker).
const RETRY_DELAY_MS = 1200;
// Safety cap so a permanently broken network eventually falls back to local.
const MAX_ATTEMPTS = 30;

// Establishes a peer session for the given room code using PeerJS' free public
// signaling server. The first participant to claim `roomCode` becomes the host;
// everyone else joins it. No backend of our own is required, so this works on a
// pure static deploy (e.g. Vercel).
//
// The election self-heals: if the room code is taken but the host is actually
// gone (e.g. it just left and migration is happening), joining times out and we
// retry — eventually claiming the freed id ourselves and becoming the new host.
//
// Resolves with either:
//   { role: 'host', code, attach(room) }  - call attach(room) once the Room exists
//   { role: 'join', socket }              - a PeerSocketClient for GameClient
function setupPeerSession(roomCode) {
  const peerCfg = getPeerConfig();
  if (!peerCfg) {
    return Promise.reject(
      new Error(
        'No signaling server configured. Set VITE_PEER_HOST at build time.',
      ),
    );
  }

  return new Promise(function (resolve, reject) {
    let attempts = 0;

    function retry() {
      setTimeout(attempt, RETRY_DELAY_MS);
    }

    function attempt() {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        reject(new Error('peer election exhausted'));
        return;
      }

      const host = new Peer(roomCode, peerCfg);
      let settled = false;

      host.on('open', function (id) {
        if (settled) return;
        settled = true;
        Console.info('Hosting room "' + id + '" — share this URL with friends to join.');

        // Until the Room is attached, buffer incoming peers.
        const pending = [];
        let addPeer = function (sock) {
          pending.push(sock);
        };

        host.on('connection', function (conn) {
          conn.on('open', function () {
            Console.info('Peer joined the room');
            addPeer(new PeerSocketServer(conn));
          });
          conn.on('error', function (e) {
            Console.error('Incoming peer error', e && e.type);
          });
        });

        resolve({
          role: 'host',
          code: id,
          attach: function (room) {
            for (let i = 0; i < pending.length; i++) room.addClient(pending[i]);
            pending.length = 0;
            addPeer = function (sock) {
              room.addClient(sock);
            };
          },
        });
      });

      host.on('error', function (err) {
        if (settled) return;
        settled = true;

        // Room code already taken => somebody is hosting => join them.
        if (err && err.type === 'unavailable-id') {
          host.destroy();
          tryJoin();
          return;
        }

        // Transient signaling error => retry the whole election.
        Console.error('Peer signaling error, retrying', err && err.type);
        try {
          host.destroy();
        } catch {
          /* ignore */
        }
        retry();
      });
    }

    function tryJoin() {
      const peer = new Peer(peerCfg);
      let joined = false;
      let timer = null;

      function fallback() {
        if (joined) return;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        try {
          peer.destroy();
        } catch {
          /* ignore */
        }
        retry();
      }

      peer.on('open', function () {
        const conn = peer.connect(roomCode, CONN_OPTS);
        timer = setTimeout(fallback, JOIN_TIMEOUT_MS);
        conn.on('open', function () {
          if (joined) return;
          joined = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          resolve({ role: 'join', socket: new PeerSocketClient(conn) });
        });
        conn.on('error', function (e) {
          Console.error('Join connection error, retrying', e && e.type);
          fallback();
        });
      });

      // 'peer-unavailable' => advertised host isn't reachable (likely just
      // left); retry the election so someone becomes the new host.
      peer.on('error', function (e) {
        Console.error('Join error, retrying', e && e.type);
        fallback();
      });
    }

    attempt();
  });
}

export { setupPeerSession, hasPeerSignaling };
