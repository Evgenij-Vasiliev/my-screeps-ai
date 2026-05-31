/**
 * ===================================================
 * CONSOLE.JS — Ручное управление и диагностика
 * ===================================================
 * VERSION: 3.0
 *
 * ИЗМЕНЕНИЯ v3.0:
 * - Добавлен labs(roomName)     — статус лаб и реакций
 * - Добавлен terminal(roomName) — статус терминала и его содержимое
 * - Добавлен market()           — активные buy/sell интенты
 * - Добавлен balance()          — межкомнатный баланс ресурсов
 * - Добавлен sendResource(from, to, res, amount) — ручная отправка
 * - Расширен roomHealth():      добавлены Labs, Market, Balance
 *
 * КОМАНДЫ ДИАГНОСТИКИ:
 *   empire()                    — сводка по всей империи
 *   room('E35S37')              — состояние комнаты
 *   diag('E35S37')              — полная диагностика
 *   creepDiag('name')           — диагностика крипа
 *   factory('E35S37')           — состояние фабрики
 *   links('E35S37')             — состояние линков
 *   logistics()                 — все активные deliveries
 *   labs('E35S37')              — состояние лаб и реакций  [NEW v3.0]
 *   terminal('E35S37')          — содержимое терминала     [NEW v3.0]
 *   market()                    — buy/sell интенты         [NEW v3.0]
 *   balance()                   — баланс ресурсов          [NEW v3.0]
 *   history()                   — последние 20 событий
 *   history('E35S37')           — события комнаты
 *   history('E35S37', 10)       — последние N событий
 *   roomHealth('E35S37')        — быстрый статус комнаты
 *
 * КОМАНДЫ УПРАВЛЕНИЯ:
 *   deliver(room, res, target, labId, amount)
 *   sendResource(from, to, resource, amount)  [NEW v3.0]
 *   clearCreep('name')
 *   resetFactory('E35S37')
 *   resetRoom('E35S37')
 *   killDelivery('E35S37', id)
 *   setFactoryProduct('E35S37', 'battery')
 *   diagOn() / diagOff()
 *   autoRefill()
 * ===================================================
 */

const Logger = require("./logger");
const diagnostics = require("./diagnostics");

// ══════════════════════════════════════════════════════
// ДИАГНОСТИКА — БАЗОВЫЕ КОМАНДЫ (без изменений)
// ══════════════════════════════════════════════════════

global.room = function (roomName) {
  const r = Game.rooms[roomName];
  if (!r) {
    console.log(`❌ комната ${roomName} недоступна`);
    return;
  }

  const storage = r.storage ? r.storage.store[RESOURCE_ENERGY] : "—";
  const terminal = r.terminal ? r.terminal.store[RESOURCE_ENERGY] : "—";

  const factory = r.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_FACTORY,
  })[0];

  const factoryData =
    Memory.empire &&
    Memory.empire.factory &&
    Memory.empire.factory.rooms &&
    Memory.empire.factory.rooms[roomName];

  const creeps = Object.values(Game.creeps).filter(
    c => c.room.name === roomName,
  );
  const byRole = {};
  for (const c of creeps) {
    byRole[c.memory.role] = (byRole[c.memory.role] || 0) + 1;
  }

  console.log(`\n========== КОМНАТА: ${roomName} ==========`);
  console.log(`  RCL:      ${r.controller ? r.controller.level : "—"}`);
  console.log(`  Storage:  ${storage}`);
  console.log(`  Terminal: ${terminal}`);

  if (factory) {
    const status = factoryData ? factoryData.status : "—";
    const task =
      factoryData && factoryData.task ? factoryData.task.resource : "—";
    const product =
      r.memory && r.memory.factoryProduct ? r.memory.factoryProduct : "battery";
    console.log(`  Factory:  status=${status} task=${task} product=${product}`);
    console.log(
      `    store: energy=${factory.store[RESOURCE_ENERGY] || 0} ${product}=${
        factory.store[product] || 0
      }`,
    );
  } else {
    console.log(`  Factory:  нет`);
  }

  console.log(`  Крипов:   ${creeps.length}`);
  for (const [role, count] of Object.entries(byRole)) {
    console.log(`    ${role}: ${count}`);
  }
  console.log(`==========================================\n`);
};

global.diag = function (roomName) {
  diagnostics.checkRoom(roomName);
};

global.creepDiag = function (creepName) {
  diagnostics.checkCreep(creepName);
};

