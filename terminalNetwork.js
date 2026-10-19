/**
 * TERMINAL NETWORK (без лабораторий). Уровень империи.
 * За тик не больше одной отправки: 1) энергия по уровню Storage,
 * 2) прочие ресурсы: излишек одной комнаты → дефицит другой.
 */
const {
  STORAGE,
  TERMINAL_SUPPLY,
  TERMINAL_NETWORK,
  CACHE,
} = require("./constants");
const marketManager = require("./market.manager");

// Имена своих комнат с терминалом, кэш в heap на CACHE.REFRESH_INTERVAL тиков.
function getTerminalRoomNames() {
  const cached = global._terminalRoomNames;
  if (cached && Game.time - cached.tick < CACHE.REFRESH_INTERVAL) {
    return cached.names;
  }
  const names = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller && room.controller.my && room.terminal) {
      names.push(roomName);
    }
  }
  global._terminalRoomNames = { tick: Game.time, names };
  return names;
}

const SEND_ERROR_MESSAGES = {
  [ERR_FULL]: "ERR_FULL: терминал получателя полон",
  [ERR_NOT_ENOUGH_ENERGY]:
    "ERR_NOT_ENOUGH_ENERGY: не хватает энергии на комиссию",
  [ERR_INVALID_ARGS]: "ERR_INVALID_ARGS: неверный ресурс/объём/комната",
  [ERR_TIRED]: "ERR_TIRED: терминал на перезарядке",
};

class TerminalNetwork {
  run() {
    const states = this.collectRoomStates();
    if (states.length < 2) {
      this.logStatus(states, "мало комнат с терминалом (нужно ≥ 2)");
      return;
    }
    if (this.balanceEnergy(states)) return;

    for (const resourceType of this.collectResourceTypes(states)) {
      if (resourceType === RESOURCE_ENERGY) continue;
      if (resourceType === RESOURCE_POWER) continue;
      if (this.balanceResource(resourceType, states)) return;
    }
    this.logStatus(states, "нет готовой отправки");
  }

  collectRoomStates() {
    const names = getTerminalRoomNames();
    const states = [];
    for (let i = 0; i < names.length; i++) {
      const room = Game.rooms[names[i]];
      // Кэш имён мог устареть: комнату потеряли или терминал снесли.
      if (!room || !room.controller || !room.controller.my) continue;
      if (!room.terminal) continue;
      const storage = room.storage;
      states.push({
        room,
        terminal: room.terminal,
        storage,
        storageEnergy: storage ? storage.store[RESOURCE_ENERGY] || 0 : 0,
        terminalEnergy: room.terminal.store[RESOURCE_ENERGY] || 0,
      });
    }
    return states;
  }

  collectResourceTypes(states) {
    const types = new Set();
    for (const state of states) {
      for (const r in state.terminal.store) types.add(r);
      if (state.storage) for (const r in state.storage.store) types.add(r);
    }
    return types;
  }

  totalResource(state, resourceType) {
    const inTerminal = state.terminal.store[resourceType] || 0;
    const inStorage = state.storage
      ? state.storage.store[resourceType] || 0
      : 0;
    return inTerminal + inStorage;
  }

  // Подгоняет объём под комиссию: после отправки в терминале остаётся
  // не меньше ENERGY_FLOOR энергии.
  fitSendAmount(terminal, destRoomName, resourceType, desired) {
    const minSend = TERMINAL_NETWORK.MIN_SEND_AMOUNT;
    const keepEnergy = TERMINAL_NETWORK.ENERGY_FLOOR;
    const energy = terminal.store[RESOURCE_ENERGY] || 0;
    const available =
      resourceType === RESOURCE_ENERGY
        ? energy
        : terminal.store[resourceType] || 0;

    let amount = Math.min(desired, available);
    if (amount < minSend) return 0;

    for (let i = 0; i < 8; i++) {
      const cost = marketManager.getTransactionCost(
        amount,
        terminal.room.name,
        destRoomName,
      );
      const energyAfter =
        resourceType === RESOURCE_ENERGY
          ? energy - amount - cost
          : energy - cost;
      if (energyAfter >= keepEnergy && amount >= minSend) return amount;

      amount =
        resourceType === RESOURCE_ENERGY
          ? energy - keepEnergy - cost
          : Math.floor(amount * 0.7);
      amount = Math.min(amount, available);
      if (amount < minSend) return 0;
    }
    return 0;
  }

