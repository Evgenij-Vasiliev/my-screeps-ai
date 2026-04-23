module.exports = {
  run: function (creep) {
    // === 1. ОПРЕДЕЛЕНИЕ ЦЕЛИ ===
    if (!creep.memory.targetRoom) {
      const rooms = ["E35S38", "E36S37"];
      // Распределяем поровну на основе имени (или времени спавна)
      let sum = 0;
      for (let i = 0; i < creep.name.length; i++)
        sum += creep.name.charCodeAt(i);
      creep.memory.targetRoom = rooms[sum % 2];
    }

    const targetRoom = creep.memory.targetRoom;

    // === 2. ПЕРЕХОД В ЦЕЛЕВУЮ КОМНАТУ ===
    if (creep.room.name !== targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 50,
        visualizePathStyle: { stroke: "#00ff00" },
      });
      return;
    }

    // === 3. РАБОТА С КОНТРОЛЛЕРОМ ===
    const controller = creep.room.controller;
    if (controller) {
      // Пытаемся зарезервировать
      const result = creep.reserveController(controller);

      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, {
          reusePath: 20,
          visualizePathStyle: { stroke: "#00ff00" },
        });
      }

      // Чтобы крип не стоял прямо на пути, можно добавить say для статуса
      if (Game.time % 10 === 0) creep.say("🔒 Reserving");
    }
  },
};