global.factory = function (roomName) {
  const r = Game.rooms[roomName];
  if (!r) {
    console.log(`❌ комната ${roomName} недоступна`);
    return;
  }

  const factory = r.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_FACTORY,
  })[0];

  if (!factory) {
    console.log(`❌ фабрика в ${roomName} не найдена`);
    return;
  }

  const data =
    Memory.empire &&
    Memory.empire.factory &&
    Memory.empire.factory.rooms &&
    Memory.empire.factory.rooms[roomName];

  const product =
    r.memory && r.memory.factoryProduct ? r.memory.factoryProduct : "battery";

  console.log(`\n========== ФАБРИКА: ${roomName} ==========`);
  console.log(`  status:   ${data ? data.status : "—"}`);
  console.log(
    `  task:     ${data && data.task ? JSON.stringify(data.task) : "нет"}`,
  );
  console.log(`  product:  ${product}`);
  console.log(`  cooldown: ${factory.cooldown}`);
  console.log(`  store:`);
  for (const [res, amt] of Object.entries(factory.store)) {
    if (amt > 0) console.log(`    ${res}: ${amt}`);
  }

  const deliveries =
    Memory.empire &&
    Memory.empire.logistics &&
    Memory.empire.logistics.deliveries &&
    Memory.empire.logistics.deliveries[roomName];

  if (deliveries && deliveries.length > 0) {
    const active = deliveries.filter(
      d => d.status !== "completed" && d.status !== "cancelled",
    );
    if (active.length > 0) {
      console.log(`  Deliveries:`);
      for (const d of active) {
        console.log(
          `    [${d.status}] ${d.resource} x${d.amount} → ${
            d.target
          } (worker: ${d.assignedTo || "—"})`,
        );
      }
    }
  }
  console.log(`==========================================\n`);
};

global.links = function (roomName) {
  const r = Game.rooms[roomName];
  if (!r) {
    console.log(`❌ комната ${roomName} недоступна`);
    return;
  }

  const links = r.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_LINK,
  });

  console.log(`\n========== ЛИНКИ: ${roomName} ==========`);
  console.log(`  Всего: ${links.length}`);
  for (const link of links) {
    const cap = link.store.getCapacity(RESOURCE_ENERGY) || 1;
    const pct = Math.round(((link.store[RESOURCE_ENERGY] || 0) / cap) * 100);
    console.log(
      `  id=...${link.id.slice(-6)} energy=${
        link.store[RESOURCE_ENERGY] || 0
      } (${pct}%) cooldown=${link.cooldown}`,
    );
  }
  console.log(`========================================\n`);
};

global.logistics = function () {
  const deliveries =
    Memory.empire &&
    Memory.empire.logistics &&
    Memory.empire.logistics.deliveries;

  if (!deliveries) {
    console.log("❌ нет данных логистики");
    return;
  }

  console.log(`\n========== ЛОГИСТИКА ==========`);
  for (const [roomName, list] of Object.entries(deliveries)) {
    const active = list.filter(
      d => d.status !== "completed" && d.status !== "cancelled",
    );
    if (active.length === 0) continue;
    console.log(`  ${roomName}:`);
    for (const d of active) {
      console.log(
        `    [${d.status}] ${d.resource} x${d.amount} → ${d.target} | worker: ${
          d.assignedTo || "—"
        }`,
      );
    }
  }
  console.log(`================================\n`);
};

global.empire = function () {
  console.log(`\n========== ИМПЕРИЯ ==========`);
  console.log(`  Тик: ${Game.time}`);
  console.log(`  CPU bucket: ${Game.cpu.bucket}`);

  const economy = Memory.empire && Memory.empire.economy;
  if (economy) {
    const critical = Object.entries(economy)
      .filter(([, v]) => v.state === "critical")
      .map(([k]) => k);
    const low = Object.entries(economy)
      .filter(([, v]) => v.state === "low")
      .map(([k]) => k);
    if (critical.length > 0)
      console.log(`  🚨 Critical: ${critical.join(", ")}`);
    if (low.length > 0) console.log(`  ⚠️  Low:      ${low.join(", ")}`);
  }

  for (const roomName in Game.rooms) {
    const r = Game.rooms[roomName];
    if (!r.controller || !r.controller.my) continue;
    const storage = r.storage ? r.storage.store[RESOURCE_ENERGY] : 0;
    const terminal = r.terminal ? r.terminal.store.getUsedCapacity() : 0;
    console.log(`  ${roomName}: storage=${storage} terminal=${terminal}`);
  }

  const dispMeta = Memory.empire && Memory.empire.dispatcherMeta;
  if (dispMeta) {
    console.log(
      `  Dispatcher: queued=${dispMeta.queuedCount} idle=${dispMeta.idleWorkers} assigned=${dispMeta.assignedCount}`,
    );
  }
  console.log(`==============================\n`);
};

