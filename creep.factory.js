/**
 * ФАБРИКА КРИПОВ (Creep Factory)
 * Фиксированные тела для каждой роли — энергии достаточно всегда.
 *
 * prepareBody — порядок частей оптимален:
 * TOUGH → WORK → CARRY → ATTACK → RANGED_ATTACK → HEAL → CLAIM → MOVE
 */

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
    // Стоит на рабочей клетке (x,y) в range 1 от источника и линка одновременно.
    // Свободный слот назначается при спавне — майнер сразу знает куда идти.
    miner: spawn => {
      const spots = (Memory.rooms[spawn.room.name] || {}).minerSpots || [];
      let assignedSpot = null;

      for (const spot of spots) {
        const taken = _.some(
          Game.creeps,
          c =>
            c.memory.role === "miner" &&
            c.memory.spot &&
            c.memory.spot.x === spot.x &&
            c.memory.spot.y === spot.y,
        );
        if (!taken) {
          assignedSpot = spot;
          break;
        }
      }

      return {
        body: prepareBody({ work: 5, carry: 1, move: 3 }),
        memory: { spot: assignedSpot },
      };
    },

    // Возит энергию из контейнеров. CARRY:MOVE = 2:1 (едет по дорогам).
    transporter: () => ({
      body: prepareBody({ carry: 4, move: 4 }),
      memory: {},
    }),

    // Носит энергию в башни. Башни близко — размер поменьше.
    towerSupplier: () => ({
      body: prepareBody({ carry: 8, move: 4 }),
      memory: {},
    }),

    // Аварийный крип — копает и везёт сам. Спавнится только если крипов нет.
    harvester: () => ({
      body: prepareBody({ work: 2, carry: 4, move: 6 }),
      memory: {},
    }),

    // Качает контроллер. Много WORK, CARRY для пополнения, MOVE по дорогам.
    upgrader: () => ({
      body: prepareBody({ work: 2, carry: 2, move: 2 }),
      memory: {},
    }),

    // Строит здания, запасной апгрейдер.
    builder: () => ({
      body: prepareBody({ work: 5, carry: 5, move: 5 }),
      memory: {},
    }),

    // Чинит дороги и контейнеры.
    repairer: () => ({
      body: prepareBody({ work: 4, carry: 4, move: 4 }),
      memory: {},
    }),

    // --- Заготовки (раскомментировать когда понадобятся) ---

    // claimer: (spawn, roleData) => ({
    //   body: prepareBody({ claim: 2, move: 4 }),
    //   memory: { targetRoom: roleData.targetRoom || null },
    // }),

    // remoteMiner: (spawn, roleData) => ({
    //   body: prepareBody({ work: 5, carry: 1, move: 5 }),
    //   memory: { targetRoom: roleData.targetRoom || null },
    // }),

    // remoteHauler: (spawn, roleData) => ({
    //   body: prepareBody({ carry: 20, move: 20 }),
    //   memory: { targetRoom: roleData.targetRoom || null },
    // }),

    // attacker: spawn => ({
    //   body: prepareBody({ tough: 2, move: 10, ranged_attack: 8, heal: 2 }),
    //   memory: { homeRoom: spawn.room.name },
    // }),

    default: () => ({
      body: prepareBody({ work: 1, carry: 1, move: 1 }),
      memory: {},
    }),
  },

  /**
   * @param {StructureSpawn} spawn
   * @param {string}         role     — название роли
   * @param {string}         roomName — для memory.room
   * @param {object}         roleData — доп. параметры (targetRoom и т.д.)
   */
  run: function (spawn, role, roomName, roleData = {}) {
    const blueprintFn = this.blueprints[role] || this.blueprints.default;
    const blueprint = blueprintFn(spawn, roleData);

    if (!blueprint.body || blueprint.body.length === 0) {
      console.log(`[factory] Пустое тело для роли ${role} в ${roomName}`);
      return ERR_INVALID_ARGS;
    }

    const memory = Object.assign(
      { role, room: roomName, working: false },
      blueprint.memory,
    );

    const name = `${role}_${roomName}_${Game.time}`;
    const result = spawn.spawnCreep(blueprint.body, name, { memory });

    if (result === OK) {
      const parts = _.countBy(blueprint.body);
      const summary = Object.entries(parts)
        .map(([p, n]) => `${p}×${n}`)
        .join(" ");
      console.log(`[factory] ${roomName}: +${role} [${summary}]`);
    } else if (result !== ERR_NOT_ENOUGH_ENERGY && result !== ERR_BUSY) {
      console.log(`[factory] Ошибка спавна ${role} в ${roomName}: ${result}`);
    }

    return result;
  },
};

module.exports = factory;
