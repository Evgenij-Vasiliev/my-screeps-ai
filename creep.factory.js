/**
 * CREEP FACTORY (ТЗ №3)
 * Отвечает на вопрос: "Какое тело создать?" и производит спавн.
 * prepareBody — порядок частей: TOUGH → WORK → CARRY → MOVE
 */

const { CREEP_BODIES } = require("./constants");

const prepareBody = ({ work = 0, carry = 0, move = 0, tough = 0 } = {}) => {
  const body = [];

  for (let i = 0; i < tough; i++) body.push(TOUGH);
  for (let i = 0; i < work; i++) body.push(WORK);
  for (let i = 0; i < carry; i++) body.push(CARRY);
  for (let i = 0; i < move; i++) body.push(MOVE);

  return body;
};

/**
 * Привязка майнера к споту БОЛЬШЕ НЕ ВЫДАЁТСЯ (правка 01.10.2026).
 *
 * Раньше здесь были reservedSpots()/takenSpots() и выбор одного спота из
 * Memory.rooms[room].minerSpots: в комнате стояло два майнера (квота 2), и их
 * надо было разводить по клеткам. Живой случай 27.09.2026 (E35S37) — оба
 * майнера на одном споте, второй не мог войти на занятую клетку и не добывал.
 *
 * С квотой miner = 1 конкурировать не с кем: майнер в комнате один, рабочие
 * места (две клетки, по одной на источник) он читает прямо из
 * Memory.rooms[room].minerSpots и берёт одно из двух — role.miner.js.
 * Поэтому и резервация, и проверка занятости, и пара спотов в памяти крипа
 * удалены целиком: они защищали от коллизии, которой при одном майнере быть
 * не может.
 */

const factory = {
  blueprints: {
    miner: spawn => {
      const roomName = spawn.room.name;
      const roomMemory = Memory.rooms[roomName] || {};

      // Рабочих мест в комнате нет — майнера не спавним: ему негде работать.
      // (Спотов два: по одной клетке на источник, Memory.rooms[r].minerSpots.)
      if (!roomMemory.minerSpots || roomMemory.minerSpots.length === 0) {
        return null;
      }

      // Место в памяти НЕ фиксируется: майнер берёт одно из двух рабочих мест
      // сам (role.miner.js, creep.memory.wp) и переходит на соседнее, когда
      // источник под ним вычерпан.
      return {
        body: prepareBody(CREEP_BODIES.miner),
        memory: {
          homeRoom: roomName,
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

    // Имя и threshold передаются в blueprint: threshold используют роли с
    // предспавном (PRESPAWN_THRESHOLD), имя — для отладки. Минеру с 01.10.2026
    // ни то, ни другое не нужно: место он берёт сам (role.miner.js).
    const name = `${role}_${roomName}_${Game.time}`;
    const blueprint = blueprintFn(spawn, threshold, name);

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

    return spawn.spawnCreep(blueprint.body, name, { memory });
  },
};

module.exports = factory;