// ══════════════════════════════════════════════════════
// НОВЫЕ КОМАНДЫ v3.0
// ══════════════════════════════════════════════════════

// ── LABS ──────────────────────────────────────────────────────────────────

/**
 * Показать статус лаб в комнате.
 * Читает конфиги из room.memory.labs/labs2/labs3...
 * Показывает содержимое каждой лабы и статус реакции.
 *
 * @param {string} roomName
 *
 * @example
 * labs('E35S37')
 */
global.labs = function (roomName) {
  const r = Game.rooms[roomName];
  if (!r) {
    console.log(`❌ комната ${roomName} недоступна`);
    return;
  }

  // Ключи конфигов лаб — как в labManager
  const LAB_KEYS = ["labs", "labs2", "labs3", "labs4", "labs5"];
  const mem = r.memory;

  console.log(`\n========== ЛАБЫ: ${roomName} ==========`);

  let hasAny = false;

  for (const key of LAB_KEYS) {
    const config = mem[key];
    if (!config || !config.product) continue;

    hasAny = true;

    const lab1 = Game.getObjectById(config.lab1);
    const lab2 = Game.getObjectById(config.lab2);
    const reactor = Game.getObjectById(config.reactor);

    console.log(
      `\n  [${key}] Реакция: ${config.reagent1} + ${config.reagent2} → ${config.product}`,
    );

    // Статус lab1 (входная — реагент 1)
    if (!lab1) {
      console.log(`    L1 (input ${config.reagent1}): ❌ не найдена`);
    } else {
      const amount = lab1.store[config.reagent1] || 0;
      const icon = amount > 500 ? "✅" : amount > 0 ? "⚠️ " : "❌";
      console.log(`    L1 input ${config.reagent1}: ${icon} ${amount}`);
    }

    // Статус lab2 (входная — реагент 2)
    if (!lab2) {
      console.log(`    L2 (input ${config.reagent2}): ❌ не найдена`);
    } else {
      const amount = lab2.store[config.reagent2] || 0;
      const icon = amount > 500 ? "✅" : amount > 0 ? "⚠️ " : "❌";
      console.log(`    L2 input ${config.reagent2}: ${icon} ${amount}`);
    }

    // Статус reactor (выходная — продукт)
    if (!reactor) {
      console.log(`    L3 (output ${config.product}): ❌ не найдена`);
    } else {
      const productAmt = reactor.store[config.product] || 0;
      const cooldown = reactor.cooldown || 0;
      const icon = productAmt > 0 ? "✅" : "⏳";
      console.log(
        `    L3 output ${config.product}: ${icon} ${productAmt} | cooldown: ${cooldown}`,
      );
    }

    // Данные из labController если есть
    const lcData =
      Memory.empire &&
      Memory.empire.labController &&
      Memory.empire.labController.rooms &&
      Memory.empire.labController.rooms[roomName];

    if (lcData) {
      const slot = lcData.slots && lcData.slots.find(s => s.slot === key);
      if (slot) {
        const statusIcon =
          {
            running: "🟢",
            ready: "🔵",
            waiting_input: "🟡",
            cooldown: "⏸️",
            error: "🔴",
            queued: "⬜",
          }[slot.status] || "❓";
        console.log(`    Статус: ${statusIcon} ${slot.status}`);
        if (slot.missing && slot.missing.length > 0) {
          console.log(`    ⚠️  Нет реагентов: ${slot.missing.join(", ")}`);
        }
      }
    }
  }

  if (!hasAny) {
    console.log(`  Конфиги лаб не найдены.`);
    console.log(
      `  Настройте через: Memory.rooms['${roomName}'].labs = { lab1: 'ID', lab2: 'ID', reactor: 'ID', reagent1: 'H', reagent2: 'O', product: 'OH' }`,
    );
  }

  // Показываем labWorker'ов в этой комнате
  const workers = Object.values(Game.creeps).filter(
    c => c.memory.role === "labWorker" && c.room.name === roomName,
  );
  if (workers.length > 0) {
    console.log(`\n  LabWorkers: ${workers.length}`);
    for (const w of workers) {
      console.log(
        `    ${w.name}: task=${w.memory.task || "idle"} store=${JSON.stringify(
          w.store,
        )}`,
      );
    }
  }

  console.log(`========================================\n`);
};

// ── TERMINAL ─────────────────────────────────────────────────────────────

