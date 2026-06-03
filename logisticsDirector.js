/**
 * ===================================================
 * LOGISTICSDIRECTOR.JS — Логистический оркестратор империи
 * ===================================================
 * VERSION: 2.5
 *
 * ИЗМЕНЕНИЯ v2.5:
 * - ИСПРАВЛЕН разрыв цепочки waiting_terminal.
 *   Проблема: logisticsDirector создавал delivery со статусом
 *   waiting_terminal, но НЕ вызывал terminalManager.addNeed().
 *   terminalUnloader никогда не получал задачу на перенос ресурса.
 *   terminal.send() никогда не вызывался. Ресурс не приходил.
 *
 *   РЕШЕНИЕ: в блоке WAITING_TERMINAL добавлен вызов
 *   terminalManager.runLabSupply(donorRoom) для каждой
 *   зависшей доставки. Это заставляет terminalManager
 *   создать addNeed() и запустить цепочку отправки.
 * ===================================================
 */

const factoryDirector = require("./factoryDirector");
const labController = require("./labController");
const empireResourceRegistry = require("./empireResourceRegistry");
const economyManager = require("./economyManager");
// v2.5: добавляем импорт terminalManager для замыкания цепочки
const terminalManager = require("./terminalManager");

const UPDATE_INTERVAL = 5;
const UPDATE_OFFSET = 3;
const LOGISTICS_VERSION = 9; // v2.5

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
      if (mem[key] && mem[key].product) configs[key] = mem[key];
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
        const isStale =
          Game.time - (d.updatedAt || d.createdAt) > STALE_TIMEOUT;

        if (workerDead || isStale) {
          const reason = workerDead ? "воркер мёртв" : "timeout";
          console.log(
            `[LogisticsDirector] ♻️  ${roomName}: delivery восстановлена (${reason})`,
          );
          d.status = DELIVERY_STATUS.QUEUED;
          d.assignedTo = null;
          d.updatedAt = Game.time;
          recoveredCount++;
        }
      }
    }

    // ── WAITING_TERMINAL → QUEUED ─────────────────────────────────────────
    // v2.5: ИСПРАВЛЕНИЕ — добавлен вызов terminalManager для каждой
    // зависшей доставки. Раньше здесь только проверяли прибытие ресурса,
    // но никто не инициировал terminal.send(). Теперь при каждом цикле
    // планировщика мы явно просим terminalManager обработать доставку.
    for (const roomName in deliveries) {
      for (const d of deliveries[roomName]) {
        if (d.status !== "waiting_terminal") continue;

        // Проверяем: ресурс уже прибыл в целевую комнату?
        const available = empireResourceRegistry.getInRoom(
          d.resource,
          roomName,
        );

        if (available >= LAB_DELIVERY_AMOUNT) {
          // Ресурс прибыл — переводим в очередь на выдачу воркеру
          d.status = DELIVERY_STATUS.QUEUED;
          d.updatedAt = Game.time;
          console.log(
            `[LogisticsDirector] ✅ ${roomName}: ${d.resource} прибыл → queued`,
          );
          continue;
        }

        // v2.5: Ресурс ещё не прибыл — инициируем отправку через терминал.
        // Ищем комнату-донора и создаём задачу для terminalUnloader.
        // terminalManager.runLabSupply() умеет сам найти донора
        // и вызвать addNeed() → terminalUnloader перенесёт ресурс
        // из storage в terminal → terminal.send() отправит в целевую комнату.
        const targetRoom = Game.rooms[roomName];
        if (targetRoom) {
          // Вызываем runLabSupply для целевой комнаты —
          // он проверит нехватку реагентов и создаст задачу отправки
          terminalManager.runLabSupply(targetRoom);

          if (Game.time % 50 === 0) {
            console.log(
              `[LogisticsDirector] 📡 ${roomName}: ` +
                `инициирован terminal supply для ${d.resource}`,
            );
          }
        }
      }
    }

    // ── FACTORY CYCLE DELIVERIES ──────────────────────────────────────────
    const factoryRooms = Memory.empire.factory
      ? Memory.empire.factory.rooms
      : {};

    for (const roomName in factoryRooms) {
      const roomData = factoryRooms[roomName];
      if (!roomData.task) continue;

      waitingFactoryCount++;

      if (!deliveries[roomName]) deliveries[roomName] = [];

      const factoryActiveCount = deliveries[roomName].filter(
        d =>
          d.target === "factory_cycle" &&
          (d.status === DELIVERY_STATUS.QUEUED ||
            d.status === DELIVERY_STATUS.ASSIGNED ||
            d.status === DELIVERY_STATUS.DELIVERING),
      ).length;

      if (factoryActiveCount >= 2) {
        activeCount++;
        continue;
      }

      const priority = economyManager.isCritical(roomData.task.resource)
        ? PRIORITY.HIGH
        : PRIORITY.NORMAL;

      deliveries[roomName].push({
        resource: RESOURCE_ENERGY,
        target: "factory_cycle",
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
        `[LogisticsDirector] 🔄 ${roomName}: создан factory_cycle [${priority}]`,
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
          let targetLabId = null;
          if (config) {
            if (config.reagent1 === resource) targetLabId = config.lab1;
            else if (config.reagent2 === resource) targetLabId = config.lab2;
          }

          const priority = economyManager.isCritical(resource)
            ? PRIORITY.HIGH
            : PRIORITY.NORMAL;

          const available = empireResourceRegistry.getInRoom(
            resource,
            roomName,
          );

          if (available < LAB_DELIVERY_AMOUNT) {
            const empireTotal = empireResourceRegistry.getTotal
              ? empireResourceRegistry.getTotal(resource)
              : 0;

            if (empireTotal >= LAB_DELIVERY_AMOUNT) {
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

                // v2.5: сразу инициируем terminal supply —
                // не ждём следующего цикла планировщика
                const targetRoom = Game.rooms[roomName];
                if (targetRoom) {
                  terminalManager.runLabSupply(targetRoom);
                }

                console.log(
                  `[LogisticsDirector] 📡 ${roomName}: ` +
                    `waiting_terminal создан для ${resource} ` +
                    `→ terminal supply инициирован`,
                );
              }
            } else {
              if (Game.time % 100 <= UPDATE_OFFSET) {
                console.log(
                  `[LogisticsDirector] ⚠️  ${roomName}: нет ${resource} нигде`,
                );
              }
            }
            continue;
          }

          const hasQueued = deliveries[roomName].some(
            d =>
              d.resource === resource &&
              d.target === "lab" &&
              d.targetLabId === targetLabId &&
              (d.status === DELIVERY_STATUS.QUEUED ||
                d.status === DELIVERY_STATUS.ASSIGNED ||
                d.status === DELIVERY_STATUS.DELIVERING),
          );

          if (hasQueued) {
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
            `[LogisticsDirector] 🧪 ${roomName}: ${resource} → lab [${priority}]`,
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
        `[LogisticsDirector] 🚚 factory=${waitingFactoryCount}` +
          ` lab=${waitingLabCount} active=${activeCount}` +
          ` created=${createdCount} | CPU: ${planDuration.toFixed(3)}ms`,
      );
    }
  },

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
