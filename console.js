/**
 * ===================================================
 * CONSOLE.JS — Ручное управление и диагностика
 * ===================================================
 * VERSION: 2.1
 *
 * ИЗМЕНЕНИЯ v2.1:
 * - Добавлен history() — история событий
 * - Добавлен roomHealth() — быстрый статус комнаты
 * - Добавлен setFactoryProduct() — смена продукта фабрики
 * - Все команды совместимы с новым Logger.event()
 *
 * КОМАНДЫ ДИАГНОСТИКИ:
 *   empire()                    — сводка по всей империи
 *   room('E35S37')              — состояние комнаты
 *   diag('E35S37')              — полная диагностика
 *   creepDiag('name')           — диагностика крипа
 *   factory('E35S37')           — состояние фабрики
 *   links('E35S37')             — состояние линков
 *   logistics()                 — все активные deliveries
 *   history()                   — последние 20 событий
 *   history('E35S37')           — события комнаты
 *   history('E35S37', 10)       — последние N событий
 *   roomHealth('E35S37')        — быстрый статус комнаты
 *
 * КОМАНДЫ УПРАВЛЕНИЯ:
 *   deliver(room, res, target, labId, amount)
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
// ДИАГНОСТИКА
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

// ── ИСТОРИЯ СОБЫТИЙ ────────────────────────────────────────────────────────

/**
 * Показать историю событий.
 *
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

// ── ЗДОРОВЬЕ КОМНАТЫ ───────────────────────────────────────────────────────

/**
 * Быстрый статус комнаты: OK / WARN / ERROR по каждому контуру.
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
    checks.Storage = "ERROR"; // нет хранилища
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
    checks.Factory = "ERROR"; // нет данных
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

/**
 * Сменить продукт фабрики в комнате.
 * DeliveryWorker и FactoryDirector читают room.memory.factoryProduct.
 *
 * @param {string} roomName
 * @param {string} product — константа ресурса (например RESOURCE_BATTERY)
 *
 * @example
 * setFactoryProduct('E35S37', RESOURCE_BATTERY)
 * setFactoryProduct('E35S37', 'battery')
 */
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
// АВТОРЕФИЛЛ
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
