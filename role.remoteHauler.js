/**
 * ===================================================
 * ROLE.REMOTEHAULER.JS — Дальний перевозчик энергии
 * ===================================================
 * Забирает энергию из контейнеров в удалённых комнатах
 * и везёт её к линку у границы E35S37.
 * Линк мгновенно передаёт энергию в линк у Storage.
 *
 * Маршрут:
 *   Удалённая комната → контейнер → рюкзак полон
 *   → идём в E35S37 → передаём в линк у границы → повтор
 *
 * Привязка линков к комнатам (через память комнаты):
 *   Memory.rooms['E35S37'].links.senders[0] → линк для E36S37 (45,7)
 *   Memory.rooms['E35S37'].links.senders[1] → линк для E35S38 (24,46)
 * ===================================================
 */

// Привязка: targetRoom → ID линка у границы
const ROOM_TO_LINK = {
  E36S37: "69f619245142ea0b41e8903a", // линк на 45,7
  E35S38: "69f62cd6a9a66852492a848c", // линк на 24,46
};

module.exports = {
  run: function (creep) {
    const HOME_ROOM = "E35S37";

    // Назначаем целевую комнату если не задана
    if (!creep.memory.targetRoom) {
      const rooms = ["E35S38", "E36S37"];
      let sum = 0;
      for (let i = 0; i < creep.name.length; i++)
        sum += creep.name.charCodeAt(i);
      creep.memory.targetRoom = rooms[sum % 2];
    }

    const targetRoom = creep.memory.targetRoom;

    // Переключение режима
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0)
      creep.memory.working = false;
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0)
      creep.memory.working = true;

    const currentGoal = creep.memory.working ? HOME_ROOM : targetRoom;

    // Переход между комнатами
    if (creep.room.name !== currentGoal) {
      if (
        creep.memory._lastRoom &&
        creep.memory._lastRoom !== creep.room.name
      ) {
        delete creep.memory._move;
      }
      creep.memory._lastRoom = creep.room.name;
      creep.moveTo(new RoomPosition(25, 25, currentGoal), {
        reusePath: 0,
        visualizePathStyle: { stroke: "#ffffff" },
        maxRooms: 3,
      });
      return;
    }

    creep.memory._lastRoom = creep.room.name;

    // Уходим с границы комнаты
    if (
      creep.pos.x === 0 ||
      creep.pos.x === 49 ||
      creep.pos.y === 0 ||
      creep.pos.y === 49
    ) {
      creep.moveTo(new RoomPosition(25, 25, creep.room.name), { reusePath: 0 });
      return;
    }

    if (creep.memory.working) {
      // === РЕЖИМ ДОСТАВКИ: несём в линк у границы ===
      const linkId = ROOM_TO_LINK[targetRoom];
      const link = linkId ? Game.getObjectById(linkId) : null;

      if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        // Есть линк и в нём есть место — идём к нему
        if (creep.transfer(link, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(link, {
            reusePath: 15,
            maxRooms: 1,
            visualizePathStyle: { stroke: "#00ffff" },
          });
        }
      } else {
        // Линк полный или недоступен — запасной вариант: Storage
        const target = creep.room.storage;
        if (target) {
          if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, { reusePath: 15, maxRooms: 1 });
          }
        }
      }
    } else {
      // === РЕЖИМ СБОРА: берём из контейнера в удалённой комнате ===
      let container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 0,
      });

      if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(container, { reusePath: 15, maxRooms: 1 });
        }
      } else {
        // Контейнер пуст — подбираем выпавшую энергию
        let dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
          filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 20,
        });
        if (dropped) {
          if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, { reusePath: 15, maxRooms: 1 });
          }
        } else {
          // Ждём у источника
          let source = creep.pos.findClosestByRange(FIND_SOURCES);
          if (source && creep.pos.getRangeTo(source) > 2) {
            creep.moveTo(source, { reusePath: 15, maxRooms: 1 });
          }
        }
      }
    }
  },
};
