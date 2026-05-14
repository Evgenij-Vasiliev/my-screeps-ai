/**
 * ===================================================
 * TERMINALMANAGER.JS — Автопродажа + Логистика лаб + Балансировка энергии
 * ===================================================
 * Запускается из roomManager каждый тик, но реально
 * работает раз в 50 тиков — каждая комната в свой тик.
 *
 * БАЛАНСИРОВКА ЭНЕРГИИ:
 * Если в комнате мало энергии (<20 000 в storage) —
 * богатая комната (>100 000 в storage) отправляет ей
 * энергию через терминал автоматически.
 *
 * ЛОГИСТИКА РЕАГЕНТОВ (раз в 100 тиков):
 * Перебирает ВСЕ тройки лаб (labs, labs2, labs3...)
 * в каждой комнате и проверяет запас реагентов.
 *
 * ПРОДАЖА ЭНЕРГИИ:
 * Продаём излишек энергии сверх STORAGE_ENERGY_BUFFER.
 * НО только если нет бедных комнат — сначала помогаем своим.
 *
 * ИСПРАВЛЕНО v5:
 * - runEnergyBalance и runLabSupply вынесены ДО проверки tradeEnabled.
 *   Раньше Memory.tradeEnabled = false останавливал весь run() целиком,
 *   включая балансировку энергии и логистику лаб — они переставали работать.
 *   Теперь флаг tradeEnabled управляет ТОЛЬКО продажей на рынке.
 *
 * Управление через консоль:
 *   Memory.tradeEnabled = false  — остановить ТОЛЬКО торговлю на рынке
 *   Memory.tradeEnabled = true   — возобновить торговлю
 * ===================================================
 */

const STORAGE_ENERGY_BUFFER = 50000; // Минимум для продажи излишков
const TERMINAL_ENERGY_MIN = 20000; // Минимум энергии в терминале для операций

// ── БАЛАНСИРОВКА ЭНЕРГИИ ──────────────────────────────────────────────────
const ENERGY_POOR_THRESHOLD = 20000; // Меньше этого — комната "бедная"
const ENERGY_RICH_THRESHOLD = 100000; // Больше этого — комната "богатая"
const ENERGY_SEND_AMOUNT = 20000; // Сколько энергии отправляем за раз

// ── ЛОГИСТИКА ЛАБ ─────────────────────────────────────────────────────────
const CHECK_INTERVAL = 50;
const MIN_DEAL_AMOUNT = 100;
const LAB_REAGENT_MIN = 3000;
const LAB_REAGENT_SEND = 5000;
const LAB_REAGENT_DONOR_MIN = 6000;

let roomOffsets = {};

