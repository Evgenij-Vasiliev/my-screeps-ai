module.exports = {
  run: function (creep) {
    const HOME_ROOM = "E35S39";

    // 1. Установка целевой комнаты (навсегда в память)
    if (!creep.memory.targetRoom) {
      const rooms = ["E35S38", "E36S37"];
      let sum = 0;
      for (let i = 0; i < creep.name.length; i++)
        sum += creep.name.charCodeAt(i);
      creep.memory.targetRoom = rooms[sum % 2];
    }

    const targetRoom = creep.memory.targetRoom;

    // 2. ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0)
      creep.memory.working = false;
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0)
      creep.memory.working = true;

    // 3. ЛОГИКА ПЕРЕХОДА ГРАНИЦЫ
    const currentGoal = creep.memory.working ? HOME_ROOM : targetRoom;

    if (creep.room.name !== currentGoal) {
      const exit = creep.room.findExitTo(currentGoal);
      creep.moveTo(creep.pos.findClosestByRange(exit), { reusePath: 15 });
      return;
    }

    // 4. ПРИНУДИТЕЛЬНЫЙ ШАГ ОТ ГРАНИЦЫ (Чтобы не прыгал назад)
    if (
      creep.pos.x === 0 ||
      creep.pos.x === 49 ||
      creep.pos.y === 0 ||
      creep.pos.y === 49
    ) {
      creep.move(creep.pos.getDirectionTo(25, 25));
      return;
    }

    // 5. ЛОГИКА РАБОТЫ ВНУТРИ КОМНАТ
    if (creep.memory.working) {
      // РАЗГРУЗКА ДОМА
      let target =
        creep.room.storage ||
        creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
          filter: s =>
            (s.structureType == STRUCTURE_SPAWN ||
              s.structureType == STRUCTURE_EXTENSION) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { reusePath: 15 });
        }
      }
    } else {
      // СБОР В ЦЕЛЕВОЙ КОМНАТЕ
      let container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 0,
      });

      if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(container, { reusePath: 15 });
        }
      } else {
        let dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
          filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 20,
        });
        if (dropped) {
          if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, { reusePath: 15 });
          }
        } else {
          // Если ничего нет — просто идем к источнику и ЖДЕМ
          let source = creep.pos.findClosestByRange(FIND_SOURCES);
          if (source && creep.pos.getRangeTo(source) > 2) {
            creep.moveTo(source, { reusePath: 15 });
          }
        }
      }
    }
  },
};
