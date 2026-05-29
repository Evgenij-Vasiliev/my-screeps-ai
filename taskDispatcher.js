/**
 * ===================================================
 * TASKDISPATCHER.JS — Task Coordination Layer
 * ===================================================
 * VERSION: 1.4
 *
 * ИЗМЕНЕНИЯ v1.4:
 * - Убран assignNext() — больше не нужен.
 *   Теперь factory_cycle это одно задание на весь цикл.
 *   Воркер сам делает полный цикл внутри одного задания.
 * - Убрана сортировка battery→storage — такого типа больше нет.
 * - Восстановлена простая очередь: HIGH → NORMAL.
 * ===================================================
 */

const UPDATE_INTERVAL = 5;
const DISPATCHER_VERSION = 4;
const STALE_TIMEOUT = 200; // factory_cycle длиннее обычной доставки
const DELIVERY_ROLE = "test_deliveryWorker";

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

const taskDispatcher = {
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (!Memory.empire.dispatcher) {
      Memory.empire.dispatcher = { assignments: {} };
    }
    if (Game.time % UPDATE_INTERVAL !== 0) return;
    this._dispatch();
  },

  _dispatch: function () {
    const startCpu = Game.cpu.getUsed();

    const deliveries =
      Memory.empire.logistics && Memory.empire.logistics.deliveries
        ? Memory.empire.logistics.deliveries
        : null;

    if (!deliveries) return;

    const recoveredCount = this._recoverStale(deliveries);
    const queue = this._buildQueue(deliveries);

    const idleWorkers = Object.values(Game.creeps).filter(
      c => c.memory.role === DELIVERY_ROLE && !c.memory.deliveryAssignment,
    );

    const idleCountBefore = idleWorkers.length;
    let assignedCount = 0;
    const assignments = Memory.empire.dispatcher.assignments;

    for (let i = 0; i < queue.length && idleWorkers.length > 0; i++) {
      const { roomName, delivery } = queue[i];
      const worker = idleWorkers.shift();

      delivery.status = DELIVERY_STATUS.ASSIGNED;
      delivery.assignedTo = worker.name;
      delivery.assignedAt = Game.time;
      delivery.updatedAt = Game.time;

      worker.memory.deliveryAssignment = {
        roomName,
        deliveryId: delivery.createdAt,
        resource: delivery.resource,
        amount: delivery.amount,
        target: delivery.target,
        targetLabId: delivery.targetLabId || null,
      };

      const key = `delivery_${delivery.createdAt}`;
      assignments[key] = {
        creep: worker.name,
        assignedAt: Game.time,
        roomName,
        deliveryId: delivery.createdAt,
        resource: delivery.resource,
        target: delivery.target,
      };

      assignedCount++;
      console.log(
        `[TaskDispatcher] ✅ ${worker.name} → ${delivery.target}` +
          ` [${delivery.priority}] room=${roomName}`,
      );
    }

    this._cleanupAssignments(assignments, deliveries);

    const planDuration = Game.cpu.getUsed() - startCpu;
    Memory.empire.dispatcherMeta = {
      version: DISPATCHER_VERSION,
      generatedAt: Game.time,
      queuedCount: queue.length,
      idleWorkers: idleCountBefore,
      assignedCount,
      recoveredCount,
      planDuration: Math.round(planDuration * 1000) / 1000,
    };

    if (Game.time % 50 === 0) {
      console.log(
        `[TaskDispatcher] 📋 queued=${queue.length} idle=${idleCountBefore}` +
          ` assigned=${assignedCount} recovered=${recoveredCount}` +
          ` | CPU: ${planDuration.toFixed(3)}ms`,
      );
    }
  },

  _recoverStale: function (deliveries) {
    let recoveredCount = 0;
    const assignments = Memory.empire.dispatcher.assignments;

    for (const key in assignments) {
      const record = assignments[key];

      const workerDead = !Game.creeps[record.creep];
      const isStale = Game.time - record.assignedAt > STALE_TIMEOUT;

      const roomDeliveries = deliveries[record.roomName];
      if (!roomDeliveries) {
        delete assignments[key];
        continue;
      }

      const delivery = roomDeliveries.find(
        d => d.createdAt === record.deliveryId,
      );

      if (
        !delivery ||
        delivery.status === DELIVERY_STATUS.COMPLETED ||
        delivery.status === DELIVERY_STATUS.CANCELLED
      ) {
        if (!workerDead && Game.creeps[record.creep]) {
          delete Game.creeps[record.creep].memory.deliveryAssignment;
        }
        delete assignments[key];
        continue;
      }

      if (workerDead || isStale) {
        const reason = workerDead ? "воркер мёртв" : "timeout";
        console.log(
          `[TaskDispatcher] ♻️  Восстановление: ${record.target} room=${record.roomName} (${reason})`,
        );

        delivery.status = DELIVERY_STATUS.QUEUED;
        delivery.updatedAt = Game.time;
        delete delivery.assignedTo;
        delete delivery.assignedAt;

        if (!workerDead && Game.creeps[record.creep]) {
          delete Game.creeps[record.creep].memory.deliveryAssignment;
        }

        delete assignments[key];
        recoveredCount++;
      }
    }

    return recoveredCount;
  },

  _buildQueue: function (deliveries) {
    const high = [];
    const normal = [];

    for (const roomName in deliveries) {
      for (const delivery of deliveries[roomName]) {
        if (delivery.status !== DELIVERY_STATUS.QUEUED) continue;
        const item = { roomName, delivery };
        if (delivery.priority === PRIORITY.HIGH) high.push(item);
        else normal.push(item);
      }
    }

    return [...high, ...normal];
  },

  _cleanupAssignments: function (assignments, deliveries) {
    for (const key in assignments) {
      const record = assignments[key];
      const roomDeliveries = deliveries[record.roomName];
      if (!roomDeliveries) {
        delete assignments[key];
        continue;
      }
      const delivery = roomDeliveries.find(
        d => d.createdAt === record.deliveryId,
      );
      if (
        !delivery ||
        delivery.status === DELIVERY_STATUS.COMPLETED ||
        delivery.status === DELIVERY_STATUS.CANCELLED
      ) {
        delete assignments[key];
      }
    }
  },

  getAssignment: function (n) {
    const c = Game.creeps[n];
    return c ? c.memory.deliveryAssignment || null : null;
  },
  hasAssignment: function (n) {
    return this.getAssignment(n) !== null;
  },
  getAssignments: function () {
    return Memory.empire?.dispatcher?.assignments || {};
  },
  getMeta: function () {
    return Memory.empire?.dispatcherMeta || {};
  },
};

module.exports = taskDispatcher;