/**
 * Показать содержимое терминала в комнате.
 * Показывает все ресурсы с количеством > 0, cooldown, заполненность.
 *
 * @param {string} roomName
 *
 * @example
 * terminal('E35S37')
 */
global.terminal = function (roomName) {
  const r = Game.rooms[roomName];
  if (!r) {
    console.log(`❌ комната ${roomName} недоступна`);
    return;
  }

  const term = r.terminal;
  if (!term) {
    console.log(`❌ терминал в ${roomName} не найден`);
    return;
  }

  const used = term.store.getUsedCapacity();
  const cap = term.store.getCapacity();
  const pct = Math.round((used / cap) * 100);
  const fillIcon = pct > 90 ? "🔴" : pct > 70 ? "🟡" : "🟢";

  console.log(`\n========== ТЕРМИНАЛ: ${roomName} ==========`);
  console.log(`  Заполнен: ${fillIcon} ${used}/${cap} (${pct}%)`);
  console.log(`  Cooldown: ${term.cooldown}`);
  console.log(`\n  Ресурсы:`);

  // Сортируем по количеству — больше сверху
  const resources = Object.entries(term.store)
    .filter(([, amt]) => amt > 0)
    .sort(([, a], [, b]) => b - a);

  if (resources.length === 0) {
    console.log(`    (пусто)`);
  } else {
    for (const [res, amt] of resources) {
      console.log(`    ${res.padEnd(20)}: ${amt}`);
    }
  }

  // Показываем pending send-задачи из памяти если есть
  const pending = r.memory && r.memory.terminalSend;
  if (pending && pending.length > 0) {
    console.log(`\n  Pending отправки:`);
    for (const p of pending) {
      console.log(
        `    send ${p.resource} x${p.amount} → ${p.to} [${
          p.status || "queued"
        }]`,
      );
    }
  }

  console.log(`==========================================\n`);
};

// ── MARKET ────────────────────────────────────────────────────────────────

/**
 * Показать текущие buy/sell интенты MarketManager.
 * Также показывает активные ордера на рынке.
 *
 * @example
 * market()
 */
global.market = function () {
  console.log(`\n========== МАРКЕТ ==========`);
  console.log(`  Credits: ${Math.round(Game.market.credits)}`);
  console.log(`  Тик: ${Game.time}`);

  // ── Интенты из MarketManager ──────────────────────────────────────────
  const marketData = Memory.empire && Memory.empire.market;

  if (!marketData) {
    console.log(`  ❌ MarketManager данные отсутствуют`);
  } else {
    console.log(`\n  BUY интенты:`);
    if (!marketData.buy || marketData.buy.length === 0) {
      console.log(`    нет`);
    } else {
      for (const i of marketData.buy) {
        console.log(
          `    ${i.resource.padEnd(20)} x${i.amount} [${i.priority}] — ${
            i.reason
          }`,
        );
      }
    }

    console.log(`\n  SELL интенты:`);
    if (!marketData.sell || marketData.sell.length === 0) {
      console.log(`    нет`);
    } else {
      for (const i of marketData.sell) {
        console.log(
          `    ${i.resource.padEnd(20)} x${i.amount} [${i.priority}] — ${
            i.reason
          }`,
        );
      }
    }
  }

  // ── Реальные активные ордера на рынке ────────────────────────────────
  const myOrders = Game.market.orders;
  const orderList = Object.values(myOrders || {});

  console.log(`\n  Активные ордера на рынке: ${orderList.length}`);
  if (orderList.length > 0) {
    const buys = orderList.filter(o => o.type === ORDER_BUY);
    const sells = orderList.filter(o => o.type === ORDER_SELL);

    if (buys.length > 0) {
      console.log(`  BUY:`);
      for (const o of buys) {
        console.log(
          `    ${o.resourceType.padEnd(20)} x${o.remainingAmount} @ ${o.price}`,
        );
      }
    }
    if (sells.length > 0) {
      console.log(`  SELL:`);
      for (const o of sells) {
        console.log(
          `    ${o.resourceType.padEnd(20)} x${o.remainingAmount} @ ${o.price}`,
        );
      }
    }
  }

  // ── Последние сделки ──────────────────────────────────────────────────
  const history = Memory.empire && Memory.empire.marketHistory;
  if (history && history.length > 0) {
    console.log(`\n  Последние сделки (${Math.min(history.length, 5)}):`);
    for (const h of history.slice(0, 5)) {
      const sign = h.type === "sell" ? "+" : "-";
      const credits = (h.amount * h.price).toFixed(0);
      console.log(
        `    t=${h.tick} ${h.type.toUpperCase()} ${h.resource} x${h.amount} @ ${
          h.price
        } (${sign}${credits}cr)`,
      );
    }
  }

  // ── Мета маркет-директора ─────────────────────────────────────────────
  const meta = Memory.empire && Memory.empire.marketDirectivesMeta;
  if (meta) {
    console.log(
      `\n  MarketDirector: produce=${meta.produceCount} buy=${meta.buyCount} sell=${meta.sellCount} stockpile=${meta.stockpileCount}`,
    );
  }

  console.log(`============================\n`);
};

