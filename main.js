const utils = require("utils");
const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");
const roleMiner = require("role.miner");
const roleTransporter = require("role.transporter");
const roleTower = require("role.tower"); // Добавляем башни

module.exports.loop = function () {
  const spawn = Game.spawns["Spawn1"];
  if (!spawn || !spawn.room) return;

  // Очистка памяти
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  // Подсчет крипов
  const harvesters = _.filter(Game.creeps, c => c.memory.role === "harvester");
  const upgraders = _.filter(Game.creeps, c => c.memory.role === "upgrader");
  const builders = _.filter(Game.creeps, c => c.memory.role === "builder");
  const miners = _.filter(Game.creeps, c => c.memory.role === "miner");
  const transporters = _.filter(
    Game.creeps,
    c => c.memory.role === "transporter",
  );

  // Режим выживания
  if (harvesters.length === 0 && !spawn.spawning) {
    utils.spawnRoleCreep("harvester");
  }

  // Основная логика спавна
  if (!spawn.spawning) {
    if (miners.length < 2) utils.spawnRoleCreep("miner");
    else if (transporters.length < 2) utils.spawnRoleCreep("transporter");
    else if (harvesters.length < 4) utils.spawnRoleCreep("harvester");
    else if (upgraders.length < 3) utils.spawnRoleCreep("upgrader");
    else if (builders.length < 2) utils.spawnRoleCreep("builder");
  }

  // Управление крипами
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (!creep) continue;

    try {
      switch (creep.memory.role) {
        case "harvester":
          roleHarvester.run(creep);
          break;
        case "upgrader":
          roleUpgrader.run(creep);
          break;
        case "builder":
          roleBuilder.run(creep);
          break;
        case "miner":
          roleMiner.run(creep);
          break;
        case "transporter":
          roleTransporter.run(creep);
          break;
      }
    } catch (e) {
      console.log(`Ошибка в крипе ${name}: ${e.message}`);
    }
  }

  // Управление башнями
  const towers = _.filter(
    Game.structures,
    s => s.structureType === STRUCTURE_TOWER,
  );
  for (const tower of towers) {
    roleTower.run(tower);
  }
};
