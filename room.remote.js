/**
 * ===================================================
 * ROOM.REMOTE.JS — Оркестрация удалённых комнат
 * ===================================================
 * VERSION: 1.1
 *
 * Отвечает ТОЛЬКО за:
 * - константы удалённых комнат и ролей
 * - сканирование remote комнат на враждебное присутствие
 * - управление Memory.attackAlert
 *
 * ЭКСПОРТИРУЕТ:
 *   REMOTE_ROOMS   — список комнат дальней добычи
 *   REMOTE_ROLES   — Set ролей удалённых крипов
 *   run(room)      — точка входа оркестрации
 * ===================================================
 */

const REMOTE_ROOMS = ["E35S38", "E36S37"];

const REMOTE_ROLES = new Set([
  "remoteMiner",
  "remoteHauler",
  "reserver",
  "attacker",
]);

const HIGH_RISK_ROOMS = ["E36S37", "E35S38"];
const REMOTE_SCAN_ROOMS = ["E36S37", "E35S38"];

function runAttackScanner() {
  const ourRooms = Object.values(Game.rooms).filter(
    r => r.controller && r.controller.my,
  );

  const remoteRooms = REMOTE_SCAN_ROOMS.map(name => Game.rooms[name]).filter(
    Boolean,
  );

  const allRooms = [...ourRooms];
  for (const r of remoteRooms) {
    if (!allRooms.find(x => x.name === r.name)) allRooms.push(r);
  }

  const sorted = allRooms.sort((a, b) => {
    const aRisk = HIGH_RISK_ROOMS.includes(a.name) ? 0 : 1;
    const bRisk = HIGH_RISK_ROOMS.includes(b.name) ? 0 : 1;
    return aRisk - bRisk;
  });

  for (const room of sorted) {
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
      filter: c =>
        c.body.some(
          b => b.type === ATTACK || b.type === RANGED_ATTACK || b.type === HEAL,
        ),
    });

    if (hostiles.length > 0) {
      Memory.attackAlert = { room: room.name, time: Game.time };
      return;
    }

    const invaderCore = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_INVADER_CORE,
    });

    if (invaderCore.length > 0) {
      Memory.attackAlert = { room: room.name, time: Game.time };
      return;
    }
  }

  if (Memory.attackAlert) {
    delete Memory.attackAlert;
  }
}

module.exports = {
  REMOTE_ROOMS,
  REMOTE_ROLES,

  run(room) {
    const ourRoomNames = Object.keys(Game.rooms)
      .filter(n => {
        const r = Game.rooms[n];
        return r.controller && r.controller.my;
      })
      .sort();

    if (ourRoomNames[0] === room.name) {
      runAttackScanner();
    }
  },
};