// ── BALANCE ───────────────────────────────────────────────────────────────

/**
 * Показать межкомнатный баланс ключевых ресурсов.
 * Показывает сколько каждого ресурса в каждой комнате.
 * Выявляет дисбаланс (одна комната голодает, другая — в избытке).
 *
 * @example
 * balance()
 */
global.balance = function () {
  // Ресурсы для мониторинга баланса
  const BALANCE_RESOURCES = [
    RESOURCE_ENERGY,
    RESOURCE_HYDROGEN,
    RESOURCE_OXYGEN,
    RESOURCE_HYDROXIDE, // OH
    RESOURCE_BATTERY,
  ];

  // Пороги: ниже MIN — дефицит, выше MAX — избыток
  const THRESHOLDS = {
    [RESOURCE_ENERGY]: { min: 50000, max: 300000 },
    [RESOURCE_HYDROGEN]: { min: 2000, max: 20000 },
    [RESOURCE_OXYGEN]: { min: 2000, max: 20000 },
    [RESOURCE_HYDROXIDE]: { min: 1000, max: 10000 },
    [RESOURCE_BATTERY]: { min: 5000, max: 50000 },
  };

  // Собираем данные по всем своим комнатам
  const myRooms = Object.values(Game.rooms).filter(
    r => r.controller && r.controller.my,
  );

  console.log(`\n========== БАЛАНС РЕСУРСОВ ==========`);

  for (const resource of BALANCE_RESOURCES) {
    const thresh = THRESHOLDS[resource] || { min: 1000, max: 50000 };
    const roomData = [];

    for (const r of myRooms) {
      // Берём из storage + terminal
      const inStorage = r.storage ? r.storage.store[resource] || 0 : 0;
      const inTerminal = r.terminal ? r.terminal.store[resource] || 0 : 0;
      const total = inStorage + inTerminal;
      roomData.push({ name: r.name, total, inStorage, inTerminal });
    }

    if (roomData.length === 0) continue;

    console.log(`\n  ${resource}:`);
    for (const rd of roomData) {
      let icon = "🟢";
      if (rd.total < thresh.min) icon = "🔴";
      else if (rd.total > thresh.max) icon = "🟡";
      console.log(
        `    ${rd.name}: ${icon} ${rd.total} (st=${rd.inStorage} term=${rd.inTerminal})`,
      );
    }

    // Выявляем дисбаланс: есть комната с избытком и комната с дефицитом
    const haveExcess = roomData.filter(rd => rd.total > thresh.max);
    const haveDeficit = roomData.filter(rd => rd.total < thresh.min);

    if (haveExcess.length > 0 && haveDeficit.length > 0) {
      for (const from of haveExcess) {
        for (const to of haveDeficit) {
          const sendAmt = Math.min(
            from.total - thresh.max,
            thresh.min - to.total + 1000,
          );
          console.log(
            `    → ДИСБАЛАНС: ${from.name} → ${to.name} (можно отправить ~${sendAmt})`,
          );
          console.log(
            `      Команда: sendResource('${from.name}', '${to.name}', '${resource}', ${sendAmt})`,
          );
        }
      }
    }
  }

  // Показываем данные из resourceBalancer если уже запущен
  const balancerData = Memory.empire && Memory.empire.balancer;
  if (
    balancerData &&
    balancerData.transfers &&
    balancerData.transfers.length > 0
  ) {
    console.log(`\n  Запланированные transfers:`);
    for (const t of balancerData.transfers) {
      console.log(
        `    [${t.status}] ${t.resource} x${t.amount}: ${t.from} → ${t.to}`,
      );
    }
  }

  console.log(`======================================\n`);
};

// ── ИСТОРИЯ СОБЫТИЙ (без изменений) ───────────────────────────────────────

/**
 * @param {string} roomName — фильтр по комнате (опционально)
 * @param {number} limit    — сколько последних (default 20)
 *
 * @example
 * history()
 * history('E35S37')
 * history('E35S37', 10)
 */
