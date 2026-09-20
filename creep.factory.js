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

/**
 * Валидация списка рабочих мест майнера из Memory.rooms[*].minerSpots.
 * Принимает только клетки с целыми x/y внутри комнаты (0..49).
 * @param {any} raw
 * @returns {{x: number, y: number}[]}
 */
function sanitizeMinerSpots(raw) {
  if (!Array.isArray(raw)) return [];

  const spots = [];
  for (const spot of raw) {
    if (
      spot &&
      Number.isInteger(spot.x) &&
      Number.isInteger(spot.y) &&
      spot.x >= 0 &&
      spot.x <= 49 &&
      spot.y >= 0 &&
      spot.y <= 49
    ) {
      spots.push({ x: spot.x, y: spot.y });
    }
  }

  return spots;
}

const factory = {
  blueprints: {
    miner: (spawn, threshold = PRESPAWN_THRESHOLD.miner) => {
      // Безопасный дефолт: Memory.rooms может быть не инициализирован, а
      // minerSpots — отсутствовать или быть битым. Валидные споты фильтруются:
      // иначе spot без x/y давал бы у роли RoomPosition(NaN, NaN). Пустой
      // список — майнер не спавнится (как и раньше, creep.factory.run → null).
      const roomMemory = (Memory.rooms && Memory.rooms[spawn.room.name]) || {};
      const spots = sanitizeMinerSpots(roomMemory.minerSpots);

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
        // Связку «уходящий → замена» заполняет spawn.manager (remote.handoff)
        // ровно в тике запуска спавна: без неё замена — обычный новый крип.
        handoffFrom: null,
        handoffAt: null,
      },
    }),

    remoteMiner: spawn => ({
      body: prepareBody(CREEP_BODIES.remoteMiner),
      memory: {
        homeRoom: spawn.room.name,
        working: false,
        targetRoom: null,
        handoffFrom: null,
        handoffAt: null,
      },
    }),

    remoteHauler: spawn => ({
      body: prepareBody(CREEP_BODIES.remoteHauler),
      memory: {
        homeRoom: spawn.room.name,
        working: false,
        targetRoom: null,
        handoffFrom: null,
        handoffAt: null,
      },
    }),
  },

  /**
   * Имя, под которым будет создан крип. Вынесено отдельной функцией: имя
   * нужно ЗАРАНЕЕ — spawn.manager записывает его уходящему крипу в
   * memory.handoffTo ещё до вызова spawnCreep (replacement handoff,
   * remote.handoff.js).
   *
   * @param {string} role
   * @param {string} roomName
   * @returns {string}
   */
  creepName: function (role, roomName) {
    return `${role}_${roomName}_${Game.time}`;
  },

  /**
   * @param {StructureSpawn} spawn
   * @param {string} role
   * @param {string} roomName
   * @param {number} [threshold]
   * @param {boolean} [emergency] аварийный режим (см. worker): спавнить
   *                    дешёвое тело, даже если на штатное энергии не хватает
   * @param {string} [handoffFrom] имя уходящего крипа, если это его замена
   * @returns {ScreepsReturnCode}
   */
  run: function (spawn, role, roomName, threshold, emergency, handoffFrom) {
    const blueprintFn = this.blueprints[role];

    if (!blueprintFn) {
      return ERR_INVALID_ARGS;
    }

    const blueprint = blueprintFn(spawn, threshold, emergency);

    if (!blueprint || !blueprint.body || blueprint.body.length === 0) {
      return ERR_INVALID_ARGS;
    }

    const memory = Object.assign({ role }, blueprint.memory);

    // Память дальних ролей создаётся с handoffFrom: null, но объект из
    // blueprint общий для всех вызовов, поэтому пишем связку только когда она
    // есть, и всегда поверх копии (Object.assign выше).
    if (handoffFrom) memory.handoffFrom = handoffFrom;

    const name = this.creepName(role, roomName);

    return spawn.spawnCreep(blueprint.body, name, { memory });
  },
};

module.exports = factory;
