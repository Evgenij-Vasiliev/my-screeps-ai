/**
 * ГЛАВНЫЙ ЦИКЛ (Main Loop)
 * Многокомнатная архитектура: вся работа с комнатами — через roomManager.
 * Жёсткая привязка к именам и количеству комнат отсутствует.
 *
 * Link System (ТЗ №1 + ТЗ №2):
 *   Miner (фикс. позиция) → Source/Remote Link → LinkWorker → Storage → роли
 *
 * Очередь спавна и диспетчер ролей построены на простых объектах-таблицах
 * (QUOTA, ROLES) вместо цепочек if/else-if и switch/case — не нужно
 * дублировать структуру для каждой новой роли.
 */
const roomManager = require("roomManager");
const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");
const roleRepairer = require("role.repairer");
const roleMiner = require("role.miner");
const roleTower = require("role.tower");
const roleTowerSupplier = require("role.towerSupplier");
const roleLinkWorker = require("role.linkWorker");
const linkManager = require("linkManager");

// ─── Диспетчер ролей крипов ──────────────────────────────────────────────────
// Единственное место связи "имя роли -> модуль роли". Вместо switch/case —
// поиск в объекте, добавление новой роли не требует правки самого цикла.
const ROLES = {
  harvester: roleHarvester,
  upgrader: roleUpgrader,
  builder: roleBuilder,
  repairer: roleRepairer,
  miner: roleMiner,
  towerSupplier: roleTowerSupplier,
  linkWorker: roleLinkWorker,
};

// ─── Тела крипов по ролям ─────────────────────────────────────────────────────
// Единственное место определения состава тел.
// cost      — минимальная энергия для основного тела.
// emergency — аварийное тело: используется в режиме выживания,
//             когда энергии недостаточно для основного состава.
const CREEP_BODIES = {
  // Линковый майнер: 5 WORK (добыча) + 1 CARRY (перенос в линк) + 2 MOVE.
  miner: {
    body: [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE],
    cost: 650,
  },
  towerSupplier: { body: [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE], cost: 400 },
  linkWorker: { body: [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE], cost: 400 },
  harvester: {
    body: [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE],
    cost: 550,
    emergency: { body: [WORK, CARRY, MOVE], cost: 200 },
  },
  upgrader: {
    body: [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE],
    cost: 550,
  },
  builder: {
    body: [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE],
    cost: 550,
  },
  repairer: {
    body: [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE],
    cost: 550,
  },
};

// ─── Квоты спавна ─────────────────────────────────────────────────────────────
// Порядок ключей = приоритет (объекты в JS сохраняют порядок строковых
// ключей при переборе for..in / Object.keys). Одна роль — одна строка,
// без if/else-if цепочки.
const QUOTA = {
  harvester: 1,
  linkWorker: 1,
  miner: 2,
  towerSupplier: 1,
  repairer: 1,
  builder: 1,
  upgrader: 1,
};
const PRESPAWN_THRESHOLD = { miner: 50, linkWorker: 30 };

// ─── Спавн обычной роли (не miner) ────────────────────────────────────────────
/**
 * @param {Object} roomState
 * @param {string} role
 * @param {boolean} allowEmergency — разрешить аварийное тело при нехватке энергии
 * @returns {boolean} true — крип реально заспавнен в этот тик
 */
function spawnCreepForRoom(roomState, role, allowEmergency = false) {
  const spawn = roomState.spawn;
  if (!spawn || spawn.spawning) return false;

  const config = CREEP_BODIES[role];
  if (!config) return false;

  const energy = roomState.room.energyAvailable;

  // Для harvester аварийное тело разрешено ВСЕГДА по умолчанию: если
  // energyAvailable ниже стоимости полного тела (550), крип дороже 300
  // просто никогда не заспавнится, и очередь встанет намертво.
  if (role === "harvester") {
    allowEmergency = true;
  }

  let selected = null;
  if (energy >= config.cost) {
    selected = { body: config.body };
  } else if (
    allowEmergency &&
    config.emergency &&
    energy >= config.emergency.cost
  ) {
    selected = config.emergency;
  }

  if (!selected) return false;

  const result = spawn.spawnCreep(
    selected.body,
    `${role}_${roomState.roomName}_${Game.time}`,
    {
      memory: {
        role,
        homeRoom: roomState.roomName,
        state: "harvesting",
      },
    },
  );

  return result === OK;
}

