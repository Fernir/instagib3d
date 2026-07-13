export class Event {
  static events = {};

  static on(event_name, callback) {
    if (!Event.events[event_name]) {
      Event.events[event_name] = [];
    }
    Event.events[event_name].push({ callback });
  }

  static emit(event_name, ...param) {
    const event = Event.events[event_name];
    if (event && event.length > 0) {
      for (let i = 0; i < event.length; i++) event[i].callback(...param);
    }
  }
}
