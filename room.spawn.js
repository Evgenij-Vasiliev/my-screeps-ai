/**
 * ===================================================
 * ROOM.SPAWN.JS — Логика спавна крипов
 * ===================================================
 * VERSION: 1.1
 *
 * ИЗМЕНЕНИЯ v1.1 (ТЗ Архитектора №2):
 * - REMOTE_ROOMS и REMOTE_ROLES удалены отсюда
 * - Импортируются из room.remote.js
 *
 * Отвечает ТОЛЬКО за:
 * - подсчёт крипов по ролям
 * - определение кого спавнить
 * - приоритеты спавна
 * - вызов factory.run(spawn, roleData, index)
 *
 * НЕ отвечает за:
 * - towers, links, labs, terminal
 * - construction, repair, scouting
 * - remote rooms constants (room.remote.js)
 * - stats, economy
 * ===================================================
 */

const factory = require("./factory");
const roleTower = require("./role.tower");
const roomRemote = require("./room.remote");

// Импортируем remote константы из room.remote.js
const REMOTE_ROOMS = roomRemote.REMOTE_ROOMS;
const REMOTE_ROLES = roomRemote.REMOTE_ROLES;

// ── КОНСТАНТЫ ─────────────────────────────────────────────────────────────

// Комната с Nuker — только здесь спавним nukerFiller
const NUKER_ROOM = "E37S37";

// Пороги для определения переполнения терминала энергией
const TERMINAL_ENERGY_OVERFLOW = 50000;
const STORAGE_ENERGY_MIN = 30000;

/**
 * Роли которые спавнятся заранее до смерти старого крипа.
 * travelBuffer — сколько тиков нужно чтобы добраться до позиции.
 */
const EARLY_SPAWN_ROLES = {
  test_miner: { travelBuffer: 10 },
  test_remoteMiner: { travelBuffer: 80 },
};

/**
 * Роли у которых фиксированный sourceIndex.
 * Каждый крип этой роли привязан к конкретному источнику.
 */
const FIXED_SOURCE_ROLES = new Set([
  "test_hauler",
  "test_miner",
  "test_harvester",
]);

// ── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ───────────────────────────────────────────────

/**
 * Считает порог раннего спавна для роли.
 * Формула: длина тела × 3 тика + буфер дороги.
 */
function getEarlySpawnThreshold(role, travelBuffer, spawn) {
  try {
    const blueprint = factory.blueprints[role]
      ? factory.blueprints[role](spawn, 0, {})
      : null;
    if (blueprint && blueprint.body) {
      return blueprint.body.length * 3 + travelBuffer;
    }
  } catch (e) {}
  return 50 + travelBuffer;
}

/**
 * Проверяет есть ли конфиг лабораторий в памяти комнаты.
 */
function hasLabConfig(room) {
  const mem = room.memory;
  return !!(mem.labs || mem.labs2 || mem.labs3 || mem.labs4 || mem.labs5);
}

// ── ГЛАВНАЯ ФУНКЦИЯ ───────────────────────────────────────────────────────

