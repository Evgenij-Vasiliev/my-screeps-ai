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
   */
  help() {
    console.log("========== КОМАНДЫ УПРАВЛЕНИЯ ==========");
    console.log('require("console").help()');
    console.log("  — эта справка");
    console.log('require("console").stats()');
    console.log("  — сводка по всем комнатам");
    console.log('require("console").resources()');
    console.log("  — баланс всех ресурсов по комнатам");
    console.log('require("console").prices("L")');
    console.log("  — цены на ресурс на рынке");
    console.log('require("console").sell("L", 100000, 5.0)');
    console.log("  — показать план продажи");
    console.log('require("console").sell("L", 100000, 5.0, true)');
    console.log("  — создать ордер на продажу");
    console.log('require("console").cancelOrders("L")');
    console.log("  — отменить все ордера на ресурс");
    console.log('require("console").cancelOrders()');
    console.log("  — отменить ВСЕ ордера");
    console.log('require("console").orders()');
    console.log("  — показать активные ордера");
    console.log('require("console").moveCreep("имя", x, y, "комната")');
    console.log("  — отправить крипа в точку (или другую комнату)");
    console.log(
      'require("console").setMinerPos("E35S37", [{x:18,y:4},{x:29,y:5}])',
    );
    console.log("  — задать позиции майнеров в комнате");
    console.log('require("console").getMinerPos("E35S37")');
    console.log("  — показать позиции майнеров в комнате");
    console.log(
      'require("console").sendResource("E35S37", "E35S39", "K", 1000)',
    );
    console.log("  — отправить ресурс из терминала в терминал");
    console.log('require("console").setTerminalTarget("E37S37", 20000)');
    console.log("  — задать лимит энергии в терминале комнаты");
    console.log('require("console").setWallThreshold("E37S37", 100000)');
    console.log("  — задать порог HP стен для башен");
    console.log('require("console").setSource("test_miner_12345", 1)');
    console.log("  — сменить источник энергии для крипа");
    console.log('require("console").killRole("test_hauler")');
    console.log("  — убить всех крипов роли");
    console.log('require("console").killCreep("test_miner_12345")');
    console.log("  — убить одного крипа");
    console.log('require("console").setAttackTarget("E35S39")');
    console.log("  — направить всех атакеров в комнату");
    console.log('require("console").clearAttackTarget()');
    console.log("  — снять боевой приказ");
    console.log('require("console").setReserveRooms(["E35S38","E36S37"])');
    console.log("  — задать комнаты для резервистов");
    console.log('require("console").memory("E37S37")');
    console.log("  — показать память комнаты");
    console.log('require("console").resetMemory("E37S37")');
    console.log("  — сбросить кэш комнаты");
    console.log("=========================================");
  },

  /**
   * stats — сводка по всем комнатам
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
    console.log("--- CPU ---");
    console.log(`  Лимит: ${Game.cpu.limit} | Bucket: ${Game.cpu.bucket}`);
    if (Memory.cpuStats)
      console.log(
        `  Среднее за 100 тиков: ${Memory.cpuStats.average.toFixed(2)}`,
      );
    console.log("=========================================");
  },

  /**
   * resources — баланс всех ресурсов по всем комнатам
   * Использование: require("console").resources()
   */
  resources() {
    console.log("========== БАЛАНС РЕСУРСОВ ==========");
    const totals = {};
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      console.log(`--- ${roomName} ---`);

      // Storage
      if (room.storage) {
        const items = Object.entries(room.storage.store)
          .filter(([, amt]) => amt > 0)
          .map(([r, amt]) => `${r}:${amt.toLocaleString()}`)
          .join(", ");
        console.log(`  Storage:  ${items || "пусто"}`);
        for (const [r, amt] of Object.entries(room.storage.store)) {
          totals[r] = (totals[r] || 0) + amt;
        }
      }

      // Terminal
      if (room.terminal) {
        const items = Object.entries(room.terminal.store)
          .filter(([, amt]) => amt > 0)
          .map(([r, amt]) => `${r}:${amt.toLocaleString()}`)
          .join(", ");
        console.log(`  Terminal: ${items || "пусто"}`);
        for (const [r, amt] of Object.entries(room.terminal.store)) {
          totals[r] = (totals[r] || 0) + amt;
        }
      }
    }
    console.log("--- ИТОГО по всем комнатам ---");
    for (const [r, amt] of Object.entries(totals).sort()) {
      console.log(`  ${r.padEnd(10)} ${amt.toLocaleString()}`);
    }
    console.log("=====================================");
  },

  /**
   * moveCreep — отправить крипа в точку или другую комнату
   * Использование:
   *   require("console").moveCreep("test_miner_123", 25, 25, "E35S37")
   *   require("console").moveCreep("test_miner_123", 25, 25) — текущая комната
   */
  moveCreep(creepName, x, y, roomName) {
    const creep = Game.creeps[creepName];
    if (!creep) {
      console.log(`[moveCreep] Крип ${creepName} не найден`);
      return;
    }
    const room = roomName || creep.room.name;
    // Записываем принудительную цель в память — роль проверит это
    creep.memory.forceTarget = { x, y, room };
    console.log(`[moveCreep] ${creepName} → (${x},${y}) в ${room}`);
    console.log(
      `  Чтобы отменить: delete Game.creeps["${creepName}"].memory.forceTarget`,
    );
  },

  /**
   * setMinerPos — задать позиции майнеров в комнате
   * Использование: require("console").setMinerPos("E35S37", [{x:18,y:4},{x:29,y:5}])
   */
  setMinerPos(roomName, positions) {
    if (!Memory.rooms[roomName]) {
      console.log(`[setMinerPos] Комната ${roomName} не найдена в памяти`);
      return;
    }
    Memory.rooms[roomName].minerPositions = positions;
    // Сбрасываем кэш позиций у живых майнеров этой комнаты
    let reset = 0;
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if (c.memory.role === "test_miner" && c.room.name === roomName) {
        delete c.memory.parkX;
        delete c.memory.parkY;
        delete c.memory.linkId;
        reset++;
      }
    }
    console.log(
      `[setMinerPos] ${roomName}: позиции обновлены, сброшен кэш у ${reset} майнеров`,
    );
    console.log(`  Позиции: ${JSON.stringify(positions)}`);
  },

  /**
   * getMinerPos — показать позиции майнеров в комнате
   * Использование: require("console").getMinerPos("E35S37")
   */
  getMinerPos(roomName) {
    const positions =
      Memory.rooms[roomName] && Memory.rooms[roomName].minerPositions;
    if (!positions) {
      console.log(`[getMinerPos] Позиции не заданы для ${roomName}`);
      return;
    }
    console.log(`[getMinerPos] ${roomName}: ${JSON.stringify(positions)}`);
    // Показываем где сейчас стоят майнеры
    Object.values(Game.creeps)
      .filter(c => c.memory.role === "test_miner" && c.room.name === roomName)
      .forEach(c =>
        console.log(
          `  ${c.name} → park:(${c.memory.parkX},${c.memory.parkY}) реально:(${c.pos.x},${c.pos.y})`,
        ),
      );
  },

  /**
   * sendResource — отправить ресурс из терминала в терминал
   * Использование: require("console").sendResource("E35S37", "E35S39", "K", 1000)
   */
  sendResource(fromRoom, toRoom, resource, amount) {
    const room = Game.rooms[fromRoom];
    if (!room || !room.terminal) {
      console.log(`[sendResource] Нет терминала в ${fromRoom}`);
      return;
    }
    const available = room.terminal.store[resource] || 0;
    if (available < amount) {
      console.log(
        `[sendResource] Недостаточно ${resource} в ${fromRoom}: есть ${available}, нужно ${amount}`,
      );
      return;
    }
    if (room.terminal.cooldown > 0) {
      console.log(
        `[sendResource] Терминал ${fromRoom} на кулдауне: ${room.terminal.cooldown} тиков`,
      );
      return;
    }
    const txCost = Game.market.calcTransactionCost(amount, fromRoom, toRoom);
    const energyAvailable = room.terminal.store[RESOURCE_ENERGY] || 0;
    console.log(
      `[sendResource] ${fromRoom} → ${toRoom}: ${amount} ${resource}`,
    );
    console.log(
      `  Стоимость транзакции: ${txCost} энергии | В терминале: ${energyAvailable}`,
    );
    if (txCost > energyAvailable) {
      console.log(`  ❌ Недостаточно энергии для транзакции`);
      return;
    }
    const result = room.terminal.send(resource, amount, toRoom);
    console.log(result === OK ? `  ✅ Отправлено!` : `  ❌ Ошибка: ${result}`);
  },

  /**
   * prices — показать цены покупки на рынке
   */
  prices(resource) {
    const orders = Game.market.getAllOrders({
      type: ORDER_BUY,
      resourceType: resource,
    });
    if (!orders || orders.length === 0) {
      console.log(`[prices] Нет ордеров на покупку ${resource}`);
      return;
    }
    orders.sort((a, b) => b.price - a.price);
    const top = orders.slice(0, 10);
    console.log(`[prices] Топ-10 ордеров на ПОКУПКУ ${resource}:`);
    console.log(`  Цена   | Количество      | Комната`);
    top.forEach(o => {
      console.log(
        `  ${String(o.price.toFixed(3)).padEnd(7)}| ${String(
          o.amount.toLocaleString(),
        ).padEnd(16)}| ${o.roomName || "межсерверный"}`,
      );
    });
    const best = top[0];
    console.log(`[prices] Лучшая цена: ${best.price.toFixed(3)}`);
    console.log(
      `[prices] Команда: require("console").sell("${resource}", КОЛИЧЕСТВО, ${(
        best.price * 0.95
      ).toFixed(3)})`,
    );
  },

  /**
   * sell — безопасная продажа ресурса
   */
  sell(resource, amount, price, confirm = false, roomName = null) {
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
    const existingOrders = Object.values(Game.market.orders).filter(
      o => o.resourceType === resource && o.type === ORDER_SELL && o.active,
    );
    if (existingOrders.length > 0) {
      console.log(
        `[sell] ВНИМАНИЕ: уже есть ${existingOrders.length} активных ордеров на ${resource}`,
      );
      existingOrders.forEach(o =>
        console.log(
          `  ID: ${o.id} | Цена: ${
            o.price
          } | Осталось: ${o.remainingAmount.toLocaleString()}`,
        ),
      );
      console.log(
        `  Сначала отмени: require("console").cancelOrders("${resource}")`,
      );
      return;
    }
    console.log(`[sell] ПЛАН ПРОДАЖИ:`);
    console.log(`  Ресурс: ${resource} | Комната: ${room.name}`);
    console.log(
      `  В терминале: ${available.toLocaleString()} | Продаём: ${amount.toLocaleString()} по ${price}`,
    );
    console.log(
      `  Выручка: ~${(amount * price).toLocaleString()} | Налог: ${(
        amount * 0.05
      ).toFixed(0)} кр.`,
    );
    console.log(`  Баланс: ${Game.market.credits.toFixed(2)} кредитов`);
    if (!confirm) {
      console.log(
        `  Для создания: require("console").sell("${resource}", ${amount}, ${price}, true)`,
      );
      return;
    }
    const result = Game.market.createOrder({
      type: ORDER_SELL,
      resourceType: resource,
      price,
      totalAmount: amount,
      roomName: room.name,
    });
    console.log(
      result === OK ? `[sell] ✅ Ордер создан!` : `[sell] ❌ Ошибка: ${result}`,
    );
  },

  /**
   * cancelOrders — отменить ордера
   */
  cancelOrders(resource = null) {
    const orders = Object.values(Game.market.orders).filter(o =>
      resource ? o.resourceType === resource : true,
    );
    if (orders.length === 0) {
      console.log(`[cancelOrders] Нет ордеров`);
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
   * orders — активные ордера
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
      console.log(
        `  ${o.type === ORDER_SELL ? "ПРОДАЖА" : "ПОКУПКА"} | ${
          o.resourceType
        } | ${
          o.price
        } кр. | осталось: ${o.remainingAmount.toLocaleString()} | ${
          o.roomName
        }`,
      );
    });
  },

  /**
   * setTerminalTarget — лимит энергии в терминале
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
   * setWallThreshold — порог HP стен
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
   * killRole — убить всех крипов роли
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
   */
  setAttackTarget(roomName) {
    if (!Memory.attackerConfig) Memory.attackerConfig = {};
    Memory.attackerConfig.emergencyTarget = roomName;
    console.log(`[setAttackTarget] Атакеры → ${roomName}`);
  },

  /**
   * clearAttackTarget — снять боевой приказ
   */
  clearAttackTarget() {
    if (Memory.attackerConfig) {
      delete Memory.attackerConfig.emergencyTarget;
      for (const name in Game.creeps) {
        if (Game.creeps[name].memory.role === "test_attacker")
          delete Game.creeps[name].memory.targetRoom;
      }
    }
    console.log(`[clearAttackTarget] Приказ снят`);
  },

  /**
   * setReserveRooms — задать комнаты для резервистов
   */
  setReserveRooms(rooms) {
    if (!Memory.reserverConfig) Memory.reserverConfig = {};
    Memory.reserverConfig.targetRooms = rooms;
    for (const name in Game.creeps) {
      if (Game.creeps[name].memory.role === "test_reserver")
        delete Game.creeps[name].memory.targetRoom;
    }
    console.log(`[setReserveRooms] Комнаты: ${rooms.join(", ")}`);
  },

  /**
   * memory — показать память комнаты
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
   * resetMemory — сбросить кэш комнаты
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
      links: Memory.rooms[roomName].links,
      minerPositions: Memory.rooms[roomName].minerPositions,
    };
    Memory.rooms[roomName] = keep;
    console.log(`[resetMemory] ${roomName}: кэш сброшен, настройки сохранены`);
  },
};

module.exports = cmd;
