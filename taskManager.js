/**
 * ===================================================
 * TASKMANAGER.JS — Менеджер задач (Task-based система)
 * ===================================================
 * Приоритеты задач (сверху вниз):
 * 1. TOWER       — заправить башни ниже 50%
 * 2. TERMINAL    — заправить терминал если энергии мало
 * 3. SUPPLY      — заправить spawn/extensions если не заполнены
 * 4. REPAIR      — починить повреждённые структуры (hits < 80%)
 * 5. BUILD       — построить стройплощадки
 * 6. UPGRADE     — только если ticksToDowngrade < 100000
 *
 * UNLOAD_LINK вынесен в role.worker.js (ШАГ 0) — выполняется
 * вне цикла working, один воркер за раз через блокировку памяти.
 *
 * Правила блокировки:
 * - TOWER, TERMINAL, REPAIR, BUILD, UPGRADE — блокируются:
 *   только один воркер на задачу
 * - SUPPLY — НЕ блокируется: несколько воркеров могут
 *   заправлять разные spawn/extensions одновременно
 * ===================================================
 */

const TASKS = {
  TOWER: "tower",
  TERMINAL: "terminal",
  SUPPLY: "supply",
  REPAIR: "repair",
  BUILD: "build",
  UPGRADE: "upgrade",
};

const TERMINAL_ENERGY_MIN = 20000;
const TOWER_ENERGY_THRESHOLD = 0.5;

const taskManager = {
  getTasks: function (room, creep, takenTasks) {
    const tasks = [];
    const taken = takenTasks || new Set();

    // ── ЗАДАЧА TOWER ──────────────────────────────────────────────────────
    // Башня ниже 50% — заправляем немедленно. Один воркер на задачу.
    if (!taken.has(TASKS.TOWER)) {
      const towers = room._towers || [];
      const urgentTower = towers.find(
        t =>
          t.store[RESOURCE_ENERGY] <
          t.store.getCapacity(RESOURCE_ENERGY) * TOWER_ENERGY_THRESHOLD,
      );
      if (urgentTower) {
        tasks.push({ type: TASKS.TOWER, targetId: urgentTower.id });
      }
    }

    // ── ЗАДАЧА TERMINAL ───────────────────────────────────────────────────
    // Терминал ниже минимума. Один воркер на задачу.
    if (!taken.has(TASKS.TERMINAL)) {
      const terminal = room.terminal;
      const storage = room.storage;
      if (
        terminal &&
        storage &&
        (terminal.store[RESOURCE_ENERGY] || 0) < TERMINAL_ENERGY_MIN &&
        terminal.store.getFreeCapacity() > 0 &&
        storage.store[RESOURCE_ENERGY] > 0
      ) {
        tasks.push({ type: TASKS.TERMINAL, targetId: terminal.id });
      }
    }

    // ── ЗАДАЧА SUPPLY ─────────────────────────────────────────────────────
    // НЕ блокируется — несколько воркеров берут ближайшие цели.
    // Каждый идёт к своему ближайшему spawn/extension.
    const energyTargets = room._energyTargets || [];
    if (energyTargets.length > 0) {
      const target = creep
        ? creep.pos.findClosestByRange(energyTargets)
        : energyTargets[0];
      if (target) {
        tasks.push({ type: TASKS.SUPPLY, targetId: target.id });
      }
    }

    // ── ЗАДАЧА REPAIR ─────────────────────────────────────────────────────
    if (!taken.has(TASKS.REPAIR)) {
      const needsRepair =
        room.memory.needsRepair !== undefined
          ? room.memory.needsRepair
          : room.find(FIND_STRUCTURES, {
              filter: s =>
                s.hits < s.hitsMax * 0.8 &&
                s.structureType !== STRUCTURE_WALL &&
                s.structureType !== STRUCTURE_RAMPART,
            }).length > 0;

      if (needsRepair) {
        const target = creep
          ? creep.pos.findClosestByRange(FIND_STRUCTURES, {
              filter: s =>
                s.hits < s.hitsMax * 0.8 &&
                s.structureType !== STRUCTURE_WALL &&
                s.structureType !== STRUCTURE_RAMPART,
            })
          : null;
        if (target) {
          tasks.push({ type: TASKS.REPAIR, targetId: target.id });
        }
      }
    }

    // ── ЗАДАЧА BUILD ──────────────────────────────────────────────────────
    if (!taken.has(TASKS.BUILD)) {
      const hasSites =
        room.memory.hasSites !== undefined
          ? room.memory.hasSites
          : room.find(FIND_CONSTRUCTION_SITES).length > 0;

      if (hasSites) {
        const site = creep
          ? creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES)
          : room.find(FIND_CONSTRUCTION_SITES)[0];
        if (site) {
          tasks.push({ type: TASKS.BUILD, targetId: site.id });
        }
      }
    }

    // ── ЗАДАЧА UPGRADE ────────────────────────────────────────────────────
    if (!taken.has(TASKS.UPGRADE)) {
      const controller = room.controller;
      if (controller && controller.ticksToDowngrade < 100000) {
        tasks.push({ type: TASKS.UPGRADE, targetId: controller.id });
      }
    }

    return tasks;
  },

  /**
   * Назначает крипу первую доступную задачу.
   * SUPPLY не блокируется — несколько воркеров могут выполнять одновременно.
   * Остальные задачи блокируются — один воркер на задачу.
   */
  assignTask: function (creep, room) {
    if (creep.memory.task) return;

    // Собираем занятые задачи других воркеров — кроме SUPPLY
    const takenTasks = new Set();
    for (const name in Game.creeps) {
      const other = Game.creeps[name];
      if (
        other.name !== creep.name &&
        other.room.name === room.name &&
        other.memory.role === creep.memory.role &&
        other.memory.task &&
        other.memory.task !== TASKS.SUPPLY // SUPPLY не блокируем
      ) {
        takenTasks.add(other.memory.task);
      }
    }

    const tasks = this.getTasks(room, creep, takenTasks);

    if (tasks.length === 0) {
      creep.say("💤 жду");
      return;
    }

    const task = tasks[0];
    creep.memory.task = task.type;
    creep.memory.taskTargetId = task.targetId;
  },
};

module.exports = { taskManager, TASKS };
