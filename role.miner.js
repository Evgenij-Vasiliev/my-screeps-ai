/**
 * ===================================================
 * ROLE.MINER.JS — Статичный майнер (контейнер + линк)
 * ===================================================
 * Стратегия:
 * 1. Если есть контейнер рядом с источником — стоим на нём
 * 2. Если контейнера нет — ищем позицию смежную с источником И линком
 *    При этом клетка не должна быть занята самим линком или стеной
 * 3. Стоим на месте, копаем и скидываем энергию в линк
 *
 * Память крипа:
 * - sourceId      {string|null} — ID источника
 * - sourceIndex   {number}      — индекс источника (запасной)
 * - containerId   {string|null} — ID контейнера (если есть)
 * - parkX, parkY  {number}      — позиция стоянки (кэш)
 * - targetRoom    {string}      — для работы в другой комнате
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    // ── 1. ПЕРЕХОД В ДРУГУЮ КОМНАТУ ──────────────────────────────────────
    if (
      creep.memory.targetRoom &&
      creep.memory.targetRoom !== creep.room.name
    ) {
      const exitDir = creep.room.findExitTo(creep.memory.targetRoom);
      const exit = creep.pos.findClosestByRange(exitDir);
      creep.moveTo(exit, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ffffff" },
      });
      return;
    }

    // ── 2. ПОЛУЧАЕМ ИСТОЧНИК ─────────────────────────────────────────────
    const sourceIds = creep.room.memory.sources || [];
    const sourceId =
      creep.memory.sourceId || sourceIds[creep.memory.sourceIndex];
    if (!sourceId) return;

    const source = Game.getObjectById(sourceId);
    if (!source) return;

    if (!creep.memory.sourceId) creep.memory.sourceId = sourceId;

    // ── 3. ОПРЕДЕЛЯЕМ ПОЗИЦИЮ СТОЯНКИ ───────────────────────────────────
    if (creep.memory.parkX === undefined) {
      // Сначала ищем свободный контейнер рядом с источником
      const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
      });

      const takenIds = new Set(
        Object.values(Game.creeps)
          .filter(
            c =>
              c.id !== creep.id &&
              c.memory.role === creep.memory.role &&
              c.memory.containerId,
          )
          .map(c => c.memory.containerId),
      );

      const freeContainer = containers.find(c => !takenIds.has(c.id));

      if (freeContainer) {
        // Есть свободный контейнер — стоим на нём
        creep.memory.containerId = freeContainer.id;
        creep.memory.parkX = freeContainer.pos.x;
        creep.memory.parkY = freeContainer.pos.y;
      } else {
        // Контейнера нет — ищем позицию смежную и с источником и с линком
        const nearLinks = source.pos.findInRange(FIND_MY_STRUCTURES, 2, {
          filter: s => s.structureType === STRUCTURE_LINK,
        });

        let bestPos = null;
        const terrain = creep.room.getTerrain();

        if (nearLinks.length > 0) {
          const link = nearLinks[0];

          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              if (dx === 0 && dy === 0) continue;

              const x = source.pos.x + dx;
              const y = source.pos.y + dy;

              // Стена — пропускаем
              if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

              // Клетка не должна совпадать с позицией линка — на линк нельзя встать
              if (x === link.pos.x && y === link.pos.y) continue;

              // Клетка должна быть смежной с линком (расстояние Чебышева ≤ 1)
              const distToLink = Math.max(
                Math.abs(x - link.pos.x),
                Math.abs(y - link.pos.y),
              );

              if (distToLink <= 1) {
                bestPos = { x, y };
                break;
              }
            }
            if (bestPos) break;
          }
        }

        if (bestPos) {
          creep.memory.parkX = bestPos.x;
          creep.memory.parkY = bestPos.y;
        } else {
          // Линка нет — просто ближайшая свободная клетка у источника
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              if (dx === 0 && dy === 0) continue;
              const x = source.pos.x + dx;
              const y = source.pos.y + dy;
              if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
                creep.memory.parkX = x;
                creep.memory.parkY = y;
                break;
              }
            }
            if (creep.memory.parkX !== undefined) break;
          }
        }
      }
    }

    // ── 4. КОНТЕЙНЕР РАЗРУШЕН — сбрасываем кэш ──────────────────────────
    if (
      creep.memory.containerId &&
      !Game.getObjectById(creep.memory.containerId)
    ) {
      delete creep.memory.containerId;
      delete creep.memory.parkX;
      delete creep.memory.parkY;
      return;
    }

    // ── 5. ИДЁМ НА ПОЗИЦИЮ СТОЯНКИ ──────────────────────────────────────
    if (creep.memory.parkX === undefined) return;

    const parkPos = new RoomPosition(
      creep.memory.parkX,
      creep.memory.parkY,
      creep.room.name,
    );

    if (!creep.pos.isEqualTo(parkPos)) {
      creep.moveTo(parkPos, {
        reusePath: 10,
        visualizePathStyle: { stroke: "#ffaa00" },
      });
      return;
    }

    // ── 6. СТОИМ НА МЕСТЕ — КОПАЕМ И СКИДЫВАЕМ В ЛИНК ──────────────────
    creep.harvest(source);

    if (creep.store[RESOURCE_ENERGY] > 0) {
      const nearLinks = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
        filter: s =>
          s.structureType === STRUCTURE_LINK &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });
      if (nearLinks.length > 0) {
        creep.transfer(nearLinks[0], RESOURCE_ENERGY);
      }
    }
  },
};