// ─── Спавн майнера с фиксированным рабочим местом (Link System) ────────────
/**
 * Майнер v2 (линковая логистика):
 *   - не бегает по комнате, не ищет контейнер;
 *   - получает своё рабочее место (spot) один раз, при рождении;
 *   - место берётся из Memory.rooms[roomName].minerSpots (заполнено вручную,
 *     формат не меняется);
 *   - если все споты заняты живыми майнерами (ticksToLive > порога подмены) —
 *     не спавним; иначе назначаем наименее свежий спот на замену.
 * @param {Object} roomState
 * @returns {boolean} true — майнер реально заспавнен в этот тик
 */
function spawnMiner(roomState) {
  const spawn = roomState.spawn;
  if (!spawn || spawn.spawning) return false;

  const config = CREEP_BODIES.miner;
  const energy = roomState.room.energyAvailable;
  if (energy < config.cost) return false;

  const roomMemory = Memory.rooms[roomState.roomName] || {};
  const spots = roomMemory.minerSpots || [];
  if (spots.length === 0) return false; // споты не заданы — спавн невозможен

  const threshold = PRESPAWN_THRESHOLD.miner;
  let assignedSpot = null;
  for (const spot of spots) {
    const taken = _.some(
      Game.creeps,
      c =>
        c.memory.role === "miner" &&
        c.memory.homeRoom === roomState.roomName &&
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

  const result = spawn.spawnCreep(
    config.body,
    `miner_${roomState.roomName}_${Game.time}`,
    {
      memory: {
        role: "miner",
        homeRoom: roomState.roomName,
        spot: assignedSpot,
      },
    },
  );

  return result === OK;
}

// ─── Единая точка вызова спавна по роли ──────────────────────────────────────
// miner требует отдельной функции (назначение spot), остальные — через
// общую spawnCreepForRoom. Здесь и только здесь есть разница между ними.
function trySpawnRole(roomState, role) {
  if (role === "miner") return spawnMiner(roomState);
  return spawnCreepForRoom(roomState, role);
}

// ─── Логика спавна для одной комнаты ─────────────────────────────────────────
function runSpawnLogic(roomState) {
  const creeps = roomState.creeps;
  const count = role =>
    creeps.filter(c => {
      if (c.memory.role !== role) return false;
      const threshold = PRESPAWN_THRESHOLD[role];
      if (
        threshold !== undefined &&
        c.ticksToLive !== undefined &&
        c.ticksToLive < threshold
      ) {
        return false;
      }
      return true;
    }).length;
  // Режим выживания — аварийный харвестер с минимальным телом, в обход квот
  if (count("harvester") === 0) {
    spawnCreepForRoom(roomState, "harvester", true);
    return;
  }

  // Основная очередь: идём по QUOTA в порядке приоритета. Если попытка
  // спавна для роли не удалась (нет энергии, нет спота у майнера и т.п.) —
  // переходим к следующей роли в этот же тик, а не блокируемся молча.
  for (const role in QUOTA) {
    if (
      role === "upgrader" &&
      roomState.room.controller.ticksToDowngrade > 100000
    )
      continue;
    if (count(role) < QUOTA[role] && trySpawnRole(roomState, role)) return;
  }
}

// ─── Управление крипами одной комнаты ────────────────────────────────────────
function runCreepLogic(roomState) {
  for (const creep of roomState.creeps) {
    if (!creep) continue;
    const roleModule = ROLES[creep.memory.role];
    if (!roleModule) continue;
    try {
      roleModule.run(creep);
    } catch (e) {
      // Ошибка одного крипа не должна останавливать обработку остальных.
    }
  }
}

// ─── Управление башнями одной комнаты ────────────────────────────────────────
function runTowerLogic(roomState) {
  for (const tower of roomState.towers) {
    roleTower.run(tower);
  }
}

// ─── Управление линками одной комнаты (Link System) ──────────────────────────
function runLinkLogic(roomState) {
  try {
    linkManager.run(roomState);
  } catch (e) {
    // Ошибка linkManager не должна останавливать цикл.
  }
}

// ─── ГЛАВНЫЙ ЦИКЛ ─────────────────────────────────────────────────────────────
module.exports.loop = function () {
  // 1. Очистка памяти мёртвых крипов
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  // 2. Получаем состояние всех собственных комнат
  const allRooms = roomManager.buildAllRoomStates();

  // 3. Обрабатываем каждую комнату независимо
  for (const roomState of allRooms) {
    runSpawnLogic(roomState);
    runCreepLogic(roomState);
    runTowerLogic(roomState);
    runLinkLogic(roomState);
  }
};
