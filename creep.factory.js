/**
 * CREEP FACTORY (ТЗ №3)
 * Отвечает на вопрос: "Какое тело создать?" и производит спавн.
 * prepareBody — порядок частей: TOUGH → WORK → CARRY → MOVE
 */

const prepareBody = ({ work = 0, carry = 0, move = 0, tough = 0 } = {}) => {
  const body = [];

  for (let i = 0; i < tough; i++) body.push(TOUGH);
  for (let i = 0; i < work; i++) body.push(WORK);
  for (let i = 0; i < carry; i++) body.push(CARRY);
  for (let i = 0; i < move; i++) body.push(MOVE);

  return body;
};

const PRESPAWN_THRESHOLD = { miner: 50 };

const factory = {
  blueprints: {
    miner: (spawn, threshold = 50) => {
      const roomMemory = Memory.rooms[spawn.room.name] || {};
      const spots = roomMemory.minerSpots || [];

      if (spots.length === 0) return null;

      let assignedSpot = null;

      for (const spot of spots) {
        const taken = _.some(
          Game.creeps,
          c =>
            c.memory.role === "miner" &&
            c.memory.homeRoom === spawn.room.name &&
            c.memory.spot &&
            c.memory.spot.x === spot.x &&
            c.memory.spot.y === spot.y &&
            c.ticksToLive > threshold,
        );

        if (!taken) {
          assignedSpot = spot;
          break;
        }
      }

      if (!assignedSpot) {
        assignedSpot = spots[Game.time % spots.length];
      }

      return {
        body: prepareBody({ work: 5, carry: 1, move: 2 }),
        memory: {
          homeRoom: spawn.room.name,
          spot: assignedSpot,
        },
      };
    },

    towerSupplier: () => ({
      body: prepareBody({ carry: 4, move: 2 }),
      memory: {},
    }),

    linkWorker: () => ({
      body: prepareBody({ carry: 4, move: 2 }),
      memory: {},
    }),

    harvester: () => ({
      body: prepareBody({ work: 1, carry: 1, move: 1 }),
      memory: {
        state: "harvesting",
      },
    }),

    upgrader: () => ({
      body: prepareBody({ work: 3, carry: 2, move: 3 }),
      memory: {},
    }),

    builder: () => ({
      body: prepareBody({ work: 3, carry: 2, move: 3 }),
      memory: {},
    }),

    repairer: () => ({
      body: prepareBody({ work: 3, carry: 2, move: 3 }),
      memory: {},
    }),

    worker: () => ({
      body: prepareBody({ work: 1, carry: 12, move: 12 }),
      memory: {
        working: false,
      },
    }),
    mineralMiner: () => ({
      body: prepareBody({ work: 5, carry: 5, move: 5 }),
      memory: {
        working: false,
      },
    }),
  },

  /**
   * @param {StructureSpawn} spawn
   * @param {string} role
   * @param {string} roomName
   * @returns {ScreepsReturnCode}
   */
  run: function (spawn, role, roomName, threshold) {
    const blueprintFn = this.blueprints[role];

    if (!blueprintFn) {
      return ERR_INVALID_ARGS;
    }

    const blueprint = blueprintFn(spawn, threshold);

    if (!blueprint || !blueprint.body || blueprint.body.length === 0) {
      return ERR_INVALID_ARGS;
    }

    const memory = Object.assign({ role }, blueprint.memory);

    const name = `${role}_${roomName}_${Game.time}`;

    return spawn.spawnCreep(blueprint.body, name, { memory });
  },
};

module.exports = factory;
