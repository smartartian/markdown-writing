export class CommandRegistry {
  constructor() {
    this.commands = new Map();
  }

  register(name, handler) {
    if (!name || typeof handler !== 'function') {
      throw new TypeError('command registration requires a name and handler');
    }
    this.commands.set(name, handler);
    return this;
  }

  has(name) {
    return this.commands.has(name);
  }

  execute(name, context = {}) {
    const handler = this.commands.get(name);
    if (!handler) throw new Error(`unknown command: ${name}`);
    return handler(context);
  }
}

export function createCommandRegistry() {
  return new CommandRegistry();
}