global.history = function (roomName, limit) {
  const events = Logger.getEvents(roomName || null, limit || 20);

  const title = roomName
    ? `ИСТОРИЯ: ${roomName} (последние ${events.length})`
    : `ИСТОРИЯ ИМПЕРИИ (последние ${events.length})`;

  console.log(`\n========== ${title} ==========`);

  if (events.length === 0) {
    console.log("  нет событий");
  } else {
    for (const e of events) {
      const room = e.room ? `[${e.room}]` : "[global]";
      const ctx = e.ctx
        ? " | " +
          Object.entries(e.ctx)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")
        : "";
      console.log(`  t=${e.tick} ${room} [${e.type}] ${e.message}${ctx}`);
    }
  }
  console.log(`================================================\n`);
};

// ── ЗДОРОВЬЕ КОМНАТЫ (расширено v3.0) ────────────────────────────────────

/**
 * Быстрый статус комнаты: OK / WARN / ERROR по каждому контуру.
 * v3.0: добавлены Labs, Market, Balance.
 *
 * @param {string} roomName
 *
 * @example
 * roomHealth('E35S37')
 */
global.roomHealth = function (roomName) {
  const r = Game.rooms[roomName];
  if (!r) {
    console.log(`❌ комната ${roomName} недоступна`);
    return;
  }

  const checks = {};

  // ── Storage ──────────────────────────────────────────
  if (!r.storage) {
    checks.Storage = "ERROR";
  } else {
    const energy = r.storage.store[RESOURCE_ENERGY] || 0;
    checks.Storage = energy > 10000 ? "OK" : energy > 1000 ? "WARN" : "ERROR";
  }

  // ── Terminal ─────────────────────────────────────────
  if (!r.terminal) {
    checks.Terminal = "ERROR";
  } else {
    const used = r.terminal.store.getUsedCapacity();
    const cap = r.terminal.store.getCapacity();
    checks.Terminal = used / cap < 0.9 ? "OK" : "WARN";
  }

  // ── Factory ──────────────────────────────────────────
  const factoryData =
    Memory.empire &&
    Memory.empire.factory &&
    Memory.empire.factory.rooms &&
    Memory.empire.factory.rooms[roomName];

  if (!factoryData) {
    checks.Factory = "ERROR";
  } else {
    const status = factoryData.status;
    const stuckTicks = Game.time - (factoryData.updatedAt || Game.time);
    if (status === "error") {
      checks.Factory = "ERROR";
    } else if (status === "waiting_input" && stuckTicks > 100) {
      checks.Factory = "WARN";
    } else if (status === "idle" && !factoryData.task) {
      checks.Factory = "WARN";
    } else {
      checks.Factory = "OK";
    }
  }

  // ── Delivery ─────────────────────────────────────────
  const deliveries =
    Memory.empire &&
    Memory.empire.logistics &&
    Memory.empire.logistics.deliveries &&
    Memory.empire.logistics.deliveries[roomName];

  if (!deliveries) {
    checks.Delivery = "WARN";
  } else {
    const stuck = deliveries.filter(d => {
      if (d.status !== "assigned" && d.status !== "delivering") return false;
      return Game.time - (d.updatedAt || d.createdAt) > 100;
    });
    const active = deliveries.filter(
      d =>
        d.status === "queued" ||
        d.status === "assigned" ||
        d.status === "delivering",
    );
    checks.Delivery =
      stuck.length > 0 ? "WARN" : active.length > 0 ? "OK" : "WARN";
  }

  // ── Links ────────────────────────────────────────────
  const links = r.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_LINK,
  });

  if (links.length === 0) {
    checks.Links = "WARN";
  } else {
    const fullLinks = links.filter(
      l =>
        l.store[RESOURCE_ENERGY] >= l.store.getCapacity(RESOURCE_ENERGY) * 0.8,
    );
    const emptyLinks = links.filter(l => (l.store[RESOURCE_ENERGY] || 0) === 0);
    const stalled =
      fullLinks.length > 0 &&
      emptyLinks.length > 0 &&
      fullLinks[0].cooldown === 0;
    checks.Links = stalled ? "WARN" : "OK";
  }

  // ── Remote ───────────────────────────────────────────
  const remoteMiners = Object.values(Game.creeps).filter(
    c =>
      c.memory.role === "test_remoteMiner" &&
      (c.memory.target === roomName || c.room.name === roomName),
  );
  checks.Remote = remoteMiners.length > 0 ? "OK" : "WARN";

  // ── Labs [NEW v3.0] ──────────────────────────────────
  // Проверяем через labController
  const lcData =
    Memory.empire &&
    Memory.empire.labController &&
    Memory.empire.labController.rooms &&
    Memory.empire.labController.rooms[roomName];

  // Проверяем есть ли конфиги лаб в памяти комнаты
  const LAB_KEYS = ["labs", "labs2", "labs3", "labs4", "labs5"];
  const hasLabConfig = LAB_KEYS.some(k => r.memory[k] && r.memory[k].product);

  if (!hasLabConfig) {
    // Нет конфига — не считаем ошибкой, просто нет лаб
    checks.Labs = "WARN"; // нет конфига лаб
  } else if (!lcData) {
    checks.Labs = "WARN"; // данные ещё не посчитаны
  } else {
    const status = lcData.status;
    if (status === "error") {
      checks.Labs = "ERROR";
    } else if (status === "waiting_input") {
      checks.Labs = "WARN";
    } else {
      checks.Labs = "OK";
    }
  }

  // ── Market [NEW v3.0] ────────────────────────────────
  // Проверяем что marketManager работает и нет критических buy без исполнения
  const marketMeta = Memory.empire && Memory.empire.marketMeta;
  if (!marketMeta) {
    checks.Market = "WARN";
  } else {
    const stale = Game.time - (marketMeta.generatedAt || 0) > 200;
    if (stale) {
      checks.Market = "WARN"; // данные устарели
    } else {
      // Если есть критические buy — это WARN но не ERROR
      checks.Market = marketMeta.criticalBuyCount > 0 ? "WARN" : "OK";
    }
  }

  // ── Balance [NEW v3.0] ───────────────────────────────
  // Проверяем energy в storage — основной показатель баланса
  const energyOk = r.storage && (r.storage.store[RESOURCE_ENERGY] || 0) > 20000;
  const terminalOk =
    r.terminal &&
    r.terminal.store.getUsedCapacity() / r.terminal.store.getCapacity() < 0.85;
  checks.Balance = energyOk && terminalOk ? "OK" : "WARN";

  // ── ВЫВОД ────────────────────────────────────────────
  const icon = { OK: "✅", WARN: "⚠️ ", ERROR: "❌" };

  console.log(`\nROOM ${roomName}`);
  console.log(`──────────────────`);
  for (const [name, status] of Object.entries(checks)) {
    console.log(`  ${icon[status]} ${name.padEnd(10)}: ${status}`);
  }
  console.log(`──────────────────\n`);
};

