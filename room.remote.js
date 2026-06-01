/**
 * ===================================================
 * ROOM.REMOTE.JS — Оркестрация удалённых комнат
 * ===================================================
 * VERSION: 1.0
 *
 * Вынесено из roomManager.js и room.spawn.js
 * (ТЗ Архитектора №2).
 *
 * Отвечает ТОЛЬКО за:
 * - константы удалённых комнат и ролей
 * - сканирование remote комнат на враждебное присутствие
 * - управление Memory.attackAlert
 *
 * НЕ отвечает за:
 * - спавн крипов (room.spawn.js использует экспортированные константы)
 * - башни, линки, лабы, терминал (roomManager.js)
 * - observer (roomManager.js)
 *
 * ЭКСПОРТИРУЕТ:
 *   REMOTE_ROOMS   — список комнат дальней добычи
 *   REMOTE_ROLES   — Set ролей удалённых крипов
 *   run(room)      — точка входа оркестрации
 * ===================================================
 */

// ── КОНСТАНТЫ УДАЛЁННЫХ КОМНАТ ────────────────────────────────────────────

/**
 * Комнаты для удалённых операций.
 * remoteMiner, remoteHauler, reserver работают в этих комнатах.
 */
const REMOTE_ROOMS = ["E35S38", "E36S37"];

/**
 * Удалённые роли — работают в соседних комнатах.
 * При спавне им нужно назначить targetRoom.
 */
const REMOTE_ROLES = new Set([
  "test_remoteMiner",
  "test_remoteHauler",
  "test_reserver",
]);

// Комнаты с повышенным риском нападения — проверяются первыми
const HIGH_RISK_ROOMS = ["E36S37", "E35S38"];

// Комнаты дальней добычи — сканируем на врагов каждый тик
const REMOTE_SCAN_ROOMS = ["E36S37", "E35S38"];

// ── СКАНЕР АТАК ───────────────────────────────────────────────────────────

/**
 * Сканирует все наши комнаты и remote комнаты на наличие врагов.
 *
 * Проверяет:
 * - hostile creeps с боевыми частями (ATTACK, RANGED_ATTACK, HEAL)
 * - Invader Core
 *
 * Устанавливает Memory.attackAlert если угроза обнаружена.
 * Очищает Memory.attackAlert когда угроза исчезает.
 *
 * Запускается ОДИН РАЗ за тик — только из первой комнаты
 * в алфавитном списке (защита от дублирования).
 */
function runAttackScanner() {
  // Собираем наши комнаты
  const ourRooms = Object.values(Game.rooms).filter(
    r => r.controller && r.controller.my,
  );

  // Добавляем remote комнаты если они видимы
  const remoteRooms = REMOTE_SCAN_ROOMS.map(name => Game.rooms[name]).filter(
    Boolean,
  );

  const allRooms = [...ourRooms];
  for (const r of remoteRooms) {
    if (!allRooms.find(x => x.name === r.name)) allRooms.push(r);
  }

  // Сортируем: сначала высокорисковые комнаты
  const sorted = allRooms.sort((a, b) => {
    const aRisk = HIGH_RISK_ROOMS.includes(a.name) ? 0 : 1;
    const bRisk = HIGH_RISK_ROOMS.includes(b.name) ? 0 : 1;
    return aRisk - bRisk;
  });

  for (const room of sorted) {
    // Проверяем боевых крипов
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
      filter: c =>
        c.body.some(
          b => b.type === ATTACK || b.type === RANGED_ATTACK || b.type === HEAL,
        ),
    });

    if (hostiles.length > 0) {
      const prev = Memory.attackAlert;
      if (!prev || prev.room !== room.name) {
        console.log(
          `[AttackAlert] 🚨 Враги в ${room.name}! Крипов: ${hostiles.length}`,
        );
      }
      Memory.attackAlert = { room: room.name, time: Game.time };
      return;
    }

    // Проверяем Invader Core
    const invaderCore = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_INVADER_CORE,
    });

    if (invaderCore.length > 0) {
      const prev = Memory.attackAlert;
      if (!prev || prev.room !== room.name) {
        console.log(`[AttackAlert] 🚨 Invader Core в ${room.name}!`);
      }
      Memory.attackAlert = { room: room.name, time: Game.time };
      return;
    }
  }

  // Угроза исчезла — очищаем алерт
  if (Memory.attackAlert) {
    console.log(`[AttackAlert] ✅ Комната ${Memory.attackAlert.room} очищена.`);
    delete Memory.attackAlert;
  }
}

// ── ГЛАВНЫЙ МОДУЛЬ ────────────────────────────────────────────────────────

module.exports = {
  // Константы — импортируются в room.spawn.js
  REMOTE_ROOMS,
  REMOTE_ROLES,

  /**
   * Точка входа — вызывается из roomManager.run(room).
   * Запускает сканер атак ОДИН РАЗ за тик.
   *
   * @param {Room} room
   */
  run(room) {
    const ourRoomNames = Object.keys(Game.rooms)
      .filter(n => {
        const r = Game.rooms[n];
        return r.controller && r.controller.my;
      })
      .sort();

    // Сканер запускается только из первой комнаты
    if (ourRoomNames[0] === room.name) {
      runAttackScanner();
    }
  },
};
