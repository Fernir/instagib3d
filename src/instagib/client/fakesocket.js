import { Console } from '../polyfill.js';
import { Event } from '../server/libs/event.js';

function fakeSend(event, data) {
  const PING = 16;
  setTimeout(function () {
    Event.emit(event, data);
  }, PING);
}

class FakeSocketClient {
  constructor(port, my_ip) {
    Console.assert(port && my_ip);
    Console.debug('Connecting to fake server', port, 'from', my_ip);
    this.connect = function () {
      fakeSend('fakeconnection' + port, my_ip);
    };
    this.readyState = 1;
    this.OPEN = 1;

    let self = this;
    this.binaryType = 'unknown';

    this.onmessage = function (_e) {
      Console.assert('Please override onmessage callback');
    };
    this.onopen = function () {
      Console.assert('Please override onopen callback');
    };
    this.onclose = function (_e) {
      Console.assert('Please override onclose callback');
    };
    this.onerror = function (_e) {
      Console.assert('Please override onerror callback');
    };
    this.send = function (data) {
      fakeSend('fakeclientsend' + port, { data: data, ip: my_ip });
    };

    Event.on('fakeopen' + my_ip, function () {
      Console.debug(my_ip, ': onopen');
      self.onopen();
    });
    Event.on('fakeserversend' + my_ip, function (e) {
      self.onmessage(e);
    });
    Event.on('fakeclose', function (e) {
      Console.debug(my_ip, ': onclose');
      self.onclose(e);
    });
    Event.on('fakeerror', function (e) {
      Console.debug(my_ip, ': onerror');
      self.onerror(e);
    });
  }
}

let FakeServer = {};

FakeServer.Server = function (param) {
  Console.debug('FakeServer listening port:', param.port);

  let events = [];

  function emit(event_name, ...param) {
    let event = events[event_name];
    if (event && event.callback) {
      event.callback(...param);
    }
  }

  function FakeSocketServer(ip) {
    this.on = function (event_name, callback) {
      events[event_name + ip] = { callback: callback };
    };
    this.send = function (data, _param) {
      fakeSend('fakeserversend' + ip, { data: data });
    };
    this.ip = ip;
    this.readyState = 1;
    this.OPEN = 1;
  }

  Event.on('fakeconnection' + param.port, function (host) {
    let client = new FakeSocketServer(host);
    emit('connection', client);
    fakeSend('fakeopen' + host);
    emit('open' + host);
  });
  Event.on('fakeclientsend' + param.port, function (data) {
    let ip = data.ip;
    emit('message' + ip, data.data);
  });

  this.on = function (event_name, callback) {
    events[event_name] = { callback: callback };
  };
  this.close = function () {};
};

export { FakeSocketClient, FakeServer };
