const prepareBody = ({
  work = 0,
  carry = 0,
  move = 0,
  attack = 0,
  tough = 0,
  ranged_attack = 0,
  heal = 0,
  claim = 0,
} = {}) => {
  const body = [];
  for (let i = 0; i < tough; i++) body.push(TOUGH);
  for (let i = 0; i < work; i++) body.push(WORK);
  for (let i = 0; i < carry; i++) body.push(CARRY);
  for (let i = 0; i < attack; i++) body.push(ATTACK);
  for (let i = 0; i < ranged_attack; i++) body.push(RANGED_ATTACK);
  for (let i = 0; i < heal; i++) body.push(HEAL);
  for (let i = 0; i < claim; i++) body.push(CLAIM);
  for (let i = 0; i < move; i++) body.push(MOVE);
  return body;
};

const factory = {
  blueprints: {
    test_miner: (spawn, bestIndex) => {
      const sourceId = (spawn.room.memory.sources || [])[bestIndex] || null;
      return {
        body: prepareBody({ work: 5, move: 2 }),
        memory: { sourceId },
      };
    },

    test_hauler: () => ({
      body: prepareBody({ carry: 10, move: 10 }),
      memory: {},
    }),

    test_harvester: () => ({
      body: prepareBody({ work: 2, carry: 2, move: 2 }),
      memory: {},
    }),

    test_mineralMiner: spawn => {
      let mineralId = null;
      if (spawn.room.memory.mineralId) {
        mineralId = spawn.room.memory.mineralId;
      } else {
        const minerals = spawn.room.find(FIND_MINERALS);
        mineralId = minerals.length > 0 ? minerals[0].id : null;
        spawn.room.memory.mineralId = mineralId;
      }
      return {
        body: prepareBody({ work: 5, carry: 5, move: 5 }),
        memory: { mineralId },
      };
    },

    test_builder: () => ({
      body: prepareBody({ work: 5, carry: 5, move: 5 }),
      memory: {},
    }),

    test_repairer: () => ({
      body: prepareBody({ work: 4, carry: 4, move: 4 }),
      memory: {},
    }),

    test_upgrader: () => ({
      body: prepareBody({ work: 15, carry: 8, move: 8 }),
      memory: {},
    }),

    test_towerSupplier: () => ({
      body: prepareBody({ carry: 8, move: 8 }),
      memory: {},
    }),

    test_remoteMiner: (spawn, bestIndex, roleData) => ({
      body: prepareBody({ work: 6, carry: 1, move: 7 }),
      memory: { target: roleData.targetRoom || null },
    }),

    test_remoteHauler: (spawn, bestIndex, roleData) => ({
      body: prepareBody({ carry: 20, move: 20 }),
      memory: { working: false, targetRoom: roleData.targetRoom || null },
    }),

    test_reserver: (spawn, bestIndex, roleData) => ({
      body: prepareBody({ claim: 2, move: 4 }),
      memory: { working: false, targetRoom: roleData.targetRoom || null },
    }),

    test_attacker: spawn => ({
      body: prepareBody({
        tough: 0,
        ranged_attack: 10,
        heal: 0,
        move: 20,
      }),
      memory: { targetRoom: null, homeRoom: spawn.room.name },
    }),

    default: () => ({
      body: prepareBody({ work: 1, carry: 1, move: 1 }),
      memory: {},
    }),
  },

  run: function (spawn, roleData, bestIndex) {
    const blueprintFunc =
      this.blueprints[roleData.role] || this.blueprints["default"];

    const blueprint = blueprintFunc(spawn, bestIndex, roleData);

    if (!blueprint.body || blueprint.body.length === 0) {
      console.log(`[Factory] ОШИБКА: пустое тело для роли ${roleData.role}`);
      return ERR_INVALID_ARGS;
    }

    const finalMemory = Object.assign(
      {
        role: roleData.role,
        sourceIndex: bestIndex,
        working: false,
      },
      blueprint.memory,
    );

    const name = `${roleData.role}_${Game.time}`;
    const result = spawn.spawnCreep(blueprint.body, name, {
      memory: finalMemory,
    });

    if (
      result !== OK &&
      result !== ERR_NOT_ENOUGH_ENERGY &&
      result !== ERR_BUSY
    ) {
      console.log(`[Factory] Ошибка спавна ${roleData.role}: ${result}`);
    }

    return result;
  },
};

module.exports = factory;
