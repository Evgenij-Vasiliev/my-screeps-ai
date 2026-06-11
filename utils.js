module.exports = {
  spawnRoleCreep: function (role) {
    const maxEnergy = Game.spawns["Spawn2"].room.energyAvailable;

    // Стандартное тело (450 энергии)
    let body = [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE];

    if (!Game.spawns["Spawn2"]) return; // Проверяем существование спавна
    if (Game.spawns["Spawn2"].spawning) return; // Проверяем, не занят ли спавн

    // Создаем крипа
    Game.spawns["Spawn2"].spawnCreep(body, `${role}${Game.time}`, {
      memory: { role: role, state: "harvesting" },
    });

    // Логирование
    console.log(`Spawning ${role} with body: ${JSON.stringify(body)}`);
  },
};