const terminalManager = {
  /**
   * Возвращает список всех активных конфигов лаб в комнате.
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
   * Считает суммарный запас ресурса в комнате (терминал + storage).
   */
  getTotal: function (room, resource) {
    const t = room.terminal ? room.terminal.store[resource] || 0 : 0;
    const s = room.storage ? room.storage.store[resource] || 0 : 0;
    return t + s;
  },

  /**
   * Добавляет запрос в очередь terminalNeeds донора.
   * Не дублирует если запрос на этот ресурс уже есть.
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
   * Раз в 100 тиков. Запускается глобально один раз (из первой комнаты).
   * Работает ВСЕГДА — независимо от tradeEnabled.
   */
  runEnergyBalance: function () {
    if (Game.time % 100 !== 0) return;

    // Все наши комнаты с терминалом и storage
    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    // Бедные (мало энергии в storage) и богатые (много энергии в storage)
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
      // Ищем донора у которого достаточно энергии в терминале для отправки
      const donor = richRooms.find(
        r =>
          r.name !== poorRoom.name &&
          (r.terminal.store[RESOURCE_ENERGY] || 0) >=
            ENERGY_SEND_AMOUNT + TERMINAL_ENERGY_MIN,
      );

      if (!donor) {
        // Энергии в терминале нет — просим terminalUnloader перенести из storage
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

      // Считаем стоимость транзакции
      const txCost = Game.market.calcTransactionCost(
        ENERGY_SEND_AMOUNT,
        donor.name,
        poorRoom.name,
      );
      const donorTerminalEnergy = donor.terminal.store[RESOURCE_ENERGY] || 0;

      // Проверяем что после транзакции в терминале донора останется минимум
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

      // Отправляем энергию
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
        // Убираем запрос если был
        if (donor.memory.terminalNeeds) {
          donor.memory.terminalNeeds = donor.memory.terminalNeeds.filter(
            n =>
              !(n.resource === RESOURCE_ENERGY && n.toRoom === poorRoom.name),
          );
        }
        // Терминал донора теперь на кулдауне — убираем из списка
        richRooms.splice(richRooms.indexOf(donor), 1);
      } else {
        console.log(`[EnergyBalance] ❌ Ошибка отправки energy: ${result}`);
      }
    }
  },

  /**
   * ── АВТОЛОГИСТИКА РЕАГЕНТОВ ──────────────────────────────────────────────
   * Проверяет ВСЕ тройки лаб в комнате раз в CHECK_INTERVAL тиков.
   * Использует roomOffsets — каждая комната в свой тик, равномерно.
   * Работает ВСЕГДА — независимо от tradeEnabled.
   *
   * ИСПРАВЛЕНО v6: убрана жёсткая привязка к Game.time % 100.
   * Раньше функция работала только в один конкретный тик из 100 —
   * ручной вызов из консоли никогда не попадал в нужный тик,
   * а при загруженном сервере тик мог быть пропущен.
   * Теперь каждая комната проверяется в свой offset-тик равномерно.
   */
  runLabSupply: function (room) {
    // Проверяем через roomOffsets — каждая комната в свой тик
    if ((Game.time + (roomOffsets[room.name] || 0)) % CHECK_INTERVAL !== 0)
      return;

    const terminal = room.terminal;
    if (!terminal) return;
    if (terminal.cooldown > 0) return;

    const availableEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (availableEnergy < TERMINAL_ENERGY_MIN) return;

    const labConfigs = this.getLabConfigs(room);
    if (labConfigs.length === 0) return;

    // Собираем какие реагенты заканчиваются
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

      // Одна отправка за тик
      return;
    }
  },

  /**
   * ── ОСНОВНОЙ ЗАПУСК ───────────────────────────────────────────────────────
   * ВАЖНО: балансировка и логистика лаб запускаются ДО проверки tradeEnabled,
   * чтобы они работали всегда — даже когда торговля приостановлена.
   */
  run: function (room) {
    // ── ШАГ 1: БАЛАНСИРОВКА ЭНЕРГИИ — всегда, независимо от tradeEnabled ──
    // Запускаем глобально один раз — из комнаты с именем первым по алфавиту.
    const roomNames = Object.keys(Game.rooms)
      .filter(n => {
        const r = Game.rooms[n];
        return r.controller && r.controller.my;
      })
      .sort();
    if (roomNames[0] === room.name) {
      this.runEnergyBalance();
    }

    // ── ШАГ 2: ЛОГИСТИКА ЛАБ — всегда, независимо от tradeEnabled ──────────
    if (roomOffsets[room.name] === undefined) {
      const count = Object.keys(roomOffsets).length;
      const step = Math.floor(CHECK_INTERVAL / 5);
      roomOffsets[room.name] = count * step;
    }
    this.runLabSupply(room);

    // ── ШАГ 3: ПРОДАЖА — только если торговля включена ──────────────────────
    // Memory.tradeEnabled = false  → выходим здесь, продажи нет
    // Memory.tradeEnabled = true   → продолжаем
    if (Memory.tradeEnabled === false) return;

    if ((Game.time + roomOffsets[room.name]) % CHECK_INTERVAL !== 0) return;

    const terminal = room.terminal;
    const storage = room.storage;

    if (!terminal || !storage) return;
    if (terminal.cooldown > 0) return;

    const availableEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (availableEnergy < TERMINAL_ENERGY_MIN) return;

    // Не продаём если есть бедные комнаты — сначала помогаем своим
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
