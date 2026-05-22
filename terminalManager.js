/**
 * ===================================================
 * TERMINALMANAGER.JS — Terminal Infrastructure Layer
 * ===================================================
 * VERSION: 4.0
 *
 * ИЗМЕНЕНИЯ v4.0:
 * - Удалён runMineralSell() — ownership передан MarketExecutor
 * - Удалена продажа energy — ownership передан MarketExecutor
 * - Удалён runMineralNeeds() — больше не нужен без продажи
 * - Оставлена только terminal infrastructure:
 *     terminal.send() между комнатами
 *     inter-room energy balancing
 *     lab reagent logistics
 *     terminal cooldown handling
 *
 * OWNERSHIP:
 * terminalManager  → terminal.send(), inter-room logistics
 * MarketExecutor   → Game.market.deal(), market orders
 * ===================================================
 */

const resourceBalancer = require("./resourceBalancer");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const TERMINAL_ENERGY_MIN = 20000;

const ENERGY_POOR_THRESHOLD = 20000;
const ENERGY_RICH_THRESHOLD = 100000;
const ENERGY_SEND_AMOUNT = 20000;

const CHECK_INTERVAL = 50;
const LAB_REAGENT_MIN = 3000;
const LAB_REAGENT_SEND = 5000;
const LAB_REAGENT_DONOR_MIN = 6000;

let roomOffsets = {};

