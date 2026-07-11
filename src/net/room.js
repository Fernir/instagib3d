import { Console } from '@/core/polyfill.js';

import { FakeServer } from './fakesocket.js';
import { Transport } from './transport.js';

import { Game } from '@/sim/game.js';

class Room {
  constructor(seed, size_class, port) {
    let game = new Game(size_class, seed);
    game.start();

    function addClient(ws) {
      Console.info('new connection');

      let transport = new Transport(ws, game);
      game.clients.push(transport);
      return transport;
    }

    let socket = new FakeServer.Server({ port: port });
    socket.on('connection', addClient);

    // Used by the P2P host to inject remote players (PeerSocketServer) as
    // regular clients of this room.
    this.addClient = addClient;
    this.getGame = function () {
      return game;
    };
    this.getPort = function () {
      return port;
    };
    this.destroy = function () {
      game.stop();
      if (socket.close) socket.close();
    };
  }
}

export { Room };
