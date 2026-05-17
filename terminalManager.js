/**
 * ===================================================
 * TERMINALMANAGER.JS — Автопродажа + Логистика лаб + Балансировка энергии
 * ===================================================
 * ИСПРАВЛЕНО v3:
 * - runMineralNeeds() выделен отдельно от runMineralSell().
 *   Запрос на перенос минерала в терминал создаётся каждые 10 тиков
 *   независимо от интервала торговли (50 тиков).
 *   Раньше addNeed("_sell_") вызывался только внутри runMineralSell()
 *   который привязан к 50-тиковому интервалу — запрос мог не создаться
 *   если terminalUnloader не был заспавнен в нужный тик.
 * ===================================================
 */

const resourceBalancer = require("./resourceBalancer");

const STORAGE_ENERGY_BUFFER = 50000;
const TERMINAL_ENERGY_MIN = 20000;

const ENERGY_POOR_THRESHOLD = 20000;
const ENERGY_RICH_THRESHOLD = 100000;
const ENERGY_SEND_AMOUNT = 20000;

const CHECK_INTERVAL = 50;
const MIN_DEAL_AMOUNT = 100;
const LAB_REAGENT_MIN = 3000;
const LAB_REAGENT_SEND = 5000;
const LAB_REAGENT_DONOR_MIN = 6000;

const SELL_MINERALS = {
  K: 20000,
  U: 20000,
  L: 20000,
  H: 20000,
};

