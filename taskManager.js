/**
 * ===================================================
 * TASKMANAGER.JS — Менеджер задач воркера
 * ===================================================
 * VERSION: 3.2
 *
 * ИЗМЕНЕНИЯ v3.2:
 * - Если нет задач — воркер апгрейдит контроллер
 *   вместо того чтобы стоять и кричать "жду"
 *
 * Приоритеты:
 * 1. SUPPLY  — заправить spawn/extensions
 * 2. REPAIR  — починить (каждый свою уникальную цель)
 * 3. BUILD   — построить (каждый свою уникальную стройку)
 * 4. UPGRADE — только если ticksToDowngrade < 100000
 * 5. UPGRADE — fallback если нет других задач
 * ===================================================
 */

const TASKS = {
  SUPPLY: "supply",
  REPAIR: "repair",
  BUILD: "build",
  UPGRADE: "upgrade",
};

const taskManager = {
  getTasks: function (room, creep) {
    const tasks = [];

    // Собираем занятые цели других воркеров этой комнаты
    const takenTargets = new Set();
    for (const name in Game.creeps) {
      const other = Game.creeps[name];
      if (
        other.name !== creep.name &&
        other.room.name === room.name &&
        other.memory.role === creep.memory.role &&
        other.memory.taskTargetId
      ) {
        takenTargets.add(other.memory.taskTargetId);
      }
    }

    // ── SUPPLY ────────────────────────────────────────────────────────────
    // Каждый берёт ближайший свободный spawn/extension
    const energyTargets = (room._energyTargets || []).filter(
      t => !takenTargets.has(t.id),
    );
    if (energyTargets.length > 0) {
      const target = creep.pos.findClosestByRange(energyTargets);
      if (target) {
        tasks.push({ type: TASKS.SUPPLY, targetId: target.id });
      }
    }

    // ── REPAIR ────────────────────────────────────────────────────────────
    // Каждый берёт ближайшую свободную повреждённую структуру
    const repairTarget = creep.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: s =>
        s.hits < s.hitsMax * 0.8 &&
        s.structureType !== STRUCTURE_WALL &&
        s.structureType !== STRUCTURE_RAMPART &&
        !takenTargets.has(s.id),
    });
    if (repairTarget) {
      tasks.push({ type: TASKS.REPAIR, targetId: repairTarget.id });
    }

    // ── BUILD ─────────────────────────────────────────────────────────────
    // Каждый берёт ближайшую свободную стройплощадку
    const allSites = room
      .find(FIND_CONSTRUCTION_SITES)
      .filter(s => !takenTargets.has(s.id));
    if (allSites.length > 0) {
      const buildSite = creep.pos.findClosestByRange(allSites);
      if (buildSite) {
        tasks.push({ type: TASKS.BUILD, targetId: buildSite.id });
      }
    }

    // ── UPGRADE (приоритетный) ────────────────────────────────────────────
    // Если контроллер близко к даунгрейду — добавляем в приоритетную очередь
    const controller = room.controller;
    if (controller && controller.ticksToDowngrade < 100000) {
      tasks.push({ type: TASKS.UPGRADE, targetId: controller.id });
    }

    return tasks;
  },

  assignTask: function (creep, room) {
    if (creep.memory.task) return;

    const tasks = this.getTasks(room, creep);

    if (tasks.length === 0) {
      // Нет задач — апгрейдим контроллер вместо "жду"
      // Это fallback: воркер никогда не стоит без дела
      const controller = room.controller;
      if (controller) {
        creep.memory.task = TASKS.UPGRADE;
        creep.memory.taskTargetId = controller.id;
        creep.say("⬆️ фолбэк");
      } else {
        creep.say("💤 жду");
      }
      return;
    }

    const task = tasks[0];
    creep.memory.task = task.type;
    creep.memory.taskTargetId = task.targetId;
  },
};

module.exports = { taskManager, TASKS };
