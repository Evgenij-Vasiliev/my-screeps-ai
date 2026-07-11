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
    // Линковый майнер: фиксированный spot, назначается один раз при спавне.
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
      if (!assignedSpot) assignedSpot = spots[Game.time % spots.length];

      return {
        body: prepareBody({ work: 5, carry: 1, move: 2 }),
        cost: 650,
        memory: { homeRoom: spawn.room.name, spot: assignedSpot },
      };
    },
    towerSupplier: () => ({
      body: prepareBody({ carry: 4, move: 2 }),
      cost: 400,
      memory: {},
    }),

    linkWorker: () => ({
      body: prepareBody({ carry: 4, move: 2 }),
      cost: 400,
      memory: {},
    }),

    // Аварийное тело всегда разрешено — иначе очередь встанет намертво
    // при нехватке энергии в комнате без харвестера.
    harvester: spawn => {
      const energy = spawn.room.energyAvailable;
      const full = {
        body: prepareBody({ work: 3, carry: 2, move: 3 }),
        cost: 550,
      };
      const emergency = {
        body: prepareBody({ work: 1, carry: 1, move: 1 }),
        cost: 200,
      };

      if (energy >= full.cost) {
        return {
          body: full.body,
          cost: full.cost,
          memory: { state: "harvesting" },
        };
      }
      if (energy >= emergency.cost) {
        return {
          body: emergency.body,
          cost: emergency.cost,
          memory: { state: "harvesting" },
        };
      }
      return null;
    },

    upgrader: () => ({
      body: prepareBody({ work: 3, carry: 2, move: 3 }),
      cost: 550,
      memory: {},
    }),

    builder: () => ({
      body: prepareBody({ work: 3, carry: 2, move: 3 }),
      cost: 550,
      memory: {},
    }),

    repairer: () => ({
      body: prepareBody({ work: 3, carry: 2, move: 3 }),
      cost: 550,
      memory: {},
    }),
    // Минимальный универсальный исполнитель для Task System (ТЗ №3, Этап 4).
    // Не привязан к конкретному виду работы — получает задачу от Worker Runner.
    worker: () => ({
      body: prepareBody({ work: 1, carry: 2, move: 2 }),
      cost: 250,
      memory: {},
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
    if (!blueprintFn) return ERR_INVALID_ARGS;

    const blueprint = blueprintFn(spawn, threshold);
    if (!blueprint || !blueprint.body || blueprint.body.length === 0) {
      return ERR_INVALID_ARGS;
    }

    const energy = spawn.room.energyAvailable;
    if (energy < blueprint.cost) return ERR_NOT_ENOUGH_ENERGY;

    const memory = Object.assign({ role }, blueprint.memory);
    const name = `${role}_${roomName}_${Game.time}`;

    return spawn.spawnCreep(blueprint.body, name, { memory });
  },
};

module.exports = factory;
