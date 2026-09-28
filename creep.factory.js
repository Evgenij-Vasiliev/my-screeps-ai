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

/**
 * Споты, зарезервированные в текущем тике.
 *
 * Зачем: в комнате два спавна, и в одном тике оба выбирают спот. Первый уже
 * вызвал spawnCreep, но крип ещё не появился в Game.creeps — поэтому проверка
 * «спот занят» у второго спавна его не видит, и оба берут spots[0].
 * Живой случай 27.09.2026: после массового переспавна 4 комнаты получили по
 * паре майнеров на одном споте — второй не мог дойти и не добывал, а второй
 * источник комнаты остался без майнера.
 *
 * Резервация живёт один тик: крипы, созданные в этом тике, на следующем уже
 * видны в Game.creeps, и проверка занятости работает как раньше.
 */
function reservedSpots() {
  const tick = Game.time;
  const cached = global.__spotReservations;

  if (cached && cached.tick === tick) return cached.taken;

  const taken = new Set();
  global.__spotReservations = { tick, taken };
  return taken;
}

const factory = {
  blueprints: {
    miner: (spawn, threshold = PRESPAWN_THRESHOLD.miner) => {
      const roomName = spawn.room.name;
      const roomMemory = Memory.rooms[roomName] || {};
      const spots = roomMemory.minerSpots || [];

      if (spots.length === 0) return null;

      const reserved = reservedSpots();
      let assignedSpot = null;

      for (const spot of spots) {
        const key = roomName + ":" + spot.x + "," + spot.y;
        if (reserved.has(key)) continue;

        const taken = _.some(
          Game.creeps,
          c =>
            c.memory.role === "miner" &&
            c.memory.homeRoom === roomName &&
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

      // Резервируем выбор до конца тика, чтобы второй спавн комнаты его увидел.
      reserved.add(roomName + ":" + assignedSpot.x + "," + assignedSpot.y);

      return {
        body: prepareBody(CREEP_BODIES.miner),
        memory: {
          homeRoom: roomName,
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

    // homeRoom пишется ВСЕГДА. Раньше его получал только miner, а worker,
    // linkWorker и mineralMiner — нет. Без homeRoom room.manager.js:419-430
    // привязывает крипа к ТЕКУЩЕЙ комнате, а spawn.manager.countRoles считает
    // квоты по homeRoom — такой крип не попадал ни в одну квоту, и комната
    // спавнила лишнего (каждый лишний worker ≈ 0.19 CPU/тик навсегда).
    const memory = Object.assign(
      { role, homeRoom: roomName },
      blueprint.memory,
    );

    const name = `${role}_${roomName}_${Game.time}`;

    return spawn.spawnCreep(blueprint.body, name, { memory });
  },
};

module.exports = factory;
