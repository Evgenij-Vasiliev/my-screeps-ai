module.exports = {
  run: function (creep) {
    // === РУЧНОЕ УПРАВЛЕНИЕ (Глобальный приказ) ===
    // Если тут null - работают по плану. Если вписать "E35S39" - все летят туда.
    const emergencyTarget = "E36S37";

    // 1. САМОЛЕЧЕНИЕ (Всегда в приоритете)
    if (creep.hits < creep.hitsMax) {
      creep.heal(creep);
    }

    // 2. ОПРЕДЕЛЕНИЕ ЦЕЛИ
    if (emergencyTarget) {
      // Если есть экстренная цель, перезаписываем память
      creep.memory.targetRoom = emergencyTarget;
    } else if (!creep.memory.targetRoom) {
      // Иначе работаем по стандартному патрулю
      const battleZones = ["E35S38", "E36S37"];
      let sum = 0;
      for (let i = 0; i < creep.name.length; i++)
        sum += creep.name.charCodeAt(i);
      creep.memory.targetRoom = battleZones[sum % 2];
    }

    const targetRoom = creep.memory.targetRoom;

    // 3. ПЕРЕМЕЩЕНИЕ К ЦЕЛИ
    if (creep.room.name !== targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 50,
        visualizePathStyle: { stroke: "#ff0000" },
      });
      return;
    }

    // 4. БОЕВАЯ ЛОГИКА
    let target =
      creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS) ||
      creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_INVADER_CORE,
      });

    if (target) {
      const range = creep.pos.getRangeTo(target);

      // Выбор типа атаки
      if (creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3).length > 1) {
        creep.rangedMassAttack();
      } else if (range <= 3) {
        creep.rangedAttack(target);
      }

      // Кайтинг (Дистанция 3)
      if (range < 3) {
        const fleePath = PathFinder.search(
          creep.pos,
          [{ pos: target.pos, range: 3 }],
          { flee: true },
        );
        if (fleePath.path.length > 0) creep.move(fleePath.path[0].direction);
      } else if (range > 3) {
        creep.moveTo(target, { reusePath: 10 });
      }
    } else {
      // ОЖИДАНИЕ/ПАТРУЛЬ
      if (!creep.pos.inRangeTo(25, 25, 5)) {
        creep.moveTo(25, 25, { reusePath: 50 });
      }
    }
  },
};
