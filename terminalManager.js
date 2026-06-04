/**
 * ===================================================
 * TERMINALMANAGER.JS — Terminal Infrastructure Layer
 * ===================================================
 * VERSION: 4.5
 *
 * ИЗМЕНЕНИЯ v4.5 (ТЗ №19):
 * - ИСПРАВЛЕН архитектурный дефект в runLabSupply():
 *   ранее terminal.cooldown > 0 блокировал не только отправку,
 *   но и весь анализ потребностей + создание addNeed().
 *
 *   РЕШЕНИЕ: cooldown проверяется теперь только в момент
 *   фактической отправки (terminal.send). Анализ needs,
 *   поиск доноров и создание addNeed() выполняются всегда.
 *
 *   Эффект: при cooldown терминала terminalNeeds продолжает
 *   пополняться → terminalUnloader начинает перенос из storage
 *   → terminal.send() выполнится как только cooldown спадёт.
 *
 * ИЗМЕНЕНИЯ v4.4 (ТЗ №14):
 * - CHECK_INTERVAL снижен с 50 до 10.
 * - Убран return после terminal.send() в runLabSupply().
 *
 * ИСПРАВЛЕНИЕ v4.2:
 * - ГЛАВНЫЙ БАГ: терминалы забивались до 300к энергией.
 *   Причина: runEnergyBalance() создавал addNeed() без проверки
 *   насколько полон терминал получателя.
 *   РЕШЕНИЕ: добавлена константа TERMINAL_ENERGY_MAX=100000
 *   и проверка терминала получателя перед addNeed().
 *
 * ИЗМЕНЕНИЯ v4.1:
 * - Добавлен runSellPrep() — подготовка ресурсов к продаже.
 *
 * ИЗМЕНЕНИЯ v4.0:
 * - Удалён runMineralSell() — ownership передан MarketExecutor
 * ===================================================
 */

const resourceBalancer = require("./resourceBalancer");
const marketManager = require("./marketManager");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const TERMINAL_ENERGY_MIN = 20000;
// v4.2: максимум энергии в терминале — не накапливаем сверх этого
const TERMINAL_ENERGY_MAX = 100000;
const ENERGY_POOR_THRESHOLD = 20000;
const ENERGY_RICH_THRESHOLD = 100000;
const ENERGY_SEND_AMOUNT = 20000;
// v4.4: снижено с 50 до 10 — ускоряет реакцию на нехватку реагентов
const CHECK_INTERVAL = 10;
const LAB_REAGENT_MIN = 3000;
const LAB_REAGENT_SEND = 5000;
// v4.5 (ТЗ №21): поднято с 2000 до 3500.
// Причина: при 2000 донор после отправки имел 2000 < LAB_REAGENT_MIN(3000)
// и сам становился получателем → пинг-понг между комнатами.
// 3500 > 3000 гарантирует что донор после отправки не попадает в дефицит.
const LAB_REAGENT_DONOR_MIN = 3500;

/**
 * Сколько держим в терминале для продажи.
 */
const SELL_TERMINAL_TARGET = 10000;

