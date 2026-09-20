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

const {
  STORAGE,
  TERMINAL_SUPPLY,
  TERMINAL_NETWORK,
  CACHE,
} = require("./constants");
const labWorker = require("lab.worker");

// ── КЕШИ НА ТИК (heap) ──────────────────────────────────────────────────
// 1. Список своих комнат с терминалом. В Game.rooms лежат и чужие видимые
//    комнаты (разведка, оборона), а состав этого объекта меняется редко:
//    каждый тик перебирать все комнаты ради одного и того же подмножества —
//    плата ни за что. Имена кэшируются в heap и пересобираются раз в
//    CACHE.REFRESH_INTERVAL тиков (новый терминал входит в сеть с этой
//    задержкой). Объекты room/terminal/storage разрешаются заново каждый тик и
//    перепроверяются на принадлежность, поэтому устаревшая запись кэша
//    (комната потеряна, терминал снесён) просто пропускается, а не ломает run.
// 2. Конфиги троек лаб и разрешённые объекты лабораторий комнаты на текущий
//    тик. resourceInLabs/roomUsesReagent вызываются на каждый реагент и внутри
//    компараторов сортировки доноров, а Game.getObjectById и сборка массива
//    конфигов — самая дорогая их часть (замер shard3: resourceInLabs 2.03 мкс,
//    collectLabRequests 79 мкс за тик).

/**
 * Разрешённые лаборатории комнаты и её реагенты на текущий тик.
 * `labs` идут по слотам конфигов (lab1, lab2, reactor) — ровно в том порядке и
 * с той же кратностью, что и прежний обход, но каждый id разрешается один раз
 * за тик. `reagentList` — упорядоченный список реагентов (порядок первого
 * появления, как у прежнего Set), `reagents` — та же информация для O(1)
 * проверки «комната использует этот реагент».
 * @param {Room} room
 * @returns {{labs: any[], reagentList: string[], reagents: Object<string, boolean>}}
 */
function getRoomLabInfo(room) {
  let cache = global._terminalLabs;
  if (!cache || cache.tick !== Game.time) {
    cache = global._terminalLabs = { tick: Game.time, rooms: {} };
  }

  const cached = cache.rooms[room.name];
  if (cached) return cached;

  const labs = [];
  const byId = /** @type {Object<string, any>} */ ({});
  const reagents = /** @type {Object<string, boolean>} */ ({});
  const reagentList = [];

  const configs = labWorker.getConfigs(room);
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i].config;

    if (config.reagent1 && !reagents[config.reagent1]) {
      reagents[config.reagent1] = true;
      reagentList.push(config.reagent1);
    }
    if (config.reagent2 && !reagents[config.reagent2]) {
      reagents[config.reagent2] = true;
      reagentList.push(config.reagent2);
    }

    const ids = [config.lab1, config.lab2, config.reactor];
    for (let j = 0; j < ids.length; j++) {
      const id = ids[j];
      if (!id) continue;
      let lab = byId[id];
      if (lab === undefined) {
        lab = Game.getObjectById(id) || null;
        byId[id] = lab;
      }
      if (lab) labs.push(lab);
    }
  }

  const info = { labs, reagentList, reagents };
  cache.rooms[room.name] = info;
  return info;
}

/**
 * Комнаты с терминалом, принадлежащие игроку (имена, heap-кеш на
 * CACHE.REFRESH_INTERVAL тиков). Чужие видимые комнаты в список не попадают.
 * @returns {string[]}
 */
function getTerminalRoomNames() {
  const cached = global._terminalRoomNames;
  if (cached && Game.time - cached.tick < CACHE.REFRESH_INTERVAL) {
    return cached.names;
  }

  const names = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    if (!room.terminal) continue;
    names.push(roomName);
  }

  global._terminalRoomNames = { tick: Game.time, names };
  return names;
}

// ── ОШИБКИ Terminal.send ────────────────────────────────────────────────
// Политика отправок не меняется: неудачная отправка возвращает false, и
// вызывающая сторона продолжает обход (следующий донор/категория). Различаются
// только причины: раньше все ошибки печатались одинаково («ошибка N»), и по
// логу нельзя было понять, ждать ли перезарядки (ERR_TIRED), доливать ли
// энергию под комиссию (ERR_NOT_ENOUGH_ENERGY), чинить ли аргументы
// (ERR_INVALID_ARGS) или получатель уже полон (ERR_FULL).
// Система backoff/повторов не вводится — коды различаются только в диагностике.
/** @type {Object<number, string>} */
const SEND_ERROR_MESSAGES = {
  [ERR_FULL]: "ERR_FULL: терминал получателя полон",
  [ERR_NOT_ENOUGH_ENERGY]:
    "ERR_NOT_ENOUGH_ENERGY: не хватает энергии на комиссию",
  [ERR_INVALID_ARGS]: "ERR_INVALID_ARGS: неверный ресурс/объём/комната",
  [ERR_TIRED]: "ERR_TIRED: терминал на перезарядке (cooldown)",
};

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
    const names = getTerminalRoomNames();
    const states = [];
    for (let i = 0; i < names.length; i++) {
      const room = Game.rooms[names[i]];
      // Кеш имён пересобирается раз в CACHE.REFRESH_INTERVAL тиков, поэтому
      // запись может устареть: комнату могли потерять, терминал — снести.
      if (!room) continue;
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

  /**
   * Суммарный запас ресурса в лабораториях комнаты.
   * Лаборатории разрешаются один раз за тик (см. getRoomLabInfo) — прежний код
   * вызывал Game.getObjectById на каждый слот каждой тройки при каждом
   * обращении, а обращений на тик много: по одному на реагент комнаты плюс
   * компараторы сортировки доноров.
   * @param {Room} room
   * @param {string} resourceType
   * @returns {number}
   */
  resourceInLabs(room, resourceType) {
    const labs = getRoomLabInfo(room).labs;
    let total = 0;
    for (let i = 0; i < labs.length; i++) {
      total += labs[i].store[resourceType] || 0;
    }
    return total;
  }

  roomUsesReagent(room, resourceType) {
    return getRoomLabInfo(room).reagents[resourceType] === true;
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
      // Реагенты берутся из того же тикового кеша, что и лаборатории: порядок
      // первого появления сохранён, поэтому порядок заявок (и их сортировка по
      // запасу) не изменился, а getConfigs не собирается повторно.
      const reagents = getRoomLabInfo(state.room).reagentList;

      for (let i = 0; i < reagents.length; i++) {
        const resourceType = reagents[i];
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

  /**
   * Снимает заявки прошлого тика перед новым разбором (заявки текущего тика
   * дописывает addExport — поведение не изменилось).
   *
   * Прежний код безусловно писал Memory.rooms[*].terminalExports = {} для каждой
   * комнаты с терминалом КАЖДЫЙ тик. Запись в Memory помечает её «грязной», и
   * движок сериализует её целиком (36 КБ на живом shard3) — в том числе в тики,
   * когда заявок не было вовсе (замер: terminalExports пуст во всех 5 комнатах).
   * Теперь объект трогается, только если в нём что-то есть; если заявок не было,
   * Memory остаётся нетронутой.
   */
  resetExports(states) {
    for (let i = 0; i < states.length; i++) {
      const roomMemory = Memory.rooms && Memory.rooms[states[i].room.name];
      const exports = roomMemory && roomMemory.terminalExports;
      if (!exports) continue;
      for (const resourceType in exports) delete exports[resourceType];
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

    // Политика та же (false — вызывающая сторона продолжает обход), различается
    // только причина отказа.
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
