/**
 * TERMINAL NETWORK (Task System v4)
 * Singleton. Уровень империи.
 *
 * Приоритет за тик (один send):
 *  1. Реагенты лаб — комната с пустым ингредиентом запрашивает,
 *     донор с запасом отправляет (если ресурс в storage — ставим
 *     terminalExports, воркеры грузят терминал на следующем тике).
 *  2. Энергия — по уровню Storage.
 *  3. Прочие ресурсы — выравнивание излишков.
 */

const { STORAGE, TERMINAL_SUPPLY, TERMINAL_NETWORK } = require("./constants");
const labWorker = require("lab.worker");

class TerminalNetwork {
  run() {
    const states = this.collectRoomStates();
    if (states.length < 2) {
      this.logStatus(states, [], "мало комнат с терминалом (нужно ≥ 2)");
      return;
    }

    const labRequests = this.collectLabRequests(states);
    this.resetExports(states);

    if (this.fulfillLabRequests(states, labRequests)) return;
    if (this.balanceEnergy(states)) return;

    const resourceTypes = this.collectResourceTypes(states);
    for (const resourceType of resourceTypes) {
      if (resourceType === RESOURCE_ENERGY) continue;
      if (resourceType === RESOURCE_POWER) continue;
      if (this.balanceResource(resourceType, states)) return;
    }

    this.logStatus(states, labRequests, "нет готовой отправки");
  }

  collectRoomStates() {
    const states = [];
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
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
      for (const resourceType in state.terminal.store) {
        types.add(resourceType);
      }
      if (state.storage) {
        for (const resourceType in state.storage.store) {
          types.add(resourceType);
        }
      }
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

  resourceInLabs(room, resourceType) {
    let total = 0;
    for (const { config } of labWorker.getConfigs(room)) {
      const ids = [config.lab1, config.lab2, config.reactor];
      for (const id of ids) {
        const lab = Game.getObjectById(id);
        if (lab) total += lab.store[resourceType] || 0;
      }
    }
    return total;
  }

  roomUsesReagent(room, resourceType) {
    for (const { config } of labWorker.getConfigs(room)) {
      if (config.reagent1 === resourceType || config.reagent2 === resourceType) {
        return true;
      }
    }
    return false;
  }

  availableToGive(state, resourceType) {
    const keep = this.roomUsesReagent(state.room, resourceType)
      ? TERMINAL_NETWORK.LAB_KEEP
      : 0;
    return Math.max(0, this.totalResource(state, resourceType) - keep);
  }

  collectLabRequests(states) {
    const requests = [];
    for (const state of states) {
      const reagents = new Set();
      for (const { config } of labWorker.getConfigs(state.room)) {
        if (config.reagent1) reagents.add(config.reagent1);
        if (config.reagent2) reagents.add(config.reagent2);
      }

      for (const resourceType of reagents) {
        const have =
          this.totalResource(state, resourceType) +
          this.resourceInLabs(state.room, resourceType);
        if (have >= TERMINAL_NETWORK.LAB_REQUEST_BELOW) continue;

        requests.push({
          state,
          resourceType,
          have,
          needed: TERMINAL_NETWORK.LAB_SHIP_AMOUNT,
        });
      }
    }
    return requests.sort((a, b) => a.have - b.have);
  }

  resetExports(states) {
    for (const state of states) {
      if (!Memory.rooms) Memory.rooms = {};
      if (!Memory.rooms[state.room.name]) Memory.rooms[state.room.name] = {};
      Memory.rooms[state.room.name].terminalExports = {};
    }
  }

  addExport(roomName, resourceType, amount) {
    if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};
    const exports = Memory.rooms[roomName].terminalExports || {};
    exports[resourceType] = Math.max(exports[resourceType] || 0, amount);
    Memory.rooms[roomName].terminalExports = exports;
  }

  findDonor(states, resourceType, destRoomName) {
    const minSend = TERMINAL_NETWORK.MIN_SEND_AMOUNT;
    return states
      .filter(s => s.room.name !== destRoomName)
      .filter(s => this.availableToGive(s, resourceType) >= minSend)
      .sort((a, b) => {
        const aReady =
          a.terminal.cooldown === 0 &&
          (a.terminal.store[resourceType] || 0) >= minSend
            ? 1
            : 0;
        const bReady =
          b.terminal.cooldown === 0 &&
          (b.terminal.store[resourceType] || 0) >= minSend
            ? 1
            : 0;
        if (bReady !== aReady) return bReady - aReady;
        return (
          this.availableToGive(b, resourceType) -
          this.availableToGive(a, resourceType)
        );
      })[0];
  }