  send(fromState, toState, resourceType, desired) {
    const free = toState.terminal.store.getFreeCapacity(resourceType);
    const amount = this.fitSendAmount(
      fromState.terminal,
      toState.room.name,
      resourceType,
      Math.min(desired, free),
    );
    if (amount < TERMINAL_NETWORK.MIN_SEND_AMOUNT) return false;

    const result = fromState.terminal.send(
      resourceType,
      amount,
      toState.room.name,
      "TerminalNetwork balance",
    );
    if (result === OK) {
      console.log(
        `[TerminalNetwork] ${fromState.room.name} → ${toState.room.name}: ` +
          `${amount} ${resourceType}`,
      );
      return true;
    }
    const reason =
      SEND_ERROR_MESSAGES[result] || `неизвестная ошибка ${result}`;
    console.log(
      `[TerminalNetwork] send ${resourceType} ${amount} ` +
        `${fromState.room.name} → ${toState.room.name}: ${reason}`,
    );
    return false;
  }

  balanceEnergy(states) {
    const surplusMin =
      STORAGE.ENERGY_MIN * TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER;

    const deficits = states
      .filter(s => s.storageEnergy < STORAGE.ENERGY_MIN)
      .sort((a, b) => a.storageEnergy - b.storageEnergy);
    if (deficits.length === 0) return false;

    const surpluses = states
      .filter(s => s.terminal.cooldown === 0)
      .filter(s => s.storageEnergy > surplusMin)
      .filter(
        s =>
          s.terminalEnergy >
          TERMINAL_NETWORK.ENERGY_FLOOR + TERMINAL_NETWORK.MIN_SEND_AMOUNT,
      )
      .sort((a, b) => b.storageEnergy - a.storageEnergy);

    for (const from of surpluses) {
      const to = deficits.find(d => d.room.name !== from.room.name);
      if (!to) return false;
      const needed = STORAGE.ENERGY_MIN - to.storageEnergy;
      if (this.send(from, to, RESOURCE_ENERGY, needed)) return true;
    }
    return false;
  }

  balanceResource(resourceType, states) {
    // Дешёвая проверка дефицита идёт первой: у большинства ресурсов его нет.
    let hasDeficit = false;
    for (let i = 0; i < states.length; i++) {
      if (
        this.totalResource(states[i], resourceType) <
        TERMINAL_NETWORK.RESOURCE_DEFICIT_BELOW
      ) {
        hasDeficit = true;
        break;
      }
    }
    if (!hasDeficit) return false;

    const surplusState = states
      .filter(s => s.terminal.cooldown === 0)
      .filter(
        s =>
          this.totalResource(s, resourceType) >
          TERMINAL_NETWORK.RESOURCE_SURPLUS_ABOVE,
      )
      .filter(
        s =>
          (s.terminal.store[resourceType] || 0) >=
          TERMINAL_NETWORK.MIN_SEND_AMOUNT,
      )
      .sort(
        (a, b) =>
          this.totalResource(b, resourceType) -
          this.totalResource(a, resourceType),
      )[0];
    if (!surplusState) return false;

    const deficitState = states
      .filter(s => s.room.name !== surplusState.room.name)
      .filter(
        s =>
          this.totalResource(s, resourceType) <
          TERMINAL_NETWORK.RESOURCE_DEFICIT_BELOW,
      )
      .sort(
        (a, b) =>
          this.totalResource(a, resourceType) -
          this.totalResource(b, resourceType),
      )[0];
    if (!deficitState) return false;

    const needed =
      TERMINAL_NETWORK.RESOURCE_TARGET -
      this.totalResource(deficitState, resourceType);
    return this.send(surplusState, deficitState, resourceType, needed);
  }

  logStatus(states, reason) {
    if (Game.time % TERMINAL_NETWORK.STATUS_INTERVAL !== 0) return;
    console.log(`[TerminalNetwork] ${reason}`);
    for (const s of states) {
      console.log(
        `  ${s.room.name}: storageE=${s.storageEnergy} terminalE=${s.terminalEnergy}` +
          (s.terminal.cooldown ? ` cd=${s.terminal.cooldown}` : ""),
      );
    }
  }
}

module.exports = new TerminalNetwork();
