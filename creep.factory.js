/**
 * CREEP FACTORY (ТЗ №3)
 * Отвечает на вопрос: "Какое тело создать?" и производит спавн.
 * prepareBody — порядок частей: TOUGH → WORK → CARRY → MOVE
 */

const { PRESPAWN_THRESHOLD, CREEP_BODIES } = require("./constants");

const prepareBody = ({ work = 0, carry = 0, move = 0, tough = 0 } = {}) => {
  const body = [];

  for (let i = 0; i < tough; i++) body.push(TOUGH);
  for (let i = 0; i < work; i++) body.push(WORK);
  for (let i = 0; i < carry; i++) body.push(CARRY);
  for (let i = 0; i < move; i++) body.push(MOVE);

  return body;
};

const factory = {
  blueprints: {
    miner: (spawn, threshold = PRESPAWN_THRESHOLD.miner) => {
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
        body: prepareBody(CREEP_BODIES.miner),
        memory: {
          homeRoom: spawn.room.name,
          spot: assignedSpot,
        },
      };
    },

    towerSupplier: () => ({
      body: prepareBody(CREEP_BODIES.towerSupplier),
      memory: {},
    }),

    linkWorker: () => ({
      body: prepareBody(CREEP_BODIES.linkWorker),
      memory: {},
    }),

    harvester: () => ({
      body: prepareBody(CREEP_BODIES.harvester),
      memory: {
        state: "harvesting",
      },
    }),

    upgrader: () => ({
      body: prepareBody(CREEP_BODIES.upgrader),
      memory: {},
    }),

    builder: () => ({
      body: prepareBody(CREEP_BODIES.builder),
      memory: {},
    }),

    repairer: () => ({
      body: prepareBody(CREEP_BODIES.repairer),
      memory: {},
    }),

    worker: () => ({
      body: prepareBody(CREEP_BODIES.worker),
      memory: {
        working: false,
      },
    }),

    mineralMiner: () => ({
      body: prepareBody(CREEP_BODIES.mineralMiner),
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
