/**
 * ===================================================
 * TASKMANAGER.JS — Менеджер задач воркера
 * ===================================================
 * VERSION: 2.0
 *
 * ИЗМЕНЕНИЯ v2.0:
 * - Удалены TOWER и TERMINAL — ими занимается role.towerSupplier
 * - Удалён UNLOAD_LINK — им занимается role.towerSupplier
 * - Воркер отвечает только за:
 *   SUPPLY → REPAIR → BUILD → UPGRADE
 *
 * Приоритеты:
 * 1. SUPPLY  — заправить spawn/extensions
 * 2. REPAIR  — починить повреждённые структуры
 * 3. BUILD   — построить стройплощадки
 * 4. UPGRADE — только если ticksToDowngrade < 100000
 *
 * Блокировка:
 * - REPAIR, BUILD, UPGRADE — один воркер на задачу
 * - SUPPLY — не блокируется
 * ===================================================
 */

const TASKS = {
  SUPPLY: "supply",
  REPAIR: "repair",
  BUILD: "build",
  UPGRADE: "upgrade",
};

const taskManager = {
  getTasks: function (room, creep, takenTasks) {
    const tasks = [];
    const taken = takenTasks || new Set();

    // ── SUPPLY ────────────────────────────────────────────────────────────
    // Не блокируется — каждый воркер берёт ближайший spawn/extension.
    const energyTargets = room._energyTargets || [];
    if (energyTargets.length > 0) {
      const target = creep
        ? creep.pos.findClosestByRange(energyTargets)
        : energyTargets[0];
      if (target) {
        tasks.push({ type: TASKS.SUPPLY, targetId: target.id });
      }
    }

    // ── REPAIR ────────────────────────────────────────────────────────────
    // Один воркер на задачу.
    if (!taken.has(TASKS.REPAIR)) {
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

    // ── BUILD ─────────────────────────────────────────────────────────────
    // Один воркер на задачу.
    if (!taken.has(TASKS.BUILD)) {
      const site = creep
        ? creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES)
        : room.find(FIND_CONSTRUCTION_SITES)[0];
      if (site) {
        tasks.push({ type: TASKS.BUILD, targetId: site.id });
      }
    }

    // ── UPGRADE ───────────────────────────────────────────────────────────
    // Только если контроллер близко к даунгрейду.
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
        other.memory.task !== TASKS.SUPPLY
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
