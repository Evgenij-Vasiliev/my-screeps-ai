const roleHarvester = require("./role.harvester");
const roleUpgrader = require("./role.upgrader");
const roleBuilder = require("./role.builder");
const roleRepairer = require("./role.repairer");

module.exports.loop = function () {
  for (let name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
    }
  }

  const rolesConfig = [
    { role: "test_harvester", count: 1 },
    { role: "test_upgrader", count: 1 },
    { role: "test_builder", count: 1 },
    { role: "test_repairer", count: 1 },
  ];

  _.forEach(rolesConfig, roleData => {
    const creepsWithRole = _.filter(
      Game.creeps,
      creep => creep.memory.role === roleData.role,
    );
    if (creepsWithRole.length < roleData.count) {
      Game.spawns["Spawn5"].spawnCreep(
        [WORK, CARRY, MOVE],
        `${roleData.role}_${Game.time}`,
        {
          memory: {
            role: roleData.role,
            working: false,
          },
        },
      );
    }
    _.forEach(creepsWithRole, creep => {
      if (creep.memory.role === "test_harvester") {
        roleHarvester.run(creep);
      } else if (creep.memory.role === "test_upgrader") {
        roleUpgrader.run(creep);
      } else if (creep.memory.role === "test_builder") {
        roleBuilder.run(creep);
      } else if (creep.memory.role === "test_repairer") {
        roleRepairer.run(creep);
      }
    });
  });
};
