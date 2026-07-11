const Event = {
  events: [],
};

Event.on = function (event_name, callback) {
  if (!this.events[event_name]) {
    this.events[event_name] = [];
  }
  this.events[event_name].push({
    callback: callback,
  });
};

Event.emit = function (event_name, ...param) {
  let event = this.events[event_name];
  if (event && event.length > 0) {
    for (let i = 0; i < event.length; i++) event[i].callback(...param);
  }
};

export { Event };