// ══════════════════════════════════════════════════════
// РУЧНОЕ УПРАВЛЕНИЕ
// ══════════════════════════════════════════════════════

global.deliver = function (roomName, resource, target, targetLabId, amount) {
  if (!Memory.empire || !Memory.empire.logistics) {
    console.log("❌ logistics не инициализирована");
    return;
  }

  if (!Memory.empire.logistics.deliveries[roomName]) {
    Memory.empire.logistics.deliveries[roomName] = [];
  }

  Memory.empire.logistics.deliveries[roomName].push({
    resource,
    target,
    targetLabId: targetLabId || null,
    amount: amount || 1000,
    priority: "high",
    status: "queued",
    createdAt: Game.time,
    updatedAt: Game.time,
    assignedTo: null,
  });

  Logger.event(
    "delivery_created",
    roomName,
    `ручная доставка ${resource} x${amount} → ${target}`,
  );
  console.log(
    `✅ создана доставка: ${resource} x${amount} → ${target} в ${roomName}`,
  );
};

/**
 * Ручная отправка ресурса через terminal из одной комнаты в другую.
 * Терминал должен быть доступен и не на cooldown.
 *
 * @param {string} fromRoom   — откуда отправить
 * @param {string} toRoom     — куда отправить
 * @param {string} resource   — ресурс (например 'KH', RESOURCE_KEANIUM_HYDRIDE)
 * @param {number} amount     — количество
 *
 * @example
 * sendResource('E35S37', 'E37S37', 'KH', 3000)
 */
global.sendResource = function (fromRoom, toRoom, resource, amount) {
  const r = Game.rooms[fromRoom];
  if (!r) {
    console.log(`❌ комната ${fromRoom} недоступна`);
    return;
  }

  const term = r.terminal;
  if (!term) {
    console.log(`❌ терминал в ${fromRoom} не найден`);
    return;
  }

  if (term.cooldown > 0) {
    console.log(`❌ терминал на cooldown: ${term.cooldown} тиков`);
    return;
  }

  const inTerminal = term.store[resource] || 0;
  if (inTerminal < amount) {
    console.log(
      `❌ в терминале ${fromRoom} только ${inTerminal} ${resource} (нужно ${amount})`,
    );
    return;
  }

  const result = term.send(resource, amount, toRoom);
  if (result === OK) {
    Logger.event(
      "transfer_created",
      fromRoom,
      `ручная отправка ${resource} x${amount} → ${toRoom}`,
    );
    console.log(
      `✅ отправлено: ${resource} x${amount} из ${fromRoom} → ${toRoom}`,
    );
  } else {
    Logger.event(
      "terminal_send_failed",
      fromRoom,
      `ошибка отправки ${resource} → ${toRoom}: ${result}`,
    );
    console.log(`❌ ошибка отправки: код ${result}`);
  }
};

