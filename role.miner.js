/**
 * ===================================================
 * ROLE.MINER.JS — Статичный майнер
 * ===================================================
 * Позиции стоянки прописаны вручную в памяти комнаты:
 *   Memory.rooms['E35S37'].minerPositions = [{x:18,y:4},{x:29,y:5}]
 *
 * Логика:
 * 1. Берём свободную позицию из minerPositions
 * 2. Идём туда
 * 3. Стоим, копаем, скидываем в линк рядом
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    const room = creep.room;

    // ── 1. ВЫБИРАЕМ ПОЗИЦИЮ (один раз за жизнь) ──────────────────────────
    if (creep.memory.parkX === undefined) {
      const positions = room.memory.minerPositions || [];

      // Занятые позиции другими майнерами
      const taken = new Set(
        Object.values(Game.creeps)
          .filter(
            c =>
              c.id !== creep.id &&
              c.memory.role === "test_miner" &&
              c.memory.parkX !== undefined,
          )
          .map(c => `${c.memory.parkX},${c.memory.parkY}`),
      );

      const free = positions.find(p => !taken.has(`${p.x},${p.y}`));
      if (!free) return; // нет свободной позиции — ждём

      creep.memory.parkX = free.x;
      creep.memory.parkY = free.y;
    }

    // ── 2. ИДЁМ НА ПОЗИЦИЮ ───────────────────────────────────────────────
    const parkPos = new RoomPosition(
      creep.memory.parkX,
      creep.memory.parkY,
      room.name,
    );
    if (!creep.pos.isEqualTo(parkPos)) {
      creep.moveTo(parkPos, { reusePath: 10 });
      return;
    }

    // ── 3. КОПАЕМ ─────────────────────────────────────────────────────────
    const source = creep.pos.findClosestByRange(FIND_SOURCES);
    if (source) creep.harvest(source);

    // ── 4. СКИДЫВАЕМ В ЛИНК ───────────────────────────────────────────────
    if (creep.store[RESOURCE_ENERGY] > 0) {
      // Кэшируем linkId один раз
      if (!creep.memory.linkId) {
        const link = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
          filter: s => s.structureType === STRUCTURE_LINK,
        })[0];
        creep.memory.linkId = link ? link.id : null;
      }
      const link = creep.memory.linkId
        ? Game.getObjectById(creep.memory.linkId)
        : null;
      if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        creep.transfer(link, RESOURCE_ENERGY);
      }
    }
  },
};
