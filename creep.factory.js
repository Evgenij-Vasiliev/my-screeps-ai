/**
 * CREEP FACTORY (ТЗ №3)
 * Отвечает на вопрос: "Какое тело создать?" и производит спавн.
 * prepareBody — порядок частей: TOUGH → WORK → CARRY → MOVE
 */

const { CREEP_BODIES, SPAWN, LAB_BOOST } = require("./constants");

const PART_COST =
  typeof BODYPART_COST !== "undefined"
    ? BODYPART_COST
    : { work: 100, carry: 50, move: 50, tough: 10, attack: 80, ranged_attack: 150, heal: 250, claim: 600 };

function bodyCost(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += PART_COST[body[i]] || 0;
  return sum;
}

const prepareBody = ({ work = 0, carry = 0, move = 0, tough = 0 } = {}) => {
  const body = [];

  for (let i = 0; i < tough; i++) body.push(TOUGH);
  for (let i = 0; i < work; i++) body.push(WORK);
  for (let i = 0; i < carry; i++) body.push(CARRY);
  for (let i = 0; i < move; i++) body.push(MOVE);

  return body;
};

/**
 * Есть ли полный комплект буста для уменьшенного тела.
 * Проверяем наличие буст-лабы и суммарный запас KH/UO на складах/терминалах.
 * Если буста нет — спавним полное тело, чтобы крип не потерял производительность.
 */
function boostReady(roomName, role, resource) {
  const policy = LAB_BOOST.BOOST_POLICY[role];
  const row = policy && policy[0];
  if (!row || row.resource !== resource) return false;

  const mem = Memory.rooms && Memory.rooms[roomName];
  const map = (mem && mem.boostLabs) || null;
  const fallback = LAB_BOOST.BOOST_LAB && LAB_BOOST.BOOST_LAB[roomName];
  const labId = map && map[resource] || fallback && fallback[resource] || mem && mem.boostLab;
  if (!labId || typeof Game.getObjectById !== "function") return false;

  const lab = Game.getObjectById(labId);
  if (!lab || !lab.store) return false;
  if (lab.mineralType && lab.mineralType !== resource) return false;

  const need = row.parts * 30;
  let stock = lab.store[resource] || 0;
  const rooms = Game.rooms || {};
  for (const name in rooms) {
    const room = rooms[name];
    if (!room || !room.controller || !room.controller.my) continue;
    if (room.storage) stock += room.storage.store[resource] || 0;
    if (room.terminal) stock += room.terminal.store[resource] || 0;
  }
  return stock >= need;
}

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
        body: prepareBody(
          boostReady(roomName, "miner", "UO")
            ? CREEP_BODIES.minerBoosted
            : CREEP_BODIES.miner,
        ),
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

    labWorker: () => ({
      body: prepareBody(CREEP_BODIES.labWorker),
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

    worker: spawn => ({
      body: prepareBody(
        boostReady(spawn && spawn.room ? spawn.room.name : "", "worker", "KH")
          ? CREEP_BODIES.workerBoosted
          : CREEP_BODIES.worker,
      ),
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

  /** Тело и стоимость аварийного восстановительного крипа. */
  emergencyBody: function () {
    return prepareBody(SPAWN.EMERGENCY_BODY);
  },
  emergencyCost: function () {
    return bodyCost(this.emergencyBody());
  },
  runEmergency: function (spawn, roomName) {
    const body = this.emergencyBody();
    const cost = bodyCost(body);
    if (!spawn || !spawn.room || spawn.room.energyAvailable < cost) {
      return ERR_NOT_ENOUGH_ENERGY;
    }
    const name = `worker_${roomName}_${Game.time}_e`;
    return spawn.spawnCreep(body, name, {
      // extra: аварийный крип не должен занимать квоту SPAWN_QUOTA.worker,
      // иначе обычный полноценный worker никогда не появится.
      memory: { role: "worker", homeRoom: roomName, extra: "emergency" },
    });
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

  /**
   * Дополнительный крип комнаты (systems.extraCreeps), сверх квоты.
   * Тело из группы, а если не задано — из CREEP_BODIES роли.
   * @param {StructureSpawn} spawn
   * @param {Object} group запись из systems.extraCreeps[комната]
   * @param {string} key ключ группы, например "E37S38#0"
   * @param {string} roomName
   * @returns {ScreepsReturnCode}
   */
  runExtra: function (spawn, group, key, roomName) {
    const blueprintFn = this.blueprints[group.role];
    if (!blueprintFn) return ERR_INVALID_ARGS;

    const name = `${group.role}_${roomName}_${Game.time}_x`;
    const blueprint = blueprintFn(spawn, undefined, name);
    if (!blueprint) return ERR_INVALID_ARGS;

    const body = group.body ? prepareBody(group.body) : blueprint.body;
    if (!body || body.length === 0) return ERR_INVALID_ARGS;

    const memory = Object.assign(
      { role: group.role, homeRoom: roomName },
      blueprint.memory,
      {
        extra: key,
        tasks: Array.isArray(group.tasks) ? group.tasks.slice() : "all",
        ignoreReserves: group.ignoreReserves === true,
      },
    );

    return spawn.spawnCreep(body, name, { memory });
  },
};

module.exports = factory;
