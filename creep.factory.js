/**
 * CREEP FACTORY (ТЗ №3)
 * Отвечает на вопрос: "Какое тело создать?" и производит спавн.
 * prepareBody — порядок частей: TOUGH → WORK → CARRY → MOVE
 */

const {
  PRESPAWN_THRESHOLD,
  CREEP_BODIES,
  HARVESTER,
  WORKER,
} = require("./constants");

const prepareBody = ({
  work = 0,
  carry = 0,
  move = 0,
  tough = 0,
  ranged_attack = 0,
  heal = 0,
  claim = 0,
} = {}) => {
  const body = [];

  for (let i = 0; i < tough; i++) body.push(TOUGH);
  for (let i = 0; i < work; i++) body.push(WORK);
  for (let i = 0; i < carry; i++) body.push(CARRY);
  for (let i = 0; i < ranged_attack; i++) body.push(RANGED_ATTACK);
  for (let i = 0; i < heal; i++) body.push(HEAL);
  for (let i = 0; i < claim; i++) body.push(CLAIM);
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
            (c.spawning || c.ticksToLive > threshold),
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

    linkWorker: () => ({
      body: prepareBody(CREEP_BODIES.linkWorker),
      memory: {},
    }),

    harvester: spawn => {
      // Двухуровневое тело (см. constants.HARVESTER):
      // хватает энергии в спавнах/расширениях — штатное тело на 400;
      // аварийная ситуация (энергии нет нигде) — минимальное тело на 200,
      // чтобы крип вообще мог встать и поднять комнату.
      const body =
        spawn.room.energyAvailable >= HARVESTER.NORMAL_BODY_ENERGY
          ? CREEP_BODIES.harvester
          : CREEP_BODIES.harvesterEmergency;

      return {
        body: prepareBody(body),
        memory: {
          state: "harvesting",
        },
      };
    },

    worker: (spawn, threshold, emergency) => {
      const memory = { homeRoom: spawn.room.name, working: false };
      const energy = spawn.room.energyAvailable;

      // Штатное тело (2500, 40 частей, спавн 120 тиков) — если энергии
      // хватает. Иначе обычный путь НЕ спавнит воркера вовсе (возвращает
      // null): комната не в аварии, просто пул не дорос, а неполноценный
      // воркер без WORK хуже, чем ожидание пары тиков.
      if (energy >= WORKER.NORMAL_BODY_ENERGY) {
        return { body: prepareBody(CREEP_BODIES.worker), memory };
      }

      // Аварийный путь (вызывает spawn.manager, когда воркеров не осталось):
      // дешёвое тело-«спасатель», чтобы комнате было чем долить спавны из
      // storage и раскрутить экономику (см. WORKER/BOOTSTRAP).
      if (emergency) {
        return { body: prepareBody(CREEP_BODIES.workerEmergency), memory };
      }

      return null;
    },

    mineralMiner: () => ({
      body: prepareBody(CREEP_BODIES.mineralMiner),
      memory: {
        working: false,
      },
    }),

    labWorker: spawn => ({
      body: prepareBody(CREEP_BODIES.labWorker),
      memory: {
        homeRoom: spawn.room.name,
      },
    }),

    attacker: spawn => ({
      body: prepareBody(CREEP_BODIES.attacker),
      memory: { targetRoom: null, homeRoom: spawn.room.name },
    }),

    reserver: spawn => ({
      body: prepareBody(CREEP_BODIES.reserver),
      memory: {
        homeRoom: spawn.room.name,
        working: false,
        targetRoom: null,
      },
    }),

    remoteMiner: spawn => ({
      body: prepareBody(CREEP_BODIES.remoteMiner),
      memory: {
        homeRoom: spawn.room.name,
        working: false,
        targetRoom: null,
      },
    }),

    remoteHauler: spawn => ({
      body: prepareBody(CREEP_BODIES.remoteHauler),
      memory: {
        homeRoom: spawn.room.name,
        working: false,
        targetRoom: null,
      },
    }),
  },

  /**
   * @param {StructureSpawn} spawn
   * @param {string} role
   * @param {string} roomName
   * @param {number} [threshold]
   * @param {boolean} [emergency] аварийный режим (см. worker): спавнить
   *                    дешёвое тело, даже если на штатное энергии не хватает
   * @returns {ScreepsReturnCode}
   */
  run: function (spawn, role, roomName, threshold, emergency) {
    const blueprintFn = this.blueprints[role];

    if (!blueprintFn) {
      return ERR_INVALID_ARGS;
    }

    const blueprint = blueprintFn(spawn, threshold, emergency);

    if (!blueprint || !blueprint.body || blueprint.body.length === 0) {
      return ERR_INVALID_ARGS;
    }

    const memory = Object.assign({ role }, blueprint.memory);

    const name = `${role}_${roomName}_${Game.time}`;

    return spawn.spawnCreep(blueprint.body, name, { memory });
  },
};

module.exports = factory;