const MINERAL_SELL_AMOUNT = 5000;

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
    return t + s;
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

  /**
   * ── ПОДГОТОВКА МИНЕРАЛОВ К ПРОДАЖЕ ───────────────────────────────────────
   * Запускается каждые 10 тиков — независимо от интервала торговли.
   * Создаёт запрос terminalNeeds если минерала мало в терминале
   * но много в storage — terminalUnloader перенесёт.
   *
   * Это исправляет баг: раньше addNeed("_sell_") был внутри runMineralSell()
   * который работает раз в 50 тиков и только если терминал не на cooldown.
   * Из-за этого запрос мог не создаться и K так и оставался в storage.
   */
  runMineralNeeds: function (room) {
    if (Game.time % 10 !== 0) return;

    const terminal = room.terminal;
    const storage = room.storage;
    if (!terminal || !storage) return;

    for (const resource in SELL_MINERALS) {
      const reserve = SELL_MINERALS[resource];
      const totalInRoom = this.getTotal(room, resource);

      // Нет излишков — пропускаем
      if (totalInRoom <= reserve) continue;

      const inTerminal = terminal.store[resource] || 0;

      // В терминале уже достаточно — не нужен перенос
      if (inTerminal >= MINERAL_SELL_AMOUNT) continue;

      const needed = MINERAL_SELL_AMOUNT - inTerminal;
      const inStorage = storage.store[resource] || 0;

      if (inStorage > 0) {
        const isNew = this.addNeed(
          room,
          resource,
          Math.min(needed, inStorage),
          "_sell_",
        );
        if (isNew) {
          console.log(
            `[MineralNeeds ${room.name}] 📦 Запрос: перенести ${Math.min(
              needed,
              inStorage,
            )} ${resource} в терминал для продажи`,
          );
        }
      }
    }
  },

  /**
   * ── БАЛАНСИРОВКА ЭНЕРГИИ МЕЖДУ КОМНАТАМИ ─────────────────────────────────
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
                `${ENERGY_SEND_AMOUNT} energy → ${poorRoom.name} ` +
                `(в storage донора: ${richWithStorage.storage.store[RESOURCE_ENERGY]})`,
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
            `для транзакции (нужно: ${
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
            `${ENERGY_SEND_AMOUNT} energy ` +
            `(бедный: ${poorRoom.storage.store[RESOURCE_ENERGY]}, ` +
            `богатый: ${donor.storage.store[RESOURCE_ENERGY]})`,
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
            `[LabSupply] 📦 ${donorRoom.name}: добавлен запрос ${donorAmount} ${resource} → ${room.name}`,
          );
        } else {
          console.log(
            `[LabSupply] ⏳ ${donorRoom.name}: ждём переноса ${resource} в терминал (есть: ${donorInTerminal})`,
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
          `[LabSupply] ⚡ ${donorRoom.name}: мало энергии для транзакции ` +
            `(нужно: ${txCost}, есть: ${donorEnergy})`,
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
   * ── ПРОДАЖА МИНЕРАЛОВ ────────────────────────────────────────────────────
   * Продаём K, U, L, H сверх резерва.
   * Запрос на перенос создаётся в runMineralNeeds() — отдельно.
   */
  runMineralSell: function (room) {
    const terminal = room.terminal;
    const storage = room.storage;
    if (!terminal || !storage) return;
    if (terminal.cooldown > 0) return;

    const availableEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (availableEnergy < TERMINAL_ENERGY_MIN) return;

    for (const resource in SELL_MINERALS) {
      const reserve = SELL_MINERALS[resource];
      const totalInRoom = this.getTotal(room, resource);

      if (totalInRoom <= reserve) continue;

      const inTerminal = terminal.store[resource] || 0;

      // Мало в терминале — запрос уже создан в runMineralNeeds(), ждём переноса
      if (inTerminal < MINERAL_SELL_AMOUNT) continue;

      const sellAmount = Math.min(MINERAL_SELL_AMOUNT, inTerminal);

      const orders = Game.market
        .getAllOrders({ resourceType: resource })
        .filter(
          o => o.type === ORDER_BUY && o.remainingAmount >= MIN_DEAL_AMOUNT,
        )
        .sort((a, b) => b.price - a.price);

      if (orders.length === 0) continue;

      for (const order of orders.slice(0, 5)) {
        let dealAmount = Math.min(sellAmount, order.remainingAmount);

        while (dealAmount >= MIN_DEAL_AMOUNT) {
          const txCost = Game.market.calcTransactionCost(
            dealAmount,
            room.name,
            order.roomName,
          );

          if (txCost <= availableEnergy - TERMINAL_ENERGY_MIN) {
            const result = Game.market.deal(order.id, dealAmount, room.name);
            if (result === OK) {
              console.log(
                `[Terminal ${room.name}] ✅ Продано ${dealAmount} ${resource} ` +
                  `по ${order.price} → ${order.roomName}`,
              );
              if (room.memory.terminalNeeds) {
                room.memory.terminalNeeds = room.memory.terminalNeeds.filter(
                  n => !(n.resource === resource && n.toRoom === "_sell_"),
                );
              }
            } else {
              console.log(
                `[Terminal ${room.name}] ❌ Ошибка сделки ${resource}: ${result}`,
              );
            }
            return;
          }

          dealAmount = Math.floor(dealAmount / 2);
        }
      }
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

    // ── ШАГ 2: ПОДГОТОВКА МИНЕРАЛОВ К ПРОДАЖЕ (каждые 10 тиков) ────────────
    // Создаёт запросы terminalNeeds для переноса минералов в терминал.
    // Работает независимо от интервала торговли.
    this.runMineralNeeds(room);

    // ── ШАГ 3: ЛОГИСТИКА ЛАБ ────────────────────────────────────────────────
    if (roomOffsets[room.name] === undefined) {
      const count = Object.keys(roomOffsets).length;
      const step = Math.floor(CHECK_INTERVAL / 5);
      roomOffsets[room.name] = count * step;
    }
    this.runLabSupply(room);

    // ── ШАГ 4: ТОРГОВЛЯ — только если включена ───────────────────────────────
    if (Memory.tradeEnabled === false) return;

    if ((Game.time + roomOffsets[room.name]) % CHECK_INTERVAL !== 0) return;

    const terminal = room.terminal;
    const storage = room.storage;
    if (!terminal || !storage) return;
    if (terminal.cooldown > 0) return;

    const availableEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (availableEnergy < TERMINAL_ENERGY_MIN) return;

    // ── ШАГ 4а: ПРОДАЖА МИНЕРАЛОВ ───────────────────────────────────────────
    this.runMineralSell(room);

    // ── ШАГ 4б: ПРОДАЖА ЭНЕРГИИ ─────────────────────────────────────────────
    const hasPoorRooms = Object.values(Game.rooms).some(
      r =>
        r.controller &&
        r.controller.my &&
        r.storage &&
        (r.storage.store[RESOURCE_ENERGY] || 0) < ENERGY_POOR_THRESHOLD,
    );
    if (hasPoorRooms) return;

    const storageEnergy = storage.store[RESOURCE_ENERGY] || 0;
    const terminalEnergy = terminal.store[RESOURCE_ENERGY] || 0;

    if (storageEnergy <= STORAGE_ENERGY_BUFFER) return;

    const sellAmount = terminalEnergy - TERMINAL_ENERGY_MIN;
    if (sellAmount < MIN_DEAL_AMOUNT) return;

    const orders = Game.market
      .getAllOrders({ resourceType: RESOURCE_ENERGY })
      .filter(o => o.type === ORDER_BUY && o.remainingAmount >= MIN_DEAL_AMOUNT)
      .sort((a, b) => b.price - a.price);

    if (orders.length === 0) {
      console.log(`[Terminal ${room.name}] Нет покупателей для energy`);
      return;
    }

    for (const order of orders.slice(0, 10)) {
      let dealAmount = Math.min(sellAmount, order.remainingAmount);

      while (dealAmount >= MIN_DEAL_AMOUNT) {
        const txCost = Game.market.calcTransactionCost(
          dealAmount,
          room.name,
          order.roomName,
        );

        if (txCost <= availableEnergy - TERMINAL_ENERGY_MIN) {
          const result = Game.market.deal(order.id, dealAmount, room.name);
          if (result === OK) {
            console.log(
              `[Terminal ${room.name}] Продано ${dealAmount} energy ` +
                `по ${order.price} → ${order.roomName} ` +
                `(транзакция: ${txCost} энергии)`,
            );
          } else {
            console.log(
              `[Terminal ${room.name}] Ошибка сделки energy: ${result}`,
            );
          }
          return;
        }

        dealAmount = Math.floor(dealAmount / 2);
      }
    }

    console.log(
      `[Terminal ${room.name}] Нет подходящих ордеров (мало энергии на транзакцию)`,
    );
  },
};

module.exports = terminalManager;