  fulfillLabRequests(states, requests) {
    const minSend = TERMINAL_NETWORK.MIN_SEND_AMOUNT;

    for (const req of requests) {
      const donor = this.findDonor(states, req.resourceType, req.state.room.name);
      if (!donor) continue;

      const inTerminal = donor.terminal.store[req.resourceType] || 0;
      const canGive = this.availableToGive(donor, req.resourceType);
      const desired = Math.min(req.needed, canGive);

      if (
        donor.terminal.cooldown === 0 &&
        inTerminal >= minSend &&
        this.send(donor, req.state, req.resourceType, desired)
      ) {
        return true;
      }

      const loadAmount = Math.min(desired, canGive) - inTerminal;
      if (
        loadAmount > 0 &&
        donor.storage &&
        (donor.storage.store[req.resourceType] || 0) > 0
      ) {
        this.addExport(
          donor.room.name,
          req.resourceType,
          Math.max(loadAmount, minSend),
        );
      }
    }

    return false;
  }

  /**
   * Подгоняет объём отправки под комиссию и резерв энергии в терминале.
   * После send в терминале донора должно остаться >= ENERGY_MIN.
   */
  fitSendAmount(terminal, destRoomName, resourceType, desired) {
    const minSend = TERMINAL_NETWORK.MIN_SEND_AMOUNT;
    const keepEnergy = TERMINAL_SUPPLY.ENERGY_MIN;
    const energy = terminal.store[RESOURCE_ENERGY] || 0;
    const available =
      resourceType === RESOURCE_ENERGY
        ? energy
        : terminal.store[resourceType] || 0;

    let amount = Math.min(desired, available);
    if (amount < minSend) return 0;

    for (let i = 0; i < 8; i++) {
      const cost = Game.market.calcTransactionCost(
        amount,
        terminal.room.name,
        destRoomName,
      );
      const energyAfter =
        resourceType === RESOURCE_ENERGY
          ? energy - amount - cost
          : energy - cost;

      if (energyAfter >= keepEnergy && amount >= minSend) {
        return amount;
      }

      if (resourceType === RESOURCE_ENERGY) {
        amount = energy - keepEnergy - cost;
      } else {
        amount = Math.floor(amount * 0.7);
      }
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

    console.log(
      `[TerminalNetwork] send ${resourceType} ${fromState.room.name} → ` +
        `${toState.room.name} ошибка ${result}`,
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
          TERMINAL_SUPPLY.ENERGY_MIN + TERMINAL_NETWORK.MIN_SEND_AMOUNT,
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
    const surplusState = states
      .filter(s => s.terminal.cooldown === 0)
      .filter(
        s =>
          this.availableToGive(s, resourceType) >
          TERMINAL_NETWORK.RESOURCE_SURPLUS_ABOVE,
      )
      .filter(
        s =>
          (s.terminal.store[resourceType] || 0) >=
          TERMINAL_NETWORK.MIN_SEND_AMOUNT,
      )
      .sort(
        (a, b) =>
          this.availableToGive(b, resourceType) -
          this.availableToGive(a, resourceType),
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

  logStatus(states, labRequests, reason) {
    if (Game.time % TERMINAL_NETWORK.STATUS_INTERVAL !== 0) return;

    console.log(`[TerminalNetwork] ${reason}`);
    if (labRequests && labRequests.length) {
      for (const req of labRequests) {
        console.log(
          `  запрос ${req.state.room.name}: ${req.resourceType} (есть ${req.have})`,
        );
      }
    }
    for (const s of states) {
      const exports = (Memory.rooms[s.room.name] || {}).terminalExports || {};
      const exportKeys = Object.keys(exports);
      const extra = exportKeys.length
        ? ` export=${exportKeys.join(",")}`
        : "";
      console.log(
        `  ${s.room.name}: storageE=${s.storageEnergy} terminalE=${s.terminalEnergy}` +
          (s.terminal.cooldown ? ` cd=${s.terminal.cooldown}` : "") +
          extra,
      );
    }
  }
}

module.exports = new TerminalNetwork();
