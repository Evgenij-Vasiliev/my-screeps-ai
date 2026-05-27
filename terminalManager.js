/**
 * ===================================================
 * TERMINALMANAGER.JS — Terminal Infrastructure Layer
 * ===================================================
 * VERSION: 4.1
 *
 * ИЗМЕНЕНИЯ v4.1:
 * - Добавлен runSellPrep() — подготовка ресурсов к продаже.
 *   Если marketManager имеет sell intent для ресурса,
 *   а в терминале его мало — запрашиваем перенос из storage
 *   через addNeed() (terminalUnloader выполнит перенос).
 *
 * ИЗМЕНЕНИЯ v4.0:
 * - Удалён runMineralSell() — ownership передан MarketExecutor
 * - Оставлена только terminal infrastructure
 * ===================================================
 */

const resourceBalancer = require("./resourceBalancer");
const marketManager = require("./marketManager");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const TERMINAL_ENERGY_MIN = 20000;
const ENERGY_POOR_THRESHOLD = 20000;
const ENERGY_RICH_THRESHOLD = 100000;
const ENERGY_SEND_AMOUNT = 20000;
const CHECK_INTERVAL = 50;
const LAB_REAGENT_MIN = 3000;
const LAB_REAGENT_SEND = 5000;
const LAB_REAGENT_DONOR_MIN = 6000;

/**
 * Сколько держим в терминале для продажи.
 * Если меньше — запрашиваем перенос из storage.
 */
const SELL_TERMINAL_TARGET = 10000;

/**
 * Максимум в терминале для продажи — не накапливаем слишком много.
 */
const SELL_TERMINAL_MAX = 20000;

let roomOffsets = {};

const terminalManager = {
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

  getTotal: function (room, resource) {
    const t = room.terminal ? room.terminal.store[resource] || 0 : 0;
    const s = room.storage ? room.storage.store[resource] || 0 : 0;
    return s + t;
  },

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

  // ── SELL PREP ─────────────────────────────────────────────────────────────

  /**
   * Подготовка ресурсов к продаже: storage → terminal.
   *
   * Алгоритм:
   * 1. Читаем sell intents из marketManager
   * 2. Для каждого intent ищем комнату с ресурсом в storage
   * 3. Если в терминале этой комнаты < SELL_TERMINAL_TARGET
   *    → addNeed() чтобы terminalUnloader перенёс из storage в terminal
   *
   * Вызывается только из первой комнаты (глобальный балансировщик).
   */
  runSellPrep: function () {
    if (Game.time % 100 !== 0) return;

    const sellIntents = marketManager.getSellIntents();
    if (sellIntents.length === 0) return;

    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.storage && r.terminal,
    );

    for (const intent of sellIntents) {
      const resource = intent.resource;

      // Ищем комнату где ресурс есть в storage но мало в терминале
      for (const room of ourRooms) {
        const inStorage = room.storage.store[resource] || 0;
        const inTerminal = room.terminal.store[resource] || 0;

        // В терминале уже достаточно — пропускаем
        if (inTerminal >= SELL_TERMINAL_TARGET) continue;

        // В storage нет — пропускаем
        if (inStorage < 100) continue;

        // Сколько нужно добавить в терминал
        const needed = Math.min(
          SELL_TERMINAL_TARGET - inTerminal,
          inStorage,
          SELL_TERMINAL_MAX,
        );

        if (needed < 100) continue;

        // Запрашиваем перенос: storage → terminal (toRoom = null = локально)
        const isNew = this.addNeed(room, resource, needed, null);

        if (isNew) {
          console.log(
            `[SellPrep] 📦 ${room.name}: запрос ${needed}` +
              ` ${resource} storage→terminal для продажи`,
          );
        }

        // Одна комната на один ресурс — берём первую подходящую
        break;
      }
    }
  },

  // ── ENERGY BALANCE ────────────────────────────────────────────────────────

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
          `[EnergyBalance] ✅ ${donor.name} → ${poorRoom.name}: ${ENERGY_SEND_AMOUNT} energy`,
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

  // ── LAB SUPPLY ────────────────────────────────────────────────────────────

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

  // ── ОСНОВНОЙ ЗАПУСК ───────────────────────────────────────────────────────

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
      this.runSellPrep(); // v4.1: подготовка ресурсов к продаже
      resourceBalancer.run();
    }

    // ── ШАГ 2: ЛОГИСТИКА ЛАБ ─────────────────────────────────────────────────
    if (roomOffsets[room.name] === undefined) {
      const count = Object.keys(roomOffsets).length;
      const step = Math.floor(CHECK_INTERVAL / 5);
      roomOffsets[room.name] = count * step;
    }
    this.runLabSupply(room);
  },
};

module.exports = terminalManager;
