/**
 * ===================================================
 * CONSOLE.JS — Модуль управления через консоль игры
 * ===================================================
 * Как использовать — всё пишется ОДНОЙ СТРОКОЙ:
 *
 *   require("console").help()
 *   require("console").stats()
 *   require("console").sell("K", 100000, 5.0)
 *   require("console").sell("K", 100000, 5.0, true)
 *
 * Совет: нажимай ↑ в консоли чтобы повторить команду
 * ===================================================
 */

const cmd = {
  /**
   * help — список всех команд
   * Использование: require("console").help()
   */
  help() {
    console.log("========== КОМАНДЫ УПРАВЛЕНИЯ ==========");
    console.log('require("console").help()');
    console.log("  — эта справка");
    console.log('require("console").stats()');
    console.log("  — сводка по всем комнатам");
    console.log('require("console").prices("L")');
    console.log("  — цены на ресурс на рынке");
    console.log('require("console").sell("L", 100000, 5.0)');
    console.log("  — показать план продажи (ничего не создаёт)");
    console.log('require("console").sell("L", 100000, 5.0, true)');
    console.log("  — создать ордер на продажу (с подтверждением!)");
    console.log('require("console").cancelOrders("L")');
    console.log("  — отменить все ордера на ресурс");
    console.log('require("console").cancelOrders()');
    console.log("  — отменить ВСЕ ордера");
    console.log('require("console").orders()');
    console.log("  — показать активные ордера");
    console.log('require("console").setTerminalTarget("E37S37", 20000)');
    console.log("  — задать лимит энергии в терминале комнаты");
    console.log('require("console").setWallThreshold("E37S37", 100000)');
    console.log("  — задать порог HP стен для башен");
    console.log('require("console").setSource("test_miner_12345", 1)');
    console.log("  — сменить источник энергии для крипа");
    console.log('require("console").killRole("test_hauler")');
    console.log("  — убить всех крипов роли (для обновления тел)");
    console.log('require("console").killCreep("test_miner_12345")');
    console.log("  — убить одного крипа");
    console.log('require("console").setAttackTarget("E35S39")');
    console.log("  — направить всех атакеров в комнату");
    console.log('require("console").clearAttackTarget()');
    console.log("  — снять боевой приказ, вернуть патруль");
    console.log('require("console").setReserveRooms(["E35S38","E36S37"])');
    console.log("  — задать комнаты для резервистов");
    console.log('require("console").memory("E37S37")');
    console.log("  — показать память комнаты (отладка)");
    console.log('require("console").resetMemory("E37S37")');
    console.log("  — сбросить кэш комнаты");
    console.log("=========================================");
  },

  /**
   * stats — сводка по всем комнатам
   * Использование: require("console").stats()
   */
  stats() {
    console.log("========== СВОДКА ПО КОМНАТАМ ==========");

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      const rcl = room.controller.level;
      const needed = room.controller.progressTotal;
      const pct =
        needed > 0
          ? ((room.controller.progress / needed) * 100).toFixed(1)
          : "MAX";

      const storage = room.storage
        ? room.storage.store[RESOURCE_ENERGY].toLocaleString()
        : "нет";

      const terminal = room.terminal
        ? room.terminal.store[RESOURCE_ENERGY].toLocaleString()
        : "нет";

      const creepCount = room.find(FIND_MY_CREEPS).length;
      const spawning =
        room
          .find(FIND_MY_SPAWNS)
          .filter(s => s.spawning)
          .map(s => s.spawning.name)
          .join(", ") || "—";

      console.log(`--- ${roomName} ---`);
      console.log(`  RCL: ${rcl} | Прогресс: ${pct}%`);
      console.log(`  Storage: ${storage} | Terminal: ${terminal}`);
      console.log(`  Крипов: ${creepCount} | Спавнит: ${spawning}`);

      if (room.terminal) {
        const minerals = Object.entries(room.terminal.store)
          .filter(([r, amt]) => r !== RESOURCE_ENERGY && amt > 0)
          .map(([r, amt]) => `${r}:${amt.toLocaleString()}`)
          .join(", ");
        if (minerals) console.log(`  Минералы: ${minerals}`);
      }
    }

    // Крипы по ролям
    const byRole = {};
    for (const name in Game.creeps) {
      const role = Game.creeps[name].memory.role || "unknown";
      byRole[role] = (byRole[role] || 0) + 1;
    }
    console.log("--- Крипы по ролям ---");
    for (const [role, count] of Object.entries(byRole).sort()) {
      console.log(`  ${role.padEnd(25)} x${count}`);
    }
    console.log(`  ИТОГО: ${Object.keys(Game.creeps).length}`);

    // CPU
    console.log("--- CPU ---");
    console.log(`  Лимит: ${Game.cpu.limit} | Bucket: ${Game.cpu.bucket}`);
    if (Memory.cpuStats) {
      console.log(
        `  Среднее за 100 тиков: ${Memory.cpuStats.average.toFixed(2)}`,
      );
    }
    console.log("=========================================");
  },

  /**
   * prices — показать цены покупки на рынке для ресурса
   * Помогает выбрать правильную цену перед продажей.
   *
   * Использование: require("console").prices("L")
   *
   * @param {string} resource — тип ресурса ("L", "K", "H" и т.д.)
   */
  prices(resource) {
    // Берём все ордера на ПОКУПКУ этого ресурса
    const orders = Game.market.getAllOrders({
      type: ORDER_BUY,
      resourceType: resource,
    });

    if (!orders || orders.length === 0) {
      console.log(`[prices] Нет ордеров на покупку ${resource}`);
      return;
    }

    // Сортируем по цене — самые выгодные (дорогие) сверху
    orders.sort((a, b) => b.price - a.price);

    // Показываем топ-10
    const top = orders.slice(0, 10);
    console.log(`[prices] Топ-10 ордеров на ПОКУПКУ ${resource}:`);
    console.log(`  Цена   | Количество      | Комната`);
    console.log(`  -------+-----------------+--------`);
    top.forEach(o => {
      const price = String(o.price.toFixed(3)).padEnd(7);
      const amount = String(o.amount.toLocaleString()).padEnd(16);
      console.log(`  ${price}| ${amount}| ${o.roomName || "межсерверный"}`);
    });

    // Подсказка: лучшая цена
    const best = top[0];
    console.log(`[prices] Лучшая цена покупки: ${best.price.toFixed(3)}`);
    console.log(
      `[prices] Рекомендуем продавать по: ${(best.price * 0.95).toFixed(
        3,
      )} (чуть ниже лучшей)`,
    );
    console.log(
      `[prices] Команда: require("console").sell("${resource}", КОЛИЧЕСТВО, ${(
        best.price * 0.95
      ).toFixed(3)})`,
    );
  },

  /**
   * sell — безопасная продажа ресурса
   *
   * ЗАЩИТА: сначала показывает план, создаёт ордер только с confirm=true
   *
   * Использование:
   *   require("console").sell("L", 100000, 5.0)        — план
   *   require("console").sell("L", 100000, 5.0, true)   — создать
   *
   * @param {string}  resource  — тип ресурса
   * @param {number}  amount    — количество
   * @param {number}  price     — цена за единицу
   * @param {boolean} confirm   — true чтобы реально создать ордер
   * @param {string}  roomName  — комната (по умолчанию — где есть ресурс)
   */
  sell(resource, amount, price, confirm = false, roomName = null) {
    // Находим комнату с ресурсом
    let room = null;
    if (roomName) {
      room = Game.rooms[roomName];
    } else {
      for (const rn in Game.rooms) {
        const r = Game.rooms[rn];
        if (r.terminal && r.terminal.store[resource] > 0) {
          room = r;
          break;
        }
      }
    }

    if (!room || !room.terminal) {
      console.log(
        `[sell] ОШИБКА: не найдена комната с терминалом и ресурсом ${resource}`,
      );
      return;
    }

    const available = room.terminal.store[resource] || 0;

    // Проверяем существующие ордера
    const existingOrders = Object.values(Game.market.orders).filter(
      o => o.resourceType === resource && o.type === ORDER_SELL && o.active,
    );

    if (existingOrders.length > 0) {
      console.log(
        `[sell] ВНИМАНИЕ: уже есть ${existingOrders.length} активных ордеров на ${resource}:`,
      );
      existingOrders.forEach(o => {
        console.log(
          `  ID: ${o.id} | Цена: ${
            o.price
          } | Осталось: ${o.remainingAmount.toLocaleString()}`,
        );
      });
      console.log(
        `  Сначала отмени: require("console").cancelOrders("${resource}")`,
      );
      return;
    }

    // Показываем план
    console.log(`[sell] ПЛАН ПРОДАЖИ:`);
    console.log(`  Ресурс:   ${resource}`);
    console.log(`  Комната:  ${room.name}`);
    console.log(`  В терминале: ${available.toLocaleString()}`);
    console.log(`  Продаём:  ${amount.toLocaleString()} по цене ${price}`);
    console.log(`  Выручка:  ~${(amount * price).toLocaleString()} кредитов`);
    console.log(`  Налог:    ${(amount * 0.05).toFixed(0)} кредитов (5%)`);
    console.log(`  Баланс:   ${Game.market.credits.toFixed(2)} кредитов`);

    if (!confirm) {
      console.log(
        `  Для создания: require("console").sell("${resource}", ${amount}, ${price}, true)`,
      );
      return;
    }

    const result = Game.market.createOrder({
      type: ORDER_SELL,
      resourceType: resource,
      price: price,
      totalAmount: amount,
      roomName: room.name,
    });

    console.log(
      result === OK ? `[sell] ✅ Ордер создан!` : `[sell] ❌ Ошибка: ${result}`,
    );
  },

  /**
   * cancelOrders — отменить ордера на ресурс
   * Использование: require("console").cancelOrders("L")
   *                require("console").cancelOrders()  — все ордера
   */
  cancelOrders(resource = null) {
    const orders = Object.values(Game.market.orders).filter(o =>
      resource ? o.resourceType === resource : true,
    );

    if (orders.length === 0) {
      console.log(
        `[cancelOrders] Нет ордеров${resource ? ` на ${resource}` : ""}`,
      );
      return;
    }

    orders.forEach(o => {
      const result = Game.market.cancelOrder(o.id);
      console.log(
        `[cancelOrders] ${
          o.resourceType
        } x${o.remainingAmount.toLocaleString()} — ${
          result === OK ? "✅ отменён" : "❌ ошибка: " + result
        }`,
      );
    });
  },

  /**
   * orders — показать активные ордера
   * Использование: require("console").orders()
   */
  orders() {
    const orders = Object.values(Game.market.orders);
    if (orders.length === 0) {
      console.log("[orders] Нет активных ордеров");
      return;
    }
    console.log(
      `[orders] Активных: ${
        orders.length
      } | Баланс: ${Game.market.credits.toFixed(2)} кредитов`,
    );
    orders.forEach(o => {
      const type = o.type === ORDER_SELL ? "ПРОДАЖА" : "ПОКУПКА";
      console.log(
        `  ${type} | ${o.resourceType} | ${
          o.price
        } кр. | осталось: ${o.remainingAmount.toLocaleString()} | ${
          o.roomName
        }`,
      );
    });
  },

  /**
   * setTerminalTarget — лимит энергии в терминале
   * Использование: require("console").setTerminalTarget("E37S37", 20000)
   */
  setTerminalTarget(roomName, amount) {
    if (!Game.rooms[roomName]) {
      console.log(`[setTerminalTarget] Комната ${roomName} не видна`);
      return;
    }
    Game.rooms[roomName].memory.terminalEnergyTarget = amount;
    console.log(
      `[setTerminalTarget] ${roomName}: лимит = ${amount.toLocaleString()}`,
    );
  },

  /**
   * setWallThreshold — порог HP стен для башен
   * Использование: require("console").setWallThreshold("E37S37", 100000)
   */
  setWallThreshold(roomName, hp) {
    if (!Game.rooms[roomName]) {
      console.log(`[setWallThreshold] Комната ${roomName} не видна`);
      return;
    }
    Game.rooms[roomName].memory.wallThreshold = hp;
    console.log(
      `[setWallThreshold] ${roomName}: порог = ${hp.toLocaleString()} HP`,
    );
  },

  /**
   * setSource — сменить источник крипа
   * Использование: require("console").setSource("test_miner_12345", 1)
   */
  setSource(creepName, index) {
    const creep = Game.creeps[creepName];
    if (!creep) {
      console.log(`[setSource] Крип ${creepName} не найден`);
      return;
    }
    creep.memory.sourceIndex = index;
    delete creep.memory.containerId;
    console.log(`[setSource] ${creepName}: sourceIndex = ${index}`);
  },

  /**
   * killRole — убить всех крипов роли (для обновления тел)
   * Использование: require("console").killRole("test_hauler")
   */
  killRole(role) {
    let count = 0;
    for (const name in Game.creeps) {
      if (Game.creeps[name].memory.role === role) {
        Game.creeps[name].suicide();
        count++;
      }
    }
    console.log(`[killRole] "${role}": убито ${count} крипов`);
  },

  /**
   * killCreep — убить одного крипа
   * Использование: require("console").killCreep("test_miner_12345")
   */
  killCreep(name) {
    const creep = Game.creeps[name];
    if (!creep) {
      console.log(`[killCreep] ${name} не найден`);
      return;
    }
    creep.suicide();
    console.log(`[killCreep] ${name} убит`);
  },

  /**
   * setAttackTarget — направить атакеров в комнату
   * Использование: require("console").setAttackTarget("E35S39")
   */
  setAttackTarget(roomName) {
    if (!Memory.attackerConfig) Memory.attackerConfig = {};
    Memory.attackerConfig.emergencyTarget = roomName;
    console.log(`[setAttackTarget] Атакеры → ${roomName}`);
  },

  /**
   * clearAttackTarget — снять боевой приказ
   * Использование: require("console").clearAttackTarget()
   */
  clearAttackTarget() {
    if (Memory.attackerConfig) {
      delete Memory.attackerConfig.emergencyTarget;
      for (const name in Game.creeps) {
        if (Game.creeps[name].memory.role === "test_attacker") {
          delete Game.creeps[name].memory.targetRoom;
        }
      }
    }
    console.log(
      `[clearAttackTarget] Приказ снят, атакеры возвращаются в патруль`,
    );
  },

  /**
   * setReserveRooms — задать комнаты для резервистов
   * Использование: require("console").setReserveRooms(["E35S38","E36S37"])
   */
  setReserveRooms(rooms) {
    if (!Memory.reserverConfig) Memory.reserverConfig = {};
    Memory.reserverConfig.targetRooms = rooms;
    for (const name in Game.creeps) {
      if (Game.creeps[name].memory.role === "test_reserver") {
        delete Game.creeps[name].memory.targetRoom;
      }
    }
    console.log(`[setReserveRooms] Комнаты: ${rooms.join(", ")}`);
  },

  /**
   * memory — показать память комнаты
   * Использование: require("console").memory("E37S37")
   */
  memory(roomName) {
    const mem = Memory.rooms[roomName];
    if (!mem) {
      console.log(`[memory] Нет данных для ${roomName}`);
      return;
    }
    console.log(`[memory] ${roomName}:`);
    console.log(JSON.stringify(mem, null, 2));
  },

  /**
   * resetMemory — сбросить кэш комнаты (настройки сохраняются)
   * Использование: require("console").resetMemory("E37S37")
   */
  resetMemory(roomName) {
    if (!Memory.rooms[roomName]) {
      console.log(`[resetMemory] Нет данных для ${roomName}`);
      return;
    }
    const keep = {
      terminalEnergyTarget: Memory.rooms[roomName].terminalEnergyTarget,
      wallThreshold: Memory.rooms[roomName].wallThreshold,
      wallThresholdMax: Memory.rooms[roomName].wallThresholdMax,
      minStorageEnergy: Memory.rooms[roomName].minStorageEnergy,
    };
    Memory.rooms[roomName] = keep;
    console.log(`[resetMemory] ${roomName}: кэш сброшен, настройки сохранены`);
  },
};

module.exports = cmd;