global.clearCreep = function (creepName) {
  const creep = Game.creeps[creepName];
  if (!creep) {
    console.log(`❌ крип ${creepName} не найден`);
    return;
  }

  delete creep.memory.deliveryAssignment;
  delete creep.memory.deliveryState;
  delete creep.memory.task;
  delete creep.memory.taskTargetId;
  delete creep.memory.working;
  delete creep.memory._diag;

  Logger.event("manual_reset", creep.room.name, `сброс памяти ${creepName}`);
  console.log(`✅ память крипа ${creepName} сброшена`);
};

global.resetFactory = function (roomName) {
  if (
    !Memory.empire ||
    !Memory.empire.factory ||
    !Memory.empire.factory.rooms
  ) {
    console.log("❌ factory data не найдена");
    return;
  }

  const data = Memory.empire.factory.rooms[roomName];
  if (!data) {
    console.log(`❌ фабрика ${roomName} не найдена`);
    return;
  }

  data.status = "queued";
  data.updatedAt = Game.time;
  Logger.event("manual_reset", roomName, "factory сброшена в queued");
  console.log(`✅ фабрика ${roomName} сброшена в queued`);
};

global.resetRoom = function (roomName) {
  if (!Memory.empire || !Memory.empire.logistics) {
    console.log("❌ logistics не инициализирована");
    return;
  }

  Memory.empire.logistics.deliveries[roomName] = [];
  Logger.event("manual_reset", roomName, "deliveries очищены");
  console.log(`✅ deliveries для ${roomName} очищены`);
};

global.killDelivery = function (roomName, deliveryId) {
  const list =
    Memory.empire &&
    Memory.empire.logistics &&
    Memory.empire.logistics.deliveries &&
    Memory.empire.logistics.deliveries[roomName];

  if (!list) {
    console.log(`❌ нет deliveries для ${roomName}`);
    return;
  }

  const d = list.find(d => d.createdAt === deliveryId);
  if (!d) {
    console.log(`❌ delivery ${deliveryId} не найдена`);
    return;
  }

  d.status = "cancelled";
  d.updatedAt = Game.time;
  Logger.event(
    "delivery_cancelled",
    roomName,
    `delivery ${deliveryId} отменена вручную`,
  );
  console.log(`✅ delivery ${deliveryId} отменена`);
};

global.setFactoryProduct = function (roomName, product) {
  const room = Game.rooms[roomName];
  if (!room) {
    console.log(`❌ комната ${roomName} недоступна`);
    return;
  }

  room.memory.factoryProduct = product;
  Logger.event(
    "factory_config",
    roomName,
    `продукт фабрики изменён на ${product}`,
  );
  console.log(`✅ фабрика ${roomName}: продукт установлен → ${product}`);
};

// ══════════════════════════════════════════════════════
// ЛОГГЕР
// ══════════════════════════════════════════════════════

global.diagOn = function () {
  Logger.diagOn();
};
global.diagOff = function () {
  Logger.diagOff();
};

// ══════════════════════════════════════════════════════
// АВТОРЕФИЛЛ (без изменений)
// ══════════════════════════════════════════════════════

global.autoRefill = function () {
  const MIN_AMOUNT = 10000;
  const resources = [RESOURCE_ZYNTHIUM, RESOURCE_OXYGEN];

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my || !room.terminal) continue;

    for (const resource of resources) {
      const amount = room.terminal.store[resource] || 0;
      if (amount < MIN_AMOUNT) {
        const needed = MIN_AMOUNT - amount;
        const orders = Game.market
          .getAllOrders({
            type: ORDER_SELL,
            resourceType: resource,
          })
          .sort((a, b) => a.price - b.price);

        if (orders.length > 0) {
          const result = Game.market.deal(
            orders[0].id,
            Math.min(needed, orders[0].amount),
            roomName,
          );
          if (result === OK) {
            console.log(`✅ autoRefill: купили ${resource} для ${roomName}`);
          }
        }
      }
    }
  }
};

module.exports = {};
