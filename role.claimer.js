/**
 * ===================================================
 * ROLE.CLAIMER.JS — Крип для захвата контроллера
 * ===================================================
 * Задача:
 * 1. Идёт в целевую комнату (memory.targetRoom)
 * 2. Клеймит контроллер — комната становится нашей
 * 3. После захвата — самоуничтожается (работа сделана)
 *
 * Память крипа:
 * - targetRoom {string} — комната для захвата
 *
 * Спавн из консоли:
 *   Game.rooms['E36S38'].find(FIND_MY_SPAWNS)[0].spawnCreep(
 *     [CLAIM, MOVE, MOVE, MOVE, MOVE, MOVE],
 *     'claimer_' + Game.time,
 *     {memory: {role: 'test_claimer', targetRoom: 'E37S41'}}
 *   )
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const targetRoom = creep.memory.targetRoom;
    if (!targetRoom) {
      creep.say("❌ нет цели");
      return;
    }

    // ── ЕЩЁ НЕ В ЦЕЛЕВОЙ КОМНАТЕ ──────────────────
    if (creep.room.name !== targetRoom) {
      creep.say("🚶 иду");
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 50,
        visualizePathStyle: { stroke: "#ffffff" },
      });
      return;
    }

    // ── В ЦЕЛЕВОЙ КОМНАТЕ ──────────────────────────
    const controller = creep.room.controller;

    if (!controller) {
      creep.say("❌ нет контроллера");
      return;
    }

    // Контроллер уже наш — работа сделана
    if (controller.my) {
      creep.say("✅ захвачено!");
      creep.suicide();
      return;
    }

    // Клеймим контроллер
    const result = creep.claimController(controller);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ffffff" },
      });
    } else if (result === OK) {
      console.log(`[Claimer] ✅ Комната ${targetRoom} захвачена!`);
    } else {
      console.log(`[Claimer] Ошибка клейма: ${result}`);
    }
  },
};