/**
 * Максимум в терминале для продажи.
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

  runSellPrep: function () {
    if (Game.time % 100 !== 0) return;

    const sellIntents = marketManager.getSellIntents();
    if (sellIntents.length === 0) return;

    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.storage && r.terminal,
    );

    for (const intent of sellIntents) {
      const resource = intent.resource;

      for (const room of ourRooms) {
        const inStorage = room.storage.store[resource] || 0;
        const inTerminal = room.terminal.store[resource] || 0;

        if (inTerminal >= SELL_TERMINAL_TARGET) continue;
        if (inStorage < 100) continue;

        const needed = Math.min(
          SELL_TERMINAL_TARGET - inTerminal,
          inStorage,
          SELL_TERMINAL_MAX,
        );

        if (needed < 100) continue;

        const isNew = this.addNeed(room, resource, needed, null);

        if (isNew) {
          console.log(
            `[SellPrep] 📦 ${room.name}: запрос ${needed}` +
              ` ${resource} storage→terminal для продажи`,
          );
        }

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
      // v4.2: не отправляем если терминал получателя уже заполнен
      const terminalEnergy = poorRoom.terminal.store[RESOURCE_ENERGY] || 0;
      if (terminalEnergy >= TERMINAL_ENERGY_MAX) {
        console.log(
          `[EnergyBalance] ⏭️  ${poorRoom.name}: терминал уже ${terminalEnergy} — пропускаем`,
        );
        continue;
      }

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

  /**
   * v4.5: ИСПРАВЛЕНИЕ COOLDOWN
   *
   * Разделены две ответственности:
   * 1. Анализ потребностей + создание addNeed() — выполняется ВСЕГДА
   * 2. terminal.send() — выполняется ТОЛЬКО если нет cooldown
   *
   * Ранее: if (terminal.cooldown > 0) return
   * → весь анализ прерывался, addNeed() не создавался,
   *   terminalUnloader не получал задач, цепочка замирала.
   *
   * Теперь: cooldown проверяется только перед terminal.send().
   * При cooldown: addNeed() создаётся → terminalUnloader
   * переносит ресурс из storage в terminal → send() выполнится
   * как только cooldown спадёт.
   */
  runLabSupply: function (room) {
    if ((Game.time + (roomOffsets[room.name] || 0)) % CHECK_INTERVAL !== 0)
      return;

    const terminal = room.terminal;
    if (!terminal) return;

    // v4.5: УБРАНА ПРОВЕРКА terminal.cooldown ЗДЕСЬ.
    // Cooldown проверяется только перед terminal.send() (см. ниже).
    // Анализ потребностей выполняется независимо от cooldown.

    const availableEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (availableEnergy < TERMINAL_ENERGY_MIN) return;

    const labConfigs = this.getLabConfigs(room);
    if (labConfigs.length === 0) return;

    // ── ШАГ 1: АНАЛИЗ ПОТРЕБНОСТЕЙ ────────────────────────────────────────
    // Выполняется ВСЕГДА — независимо от cooldown терминала.
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

    // ── ШАГ 2: ОБРАБОТКА КАЖДОЙ ПОТРЕБНОСТИ ───────────────────────────────
    // Поиск донора и создание addNeed() — тоже ВСЕГДА.
    // terminal.send() — только при отсутствии cooldown.
    for (const { resource, total } of needs) {
      // console.log(
      //   `[LabSupply ${room.name}] Мало ${resource}: ${total} — ищем донора`,
      // );

      // ── ПОИСК ДОНОРА ───────────────────────────────────────────────────
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
        // console.log(
        //   `[LabSupply ${room.name}] Нет донора для ${resource} — нужно купить`,
        // );
        continue;
      }

      // ── ПРОВЕРКА: НУЖЕН ПЕРЕНОС storage → terminal У ДОНОРА? ──────────
      const donorInTerminal = donorRoom.terminal.store[resource] || 0;

      if (donorInTerminal < donorAmount) {
        // Ресурс есть у донора, но в storage, не в terminal.
        // Создаём addNeed() — terminalUnloader перенесёт.
        // Это выполняется ВСЕГДА, даже при cooldown терминала цели.
        const isNew = this.addNeed(donorRoom, resource, donorAmount, room.name);
        if (isNew) {
          // console.log(
          //   `[LabSupply] 📦 ${donorRoom.name}: запрос ${donorAmount} ${resource} → ${room.name}`,
          // );
        } else {
          // console.log(
          //   `[LabSupply] ⏳ ${donorRoom.name}: ждём переноса ${resource} (есть: ${donorInTerminal})`,
          // );
        }
        continue;
      }

      // ── ПРОВЕРКА COOLDOWN ДОНОРА ───────────────────────────────────────
      // v4.5: cooldown проверяется ТОЛЬКО здесь — перед фактической отправкой.
      // Если донор на cooldown — пропускаем только send(),
      // но addNeed() выше уже создан → цепочка не замирает.
      if (donorRoom.terminal.cooldown > 0) {
        // console.log(
        //   `[LabSupply] ⏳ ${donorRoom.name}: терминал на кулдауне (${donorRoom.terminal.cooldown})`,
        // );
        continue;
      }

      // ── ПРОВЕРКА ЭНЕРГИИ ДЛЯ ОТПРАВКИ ────────────────────────────────
      const txCost = Game.market.calcTransactionCost(
        donorAmount,
        donorRoom.name,
        room.name,
      );
      const donorEnergy = donorRoom.terminal.store[RESOURCE_ENERGY] || 0;

      if (txCost > donorEnergy - TERMINAL_ENERGY_MIN) {
        // console.log(
        //   `[LabSupply] ⚡ ${donorRoom.name}: мало энергии (нужно: ${txCost}, есть: ${donorEnergy})`,
        // );
        continue;
      }

      // ── ОТПРАВКА ──────────────────────────────────────────────────────
      const result = donorRoom.terminal.send(resource, donorAmount, room.name);
      if (result === OK) {
        // Очищаем выполненную потребность из terminalNeeds донора
        if (donorRoom.memory.terminalNeeds) {
          donorRoom.memory.terminalNeeds =
            donorRoom.memory.terminalNeeds.filter(
              n => !(n.resource === resource && n.toRoom === room.name),
            );
        }
        // console.log(
        //   `[LabSupply] ✅ ${donorRoom.name} → ${room.name}: ${donorAmount} ${resource}`,
        // );
      } else {
        // v4.4: не прерываем цикл — продолжаем следующий ресурс
        // console.log(`[LabSupply] ❌ Ошибка отправки ${resource}: ${result}`);
      }
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
      this.runSellPrep();
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
