import { FakeServer } from '../client/fakesocket.js';
import { Console } from '../polyfill.js';

import { Game } from './game/game.js';
import { Transport } from './game/transport.js';

class Room
{
    constructor(seed, size_class, port)
    {
        let game = new Game(size_class, seed);
        game.start();

        let socket = new FakeServer.Server({ port: port });
        socket.on("connection", function (ws) {
            Console.info("new connection");

            let transport = new Transport(ws, game);
            game.clients.push(transport);
        });

        this.getGame = function () { return game; };
        this.getPort = function () { return port; };
        this.destroy = function () {
            game.stop();
            if (socket.close) socket.close();
        };
    }
}

export { Room };