const terminalManager = {
  /**
   * Возвращает все конфиги лаб из room.memory.
   */
  getLabConfigs: function (room) {
    const mem = room.memory;
    const configs = [];
    if (mem.labs) configs.push({ key: "labs", config: mem.labs });
    if (mem.labs2) configs.push({ key: "labs2", config: mem.labs2 });
    if (mem.labs3) configs.push({ key: "labs3", config: mem.labs3 });
    if (mem.labs4) configs.push({ key: "labs4", config: mem.labs4 });
    if (mem.labs5) configs.push({ key: "labs5", config: mem.labs5 });
    return configs;
  },

  /**
   * Суммарный запас ресурса в storage + terminal комнаты.
   */
  getTotal: function (room, resource) {
    const t = room.terminal ? room.terminal.store[resource] || 0 : 0;
    const s = room.storage ? room.storage.store[resource] || 0 : 0;
    return s + t;
  },

  /**
   * Добавляет запрос на перенос ресурса в терминал.
   * terminalUnloader читает room.memory.terminalNeeds и выполняет перенос.
   */
  addNeed: function (donorRoom, resource, amount, toRoom) {
    if (!donorRoom.memory.terminalNeeds) {
      donorRoom.memory.terminalNeeds = [];
    }
    const needs = donorRoom.memory.terminalNeeds;
    const exists = needs.find(
      n => n.resource === resource && n.toRoom === toRoom,
    );
    if (exists) {
      exists.amount = amount;
      return false;
    }
    needs.push({ resource, amount, toRoom });
    return true;
  },

  /**
   * ── БАЛАНСИРОВКА ЭНЕРГИИ МЕЖДУ КОМНАТАМИ ─────────────────────────────────
   * Отправляет energy из богатых комнат в бедные через terminal.send().
   * НЕ использует Game.market.deal().
   */
  runEnergyBalance: function () {
    if (Game.time % 100 !== 0) return;

    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    const poorRooms = ourRooms.filter(
      r => (r.storage.store[RESOURCE_ENERGY] || 0) < ENERGY_POOR_THRESHOLD,
    );
    const richRooms = ourRooms.filter(
      r =>
        (r.storage.store[RESOURCE_ENERGY] || 0) > ENERGY_RICH_THRESHOLD &&
        r.terminal.cooldown === 0,
    );

    if (poorRooms.length === 0 || richRooms.length === 0) return;

    for (const poorRoom of poorRooms) {
      const donor = richRooms.find(
        r =>
          r.name !== poorRoom.name &&
          (r.terminal.store[RESOURCE_ENERGY] || 0) >=
            ENERGY_SEND_AMOUNT + TERMINAL_ENERGY_MIN,
      );

      if (!donor) {
        const richWithStorage = richRooms.find(
          r =>
            r.name !== poorRoom.name &&
            (r.storage.store[RESOURCE_ENERGY] || 0) > ENERGY_RICH_THRESHOLD,
        );
        if (richWithStorage) {
          const isNew = this.addNeed(
            richWithStorage,
            RESOURCE_ENERGY,
            ENERGY_SEND_AMOUNT,
            poorRoom.name,
          );
          if (isNew) {
            console.log(
              `[EnergyBalance] 📦 ${richWithStorage.name}: запрос ` +
                `${ENERGY_SEND_AMOUNT} energy → ${poorRoom.name}`,
            );
          }
        }
        continue;
      }

      const txCost = Game.market.calcTransactionCost(
        ENERGY_SEND_AMOUNT,
        donor.name,
        poorRoom.name,
      );
      const donorTerminalEnergy = donor.terminal.store[RESOURCE_ENERGY] || 0;

      if (
        txCost + ENERGY_SEND_AMOUNT >
        donorTerminalEnergy - TERMINAL_ENERGY_MIN
      ) {
        console.log(
          `[EnergyBalance] ⚡ ${donor.name}: мало энергии в терминале ` +
            `(нужно: ${
              txCost + ENERGY_SEND_AMOUNT
            }, есть: ${donorTerminalEnergy})`,
        );
        this.addNeed(donor, RESOURCE_ENERGY, ENERGY_SEND_AMOUNT, poorRoom.name);
        continue;
      }

      const result = donor.terminal.send(
        RESOURCE_ENERGY,
        ENERGY_SEND_AMOUNT,
        poorRoom.name,
      );
      if (result === OK) {
        console.log(
          `[EnergyBalance] ✅ ${donor.name} → ${poorRoom.name}: ` +
            `${ENERGY_SEND_AMOUNT} energy`,
        );
        if (donor.memory.terminalNeeds) {
          donor.memory.terminalNeeds = donor.memory.terminalNeeds.filter(
            n =>
              !(n.resource === RESOURCE_ENERGY && n.toRoom === poorRoom.name),
          );
        }
        richRooms.splice(richRooms.indexOf(donor), 1);
      } else {
        console.log(`[EnergyBalance] ❌ Ошибка отправки energy: ${result}`);
      }
    }
  },

  /**
   * ── АВТОЛОГИСТИКА РЕАГЕНТОВ ──────────────────────────────────────────────
   * Отправляет реагенты для лаб между комнатами через terminal.send().
   * НЕ использует Game.market.deal().
   */
  runLabSupply: function (room) {
    if ((Game.time + (roomOffsets[room.name] || 0)) % CHECK_INTERVAL !== 0)
      return;

    const terminal = room.terminal;
    if (!terminal) return;
    if (terminal.cooldown > 0) return;

    const availableEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (availableEnergy < TERMINAL_ENERGY_MIN) return;

    const labConfigs = this.getLabConfigs(room);
    if (labConfigs.length === 0) return;

    const needs = [];
    for (const { config } of labConfigs) {
      for (const resource of [config.reagent1, config.reagent2]) {
        if (!resource) continue;
        const total = this.getTotal(room, resource);
        if (total < LAB_REAGENT_MIN) {
          if (!needs.find(n => n.resource === resource)) {
            needs.push({ resource, total });
          }
        }
      }
    }

    if (needs.length === 0) return;

    for (const { resource, total } of needs) {
      console.log(
        `[LabSupply ${room.name}] Мало ${resource}: ${total} — ищем донора`,
      );

      let donorRoom = null;
      let donorAmount = 0;

      for (const roomName in Game.rooms) {
        if (roomName === room.name) continue;
        const donor = Game.rooms[roomName];
        if (!donor.controller || !donor.controller.my) continue;
        if (!donor.terminal) continue;

        const donorTotal = this.getTotal(donor, resource);
        if (donorTotal > LAB_REAGENT_DONOR_MIN) {
          donorRoom = donor;
          donorAmount = Math.min(
            LAB_REAGENT_SEND,
            donorTotal - LAB_REAGENT_DONOR_MIN,
          );
          break;
        }
      }

      if (!donorRoom) {
        console.log(
          `[LabSupply ${room.name}] Нет донора для ${resource} — нужно купить`,
        );
        continue;
      }

      const donorInTerminal = donorRoom.terminal.store[resource] || 0;

      if (donorInTerminal < donorAmount) {
        const isNew = this.addNeed(donorRoom, resource, donorAmount, room.name);
        if (isNew) {
          console.log(
            `[LabSupply] 📦 ${donorRoom.name}: запрос ${donorAmount} ${resource} → ${room.name}`,
          );
        } else {
          console.log(
            `[LabSupply] ⏳ ${donorRoom.name}: ждём переноса ${resource} (есть: ${donorInTerminal})`,
          );
        }
        continue;
      }

      if (donorRoom.terminal.cooldown > 0) {
        console.log(`[LabSupply] ⏳ ${donorRoom.name}: терминал на кулдауне`);
        continue;
      }

      const txCost = Game.market.calcTransactionCost(
        donorAmount,
        donorRoom.name,
        room.name,
      );
      const donorEnergy = donorRoom.terminal.store[RESOURCE_ENERGY] || 0;

      if (txCost > donorEnergy - TERMINAL_ENERGY_MIN) {
        console.log(
          `[LabSupply] ⚡ ${donorRoom.name}: мало энергии (нужно: ${txCost}, есть: ${donorEnergy})`,
        );
        continue;
      }

      const result = donorRoom.terminal.send(resource, donorAmount, room.name);
      if (result === OK) {
        if (donorRoom.memory.terminalNeeds) {
          donorRoom.memory.terminalNeeds =
            donorRoom.memory.terminalNeeds.filter(
              n => !(n.resource === resource && n.toRoom === room.name),
            );
        }
        console.log(
          `[LabSupply] ✅ ${donorRoom.name} → ${room.name}: ${donorAmount} ${resource}`,
        );
      } else {
        console.log(`[LabSupply] ❌ Ошибка отправки ${resource}: ${result}`);
      }

      return;
    }
  },

  /**
   * ── ОСНОВНОЙ ЗАПУСК ───────────────────────────────────────────────────────
   */
  run: function (room) {
    const roomNames = Object.keys(Game.rooms)
      .filter(n => {
        const r = Game.rooms[n];
        return r.controller && r.controller.my;
      })
      .sort();

    // ── ШАГ 1: ГЛОБАЛЬНЫЕ БАЛАНСИРОВЩИКИ — только из первой комнаты ────────
    if (roomNames[0] === room.name) {
      this.runEnergyBalance();
      resourceBalancer.run();
    }

    // ── ШАГ 2: ЛОГИСТИКА ЛАБ ────────────────────────────────────────────────
    if (roomOffsets[room.name] === undefined) {
      const count = Object.keys(roomOffsets).length;
      const step = Math.floor(CHECK_INTERVAL / 5);
      roomOffsets[room.name] = count * step;
    }
    this.runLabSupply(room);
  },
};

module.exports = terminalManager;