const roomSpawn = {
  run: function (room) {
    // ── 1. КЭШИ КОМНАТЫ ───────────────────────────────────────────────
    const mineral = room.memory.mineralId
      ? Game.getObjectById(room.memory.mineralId)
      : null;
    const mineralAvailable = mineral && mineral.mineralAmount > 0;
    const hasSites = room.memory.hasSites || false;

    // ── 2. ПОРОГИ РАННЕГО СПАВНА ──────────────────────────────────────
    const spawnsForThreshold = room.find(FIND_MY_SPAWNS);
    const spawnForThreshold = spawnsForThreshold[0] || null;

    // Пересчитываем раз в 200 тиков
    if (!room.memory.earlySpawnThresholds || Game.time % 200 === 0) {
      room.memory.earlySpawnThresholds = {};
      for (const role in EARLY_SPAWN_ROLES) {
        const { travelBuffer } = EARLY_SPAWN_ROLES[role];
        room.memory.earlySpawnThresholds[role] = spawnForThreshold
          ? getEarlySpawnThreshold(role, travelBuffer, spawnForThreshold)
          : 50 + travelBuffer;
      }
    }
    const thresholds = room.memory.earlySpawnThresholds;

    // ── 3. ПОДСЧЁТ КРИПОВ ─────────────────────────────────────────────
    const localGroups = {}; // крипы в этой комнате по ролям
    const globalGroups = {}; // крипы во всех комнатах по ролям
    const roomCreeps = []; // все крипы в этой комнате
    let attackersHere = 0; // наши атакеры приписанные к этой комнате

    // fixedSourceCount — сколько крипов уже на каждом источнике
    const fixedSourceCount = {};
    for (const role of FIXED_SOURCE_ROLES) {
      fixedSourceCount[role] = {};
      for (let i = 0; i < (room.memory.sources || []).length; i++) {
        fixedSourceCount[role][i] = 0;
      }
    }

    // Один проход по всем крипам в игре
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      const role = creep.memory.role;

      // Крип "умирающий" — не считаем его живым для спавна нового
      let countAsAlive = true;
      if (thresholds[role] !== undefined && creep.ticksToLive !== undefined) {
        if (creep.ticksToLive < thresholds[role]) countAsAlive = false;
      }

      if (countAsAlive) {
        globalGroups[role] = (globalGroups[role] || 0) + 1;
        if (creep.room.name === room.name) {
          localGroups[role] = (localGroups[role] || 0) + 1;
          roomCreeps.push(creep);
          if (
            FIXED_SOURCE_ROLES.has(role) &&
            creep.memory.sourceIndex !== undefined &&
            fixedSourceCount[role] !== undefined &&
            fixedSourceCount[role][creep.memory.sourceIndex] !== undefined
          ) {
            fixedSourceCount[role][creep.memory.sourceIndex]++;
          }
        }
      } else {
        if (creep.room.name === room.name) roomCreeps.push(creep);
      }

      if (role === "test_attacker" && creep.memory.homeRoom === room.name) {
        attackersHere++;
      }
    }

    // ── 4. КОНФИГУРАЦИЯ РОЛЕЙ ─────────────────────────────────────────

    // Суммарное количество не-энергетических ресурсов в терминале
    const terminalNonEnergy = room.terminal
      ? Object.entries(room.terminal.store)
          .filter(([r]) => r !== RESOURCE_ENERGY)
          .reduce((sum, [, amt]) => sum + amt, 0)
      : 0;

    // Есть ли очередь запросов на перенос ресурсов
    const hasTerminalNeeds = (room.memory.terminalNeeds || []).length > 0;

    // Терминал переполнен энергией а storage пуст
    const terminalEnergyOverflow =
      room.terminal &&
      room.storage &&
      (room.terminal.store[RESOURCE_ENERGY] || 0) > TERMINAL_ENERGY_OVERFLOW &&
      (room.storage.store[RESOURCE_ENERGY] || 0) < STORAGE_ENERGY_MIN;

    // Локальные роли — крипы работают в этой комнате
    const localRolesConfig = [
      { role: "test_worker", count: 1 },
      { role: "test_miner", count: 2 },
      { role: "test_towerSupplier", count: 1 },
      {
        role: "test_terminalUnloader",
        count:
          terminalNonEnergy > 5000 || hasTerminalNeeds || terminalEnergyOverflow
            ? 1
            : 0,
      },
      { role: "test_builder", count: hasSites ? 1 : 0 },
      {
        role: "test_mineralMiner",
        count:
          mineralAvailable &&
          room.storage &&
          room.storage.store[RESOURCE_ENERGY] > 20000
            ? 1
            : 0,
      },
      {
        role: "test_labWorker",
        count: hasLabConfig(room) ? 1 : 0,
      },
      { role: "test_deliveryWorker", count: 1 },
    ];

    // Глобальные роли — крипы работают в соседних комнатах
    const globalRolesConfig = [];
    if (room.name === "E35S37") {
      globalRolesConfig.push({ role: "test_reserver", count: 2 });
      globalRolesConfig.push({ role: "test_remoteMiner", count: 2 });
      globalRolesConfig.push({ role: "test_remoteHauler", count: 2 });
    }

    // ── 5. СПАВН ──────────────────────────────────────────────────────
    const spawns = room.find(FIND_MY_SPAWNS, { filter: s => !s.spawning });
    const spawn = spawns[0];

    if (!spawn) return; // спавн занят — выходим

    // Приоритет 0: атакер
    const attackerCount = 1;
    if (attackerCount > 0 && attackersHere < attackerCount) {
      const result = factory.run(spawn, { role: "test_attacker" }, 0);
      if (result === OK) {
        room._towers.forEach(tower => roleTower.run(tower));
        return;
      }
    }

    const fullConfig = [...localRolesConfig, ...globalRolesConfig];

    // Перебираем роли по приоритету
    for (const roleData of fullConfig) {
      const isGlobal = globalRolesConfig.some(r => r.role === roleData.role);
      const currentCount = isGlobal
        ? globalGroups[roleData.role] || 0
        : localGroups[roleData.role] || 0;

      if (currentCount < roleData.count) {
        let bestIndex;

        if (FIXED_SOURCE_ROLES.has(roleData.role)) {
          // Для фиксированных ролей — источник с наименьшим числом крипов
          const counts = fixedSourceCount[roleData.role] || {};
          bestIndex = Number(
            Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0],
          );
        } else {
          // Для остальных — наименее загруженный источник
          const sourceUsage = {};
          (room._sources || []).forEach((_, i) => {
            sourceUsage[i] = 0;
          });
          roomCreeps.forEach(c => {
            if (
              c.memory.sourceIndex !== undefined &&
              sourceUsage[c.memory.sourceIndex] !== undefined
            ) {
              sourceUsage[c.memory.sourceIndex]++;
            }
          });
          const entries = Object.entries(sourceUsage);
          bestIndex =
            entries.length > 0
              ? Number(entries.sort((a, b) => a[1] - b[1])[0][0])
              : 0;
        }

        // Для удалённых ролей — назначаем целевую комнату
        if (REMOTE_ROLES.has(roleData.role)) {
          const taken = Object.values(Game.creeps)
            .filter(
              c =>
                c.memory.role === roleData.role &&
                (c.memory.target || c.memory.targetRoom),
            )
            .map(c => c.memory.target || c.memory.targetRoom);
          roleData.targetRoom =
            REMOTE_ROOMS.find(r => !taken.includes(r)) || REMOTE_ROOMS[0];
        }

        const result = factory.run(spawn, roleData, bestIndex);
        if (result === OK) break; // спавним только одного крипа за тик
      }
    }
  },
};

module.exports = roomSpawn;
