/**
 * ===================================================
 * LOGISTICSDIRECTOR.JS — Логистический оркестратор империи
 * ===================================================
 * VERSION: 2.2
 *
 * ИЗМЕНЕНИЯ v2.2:
 * - Исправлен порядок объявления targetLabId и priority
 *   (перенесены ДО блока проверки available)
 *
 * ИЗМЕНЕНИЯ v2.1:
 * - Исправлено чтение lab IDs из room.memory конфига
 *
 * ИЗМЕНЕНИЯ v2.0:
 * - Добавлен REAGENT → LAB delivery type
 * - Добавлен status: waiting_terminal
 * - Сохранены все механизмы v1.3
 * ===================================================
 */

const factoryDirector = require("./factoryDirector");
const labController = require("./labController");
const empireResourceRegistry = require("./empireResourceRegistry");
const economyManager = require("./economyManager");

const UPDATE_INTERVAL = 20;
const UPDATE_OFFSET = 3;
const LOGISTICS_VERSION = 6;

const DELIVERY_STATUS = {
  QUEUED: "queued",
  ASSIGNED: "assigned",
  DELIVERING: "delivering",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const PRIORITY = {
  HIGH: "high",
  NORMAL: "normal",
};

const DELIVERY_AMOUNT = 5000;
const LAB_DELIVERY_AMOUNT = 1000;
const CLEANUP_AFTER_TICKS = 50;
const STALE_TIMEOUT = 100;

const FACTORY_INPUT_MAP = {
  [RESOURCE_BATTERY]: RESOURCE_ENERGY,
  [RESOURCE_ENERGY]: RESOURCE_BATTERY,
};

const LAB_CONFIG_KEYS = ["labs", "labs2", "labs3", "labs4", "labs5"];

const logisticsDirector = {
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (Game.time % UPDATE_INTERVAL !== UPDATE_OFFSET) return;
    this.plan();
  },

  _getLabConfigs: function (room) {
    const configs = {};
    const mem = room.memory;
    for (const key of LAB_CONFIG_KEYS) {
      if (mem[key] && mem[key].product) {
        configs[key] = mem[key];
      }
    }
    return configs;
  },

  plan: function () {
    const startCpu = Game.cpu.getUsed();

    if (!Memory.empire.logistics) {
      Memory.empire.logistics = { deliveries: {} };
    }

    const deliveries = Memory.empire.logistics.deliveries;

    let waitingFactoryCount = 0;
    let waitingLabCount = 0;
    let activeCount = 0;
    let createdCount = 0;
    let recoveredCount = 0;

    // ── CLEANUP ───────────────────────────────────────────────────────────
    for (const roomName in deliveries) {
      deliveries[roomName] = deliveries[roomName].filter(d => {
        const isDone =
          d.status === DELIVERY_STATUS.COMPLETED ||
          d.status === DELIVERY_STATUS.CANCELLED;
        const isOld =
          Game.time - (d.updatedAt || d.createdAt) > CLEANUP_AFTER_TICKS;
        return !(isDone && isOld);
      });
    }

    // ── STALE CHECK ───────────────────────────────────────────────────────
    for (const roomName in deliveries) {
      for (const d of deliveries[roomName]) {
        if (
          d.status !== DELIVERY_STATUS.ASSIGNED &&
          d.status !== DELIVERY_STATUS.DELIVERING
        )
          continue;

        const workerDead = d.assignedTo && !Game.creeps[d.assignedTo];
        const lastUpdate = d.updatedAt || d.createdAt;
        const isStale = Game.time - lastUpdate > STALE_TIMEOUT;

        if (workerDead || isStale) {
          const reason = workerDead ? "воркер мёртв" : "timeout";
          console.log(
            `[LogisticsDirector] ♻️  ${roomName}: delivery восстановлена` +
              ` (${reason}, был: ${d.assignedTo}, статус: ${d.status})`,
          );
          d.status = DELIVERY_STATUS.QUEUED;
          d.assignedTo = null;
          d.updatedAt = Game.time;
          recoveredCount++;
        }
      }
    }

    // ── WAITING_TERMINAL → QUEUED когда ресурс появился ──────────────────
    for (const roomName in deliveries) {
      for (const d of deliveries[roomName]) {
        if (d.status !== "waiting_terminal") continue;

        const available = empireResourceRegistry.getInRoom(
          d.resource,
          roomName,
        );
        if (available >= LAB_DELIVERY_AMOUNT) {
          d.status = DELIVERY_STATUS.QUEUED;
          d.updatedAt = Game.time;
          console.log(
            `[LogisticsDirector] ✅ ${roomName}: ${d.resource}` +
              ` прибыл — delivery переведена в queued`,
          );
        }
      }
    }

    // ── FACTORY DELIVERIES ────────────────────────────────────────────────
    const factoryRooms = Memory.empire.factory
      ? Memory.empire.factory.rooms
      : {};

    for (const roomName in factoryRooms) {
      const roomData = factoryRooms[roomName];

      if (roomData.status !== "waiting_input") continue;
      if (!roomData.task) continue;

      waitingFactoryCount++;

      const inputResource = FACTORY_INPUT_MAP[roomData.task.resource];
      if (!inputResource) continue;
      if (inputResource !== RESOURCE_ENERGY) continue;

      if (!deliveries[roomName]) deliveries[roomName] = [];

      const alreadyActive = deliveries[roomName].some(
        d =>
          d.resource === inputResource &&
          d.target === "factory" &&
          (d.status === DELIVERY_STATUS.QUEUED ||
            d.status === DELIVERY_STATUS.ASSIGNED ||
            d.status === DELIVERY_STATUS.DELIVERING),
      );

      if (alreadyActive) {
        activeCount++;
        continue;
      }

      const priority = economyManager.isCritical(roomData.task.resource)
        ? PRIORITY.HIGH
        : PRIORITY.NORMAL;

      deliveries[roomName].push({
        resource: inputResource,
        target: "factory",
        targetLabId: null,
        amount: DELIVERY_AMOUNT,
        priority,
        status: DELIVERY_STATUS.QUEUED,
        createdAt: Game.time,
        updatedAt: Game.time,
        assignedTo: null,
      });

      createdCount++;
      console.log(
        `[LogisticsDirector] 📦 ${roomName}: создана доставка` +
          ` ${inputResource} x${DELIVERY_AMOUNT} → factory [${priority}]`,
      );
    }

    // ── LAB REAGENT DELIVERIES ────────────────────────────────────────────
    const labStatuses = labController.getAllStatuses();

    for (const roomName in labStatuses) {
      const roomData = labStatuses[roomName];
      if (!roomData.slots) continue;

      const room = Game.rooms[roomName];
      if (!room) continue;

      const labConfigs = this._getLabConfigs(room);

      for (const slot of roomData.slots) {
        if (slot.status !== "waiting_input") continue;
        if (!slot.missing || slot.missing.length === 0) continue;

        waitingLabCount++;

        if (!deliveries[roomName]) deliveries[roomName] = [];

        const config = labConfigs[slot.slot];

        for (const resource of slot.missing) {
          // ── Определяем targetLabId и priority ДО проверки available ──
          let targetLabId = null;
          if (config) {
            if (config.reagent1 === resource) {
              targetLabId = config.lab1;
            } else if (config.reagent2 === resource) {
              targetLabId = config.lab2;
            }
          }

          const priority = economyManager.isCritical(resource)
            ? PRIORITY.HIGH
            : PRIORITY.NORMAL;

          // ── Проверяем наличие локально ────────────────────────────────
          const available = empireResourceRegistry.getInRoom(
            resource,
            roomName,
          );

          if (available < LAB_DELIVERY_AMOUNT) {
            // Нет локально — проверяем в империи
            const empireTotal = empireResourceRegistry.getTotal
              ? empireResourceRegistry.getTotal(resource)
              : 0;

            if (empireTotal >= LAB_DELIVERY_AMOUNT) {
              // Ресурс есть в империи — ждём terminalManager
              const alreadyWaiting = deliveries[roomName].some(
                d =>
                  d.resource === resource &&
                  d.target === "lab" &&
                  d.status === "waiting_terminal",
              );

              if (!alreadyWaiting) {
                deliveries[roomName].push({
                  resource,
                  target: "lab",
                  targetLabId,
                  amount: LAB_DELIVERY_AMOUNT,
                  priority,
                  status: "waiting_terminal",
                  createdAt: Game.time,
                  updatedAt: Game.time,
                  assignedTo: null,
                });

                if (Game.time % 100 <= UPDATE_OFFSET) {
                  console.log(
                    `[LogisticsDirector] ⏳ ${roomName}: ${resource}` +
                      ` ждёт terminalManager (в империи: ${empireTotal})`,
                  );
                }
              }
            } else {
              // Ресурса нет нигде
              if (Game.time % 100 <= UPDATE_OFFSET) {
                console.log(
                  `[LogisticsDirector] ⚠️  ${roomName}: нет ${resource}` +
                    ` нигде в империи`,
                );
              }
            }
            continue;
          }

          // ── Ресурс есть локально — создаём delivery ──────────────────
          const alreadyActive = deliveries[roomName].some(
            d =>
              d.resource === resource &&
              d.target === "lab" &&
              d.targetLabId === targetLabId &&
              (d.status === DELIVERY_STATUS.QUEUED ||
                d.status === DELIVERY_STATUS.ASSIGNED ||
                d.status === DELIVERY_STATUS.DELIVERING),
          );

          if (alreadyActive) {
            activeCount++;
            continue;
          }

          deliveries[roomName].push({
            resource,
            target: "lab",
            targetLabId,
            amount: LAB_DELIVERY_AMOUNT,
            priority,
            status: DELIVERY_STATUS.QUEUED,
            createdAt: Game.time,
            updatedAt: Game.time,
            assignedTo: null,
          });

          createdCount++;
          console.log(
            `[LogisticsDirector] 🧪 ${roomName}: создана доставка` +
              ` ${resource} x${LAB_DELIVERY_AMOUNT} → lab` +
              ` [${priority}] labId=${targetLabId}`,
          );
        }
      }
    }

    // ── ПУБЛИКАЦИЯ ────────────────────────────────────────────────────────
    const planDuration = Game.cpu.getUsed() - startCpu;

    for (const roomName in deliveries) {
      activeCount += deliveries[roomName].filter(
        d =>
          d.status === DELIVERY_STATUS.QUEUED ||
          d.status === DELIVERY_STATUS.ASSIGNED ||
          d.status === DELIVERY_STATUS.DELIVERING,
      ).length;
    }

    Memory.empire.logistics.deliveries = deliveries;
    Memory.empire.logisticsMeta = {
      version: LOGISTICS_VERSION,
      generatedAt: Game.time,
      waitingFactoryCount,
      waitingLabCount,
      activeCount,
      createdCount,
      recoveredCount,
      planDuration: Math.round(planDuration * 1000) / 1000,
    };

    if (Game.time % 100 <= UPDATE_OFFSET) {
      console.log(
        `[LogisticsDirector] 🚚 factory_waiting=${waitingFactoryCount}` +
          ` lab_waiting=${waitingLabCount}` +
          ` active=${activeCount} created=${createdCount}` +
          ` recovered=${recoveredCount}` +
          ` | CPU: ${planDuration.toFixed(3)}ms`,
      );
    }
  },

  // ── ПУБЛИЧНОЕ API ─────────────────────────────────────────────────────────

  getQueuedDelivery: function (roomName) {
    if (!Memory.empire?.logistics?.deliveries) return null;
    const list = Memory.empire.logistics.deliveries[roomName];
    if (!list) return null;
    return list.find(d => d.status === DELIVERY_STATUS.QUEUED) || null;
  },

  getDeliveries: function (roomName) {
    if (!Memory.empire?.logistics?.deliveries) return [];
    return Memory.empire.logistics.deliveries[roomName] || [];
  },

  getLabDeliveries: function (roomName) {
    return this.getDeliveries(roomName).filter(d => d.target === "lab");
  },

  hasDeliveries: function (roomName) {
    return this.getDeliveries(roomName).some(
      d =>
        d.status === DELIVERY_STATUS.QUEUED ||
        d.status === DELIVERY_STATUS.ASSIGNED ||
        d.status === DELIVERY_STATUS.DELIVERING,
    );
  },

  getAllDeliveries: function () {
    if (!Memory.empire?.logistics?.deliveries) return {};
    return Memory.empire.logistics.deliveries;
  },

  getMeta: function () {
    return (Memory.empire && Memory.empire.logisticsMeta) || {};
  },
};

module.exports = logisticsDirector;
