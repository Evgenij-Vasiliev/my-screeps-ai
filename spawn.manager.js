/**
 * SPAWN MANAGER (ТЗ №3)
 * Отвечает на вопрос: "Кого создать?"
 * Хранит очередь/приоритеты ролей, считает текущее количество крипов,
 * вызывает creep.factory для реального спавна.
 */
const creepFactory = require("creep.factory");
const {
  SPAWN_QUOTA,
  MINERAL_MIN_AMOUNT_TO_SPAWN,
  PRESPAWN_THRESHOLD,
} = require("./constants");

/**
 * Счётчики крипов по ролям — ОДИН проход по списку (задание 8 плана).
 *
 * Раньше countRole(creeps, role) вызывался на каждую роль из SPAWN_QUOTA,
 * то есть список крипов проходился девять раз с созданием массива и
 * замыкания на каждый проход. При этом у пяти ролей квота равна нулю —
 * их счёт не нужен вовсе.
 *
 * Правила счёта сохранены прежние:
 * - роль не из SPAWN_QUOTA или с нулевой квотой не считается;
 * - крип, чей ticksToLive ниже PRESPAWN_THRESHOLD[role], не считается:
 *   он «уже уходящий», вместо него нужен новый (иначе спавн опоздает).
 *
 * @param {Array} creeps
 * @returns {Object} role -> количество
 */
function countRoles(creeps) {
  const counts = {};

  for (let i = 0; i < creeps.length; i++) {
    const creep = creeps[i];
    if (!creep) continue;

    const role = creep.memory.role;

    // !quota отсекает и 0, и роли вне таблицы квот.
    if (!SPAWN_QUOTA[role]) continue;

    const threshold = PRESPAWN_THRESHOLD[role];
    if (
      threshold !== undefined &&
      creep.ticksToLive !== undefined &&
      creep.ticksToLive < threshold
    ) {
      continue;
    }

    counts[role] = (counts[role] || 0) + 1;
  }

  return counts;
}

/**
 * @param {Object} roomState
 */
function run(roomState) {
  const spawn = roomState.spawns.find(s => !s.spawning);
  if (!spawn) return;

  // Один проход вместо девяти.
  const counts = countRoles(roomState.creeps);

  for (const role in SPAWN_QUOTA) {
    const quota = SPAWN_QUOTA[role];

    // Роль с нулевой квотой не спавнится — незачем её считать и проверять.
    if (!quota) continue;

    // Квота уже набрана. Проверка идёт ДО дорогих условий ниже: например,
    // для mineralMiner это экономит Game.getObjectById на каждом тике.
    if ((counts[role] || 0) >= quota) continue;

    if (
      role === "upgrader" &&
      roomState.room.controller.ticksToDowngrade > 100000
    )
      continue;

    if (role === "mineralMiner") {
      if (!roomState.mineral || !roomState.mineral.extractorId) continue;
      const mineralObj = Game.getObjectById(roomState.mineral.id);
      if (!mineralObj || mineralObj.mineralAmount < MINERAL_MIN_AMOUNT_TO_SPAWN)
        continue;
    }

    const result = creepFactory.run(
      spawn,
      role,
      roomState.roomName,
      PRESPAWN_THRESHOLD[role],
    );
    if (result === OK) return;
  }
}

module.exports.run = run;
// Экспортируется для офлайн-тестов (tests/spawn.count.test.js).
module.exports.countRoles = countRoles;
