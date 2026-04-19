/**
 * Модуль фабрики крипов
 */
const factory = {
  blueprints: {
    test_miner: (spawn, bestIndex) => {
      const sources = spawn.room.find(FIND_SOURCES);
      return {
        body: [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE],
        memory: { sourceId: sources[bestIndex] ? sources[bestIndex].id : null },
      };
    },
    test_hauler: () => ({
      body: [CARRY, CARRY, MOVE, MOVE],
      memory: {},
    }),
    test_towerSupplier: () => ({
      body: [CARRY, CARRY, MOVE, MOVE],
      memory: {},
    }),
    // Добавляем недостающие роли:
    test_harvester: () => ({
      body: [WORK, CARRY, MOVE],
      memory: {},
    }),
    test_upgrader: () => ({
      body: [WORK, CARRY, MOVE],
      memory: {},
    }),
    test_builder: () => ({
      body: [WORK, CARRY, MOVE],
      memory: {},
    }),
    test_repairer: () => ({
      body: [WORK, CARRY, MOVE],
      memory: {},
    }),
    default: () => ({
      body: [WORK, CARRY, MOVE],
      memory: {},
    }),
  },

  run: function (spawn, roleData, bestIndex) {
    const blueprintFunc =
      this.blueprints[roleData.role] || this.blueprints["default"];
    const blueprint = blueprintFunc(spawn, bestIndex);

    const finalMemory = Object.assign(
      {
        role: roleData.role,
        sourceIndex: bestIndex,
        working: false,
      },
      blueprint.memory,
    );

    return spawn.spawnCreep(blueprint.body, `${roleData.role}_${Game.time}`, {
      memory: finalMemory,
    });
  },
};

module.exports = factory;
