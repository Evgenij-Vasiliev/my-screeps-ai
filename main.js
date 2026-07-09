/**
 * ГЛАВНЫЙ ЦИКЛ (Main Loop)
 * Многокомнатная архитектура: вся работа с комнатами — через roomManager.
 * Жёсткая привязка к именам и количеству комнат отсутствует.
 */
const roomManager = require("roomManager");
const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");
const roleMiner = require("role.miner");
const roleTransporter = require("role.transporter");
const roleTower = require("role.tower");
const roleTowerSupplier = require("role.towerSupplier");

// ─── Тела крипов по ролям ─────────────────────────────────────────────────────
// Единственное место определения состава тел.
// cost      — минимальная энергия для основного тела.
// emergency — аварийное тело: используется в режиме выживания,
//             когда энергии недостаточно для основного состава.
const CREEP_BODIES = {
  miner: { body: [WORK, WORK, WORK, WORK, WORK, MOVE], cost: 550 },
  transporter: { body: [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE], cost: 400 },
  towerSupplier: { body: [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE], cost: 400 },
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
};

// ─── Вспомогательная функция спавна через roomState ──────────────────────────
/**
 * Спавнит крипа в контексте конкретной комнаты.
 * Если энергии не хватает на основное тело — пробует аварийное (если есть).
 * @param {Object} roomState
 * @param {string} role
 * @param {boolean} allowEmergency — разрешить аварийное тело
 */
function spawnCreepForRoom(roomState, role, allowEmergency = false) {
  const spawn = roomState.spawn;
  if (!spawn || spawn.spawning) return;

  const config = CREEP_BODIES[role];
  if (!config) return;

  const energy = roomState.room.energyAvailable;

  // Выбираем тело: основное или аварийное
  let selected = null;
  if (energy >= config.cost) {
    selected = { body: config.body };
  } else if (
    allowEmergency &&
    config.emergency &&
    energy >= config.emergency.cost
  ) {
    selected = config.emergency;
    console.log(
      `[${roomState.roomName}] АВАРИЙНЫЙ спавн ${role} (emergency body)`,
    );
  }

  if (!selected) return;

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

  if (result === OK) {
    console.log(`[${roomState.roomName}] Spawning ${role}`);
  }
}

// ─── Логика спавна для одной комнаты ─────────────────────────────────────────
function runSpawnLogic(roomState) {
  const creeps = roomState.creeps;

  const count = role => creeps.filter(c => c.memory.role === role).length;

  const harvesters = count("harvester");
  const miners = count("miner");
  const transporters = count("transporter");
  const towerSuppliers = count("towerSupplier");
  const upgraders = count("upgrader");
  const builders = count("builder");

  // Режим выживания — аварийный харвестер с минимальным телом
  if (harvesters === 0) {
    spawnCreepForRoom(roomState, "harvester", true);
    return;
  }

  // Основная очередь спавна
  if (miners < 2) spawnCreepForRoom(roomState, "miner");
  else if (transporters < 2) spawnCreepForRoom(roomState, "transporter");
  else if (towerSuppliers < 2) spawnCreepForRoom(roomState, "towerSupplier");
  else if (harvesters < 1) spawnCreepForRoom(roomState, "harvester");
  else if (upgraders < 1) spawnCreepForRoom(roomState, "upgrader");
  else if (builders < 2) spawnCreepForRoom(roomState, "builder");
}

// ─── Управление крипами одной комнаты ────────────────────────────────────────
function runCreepLogic(roomState) {
  for (const creep of roomState.creeps) {
    if (!creep) continue;
    try {
      switch (creep.memory.role) {
        case "harvester":
          roleHarvester.run(creep);
          break;
        case "upgrader":
          roleUpgrader.run(creep);
          break;
        case "builder":
          roleBuilder.run(creep);
          break;
        case "miner":
          roleMiner.run(creep);
          break;
        case "transporter":
          roleTransporter.run(creep);
          break;
        case "towerSupplier":
          roleTowerSupplier.run(creep);
          break;
      }
    } catch (e) {
      console.log(
        `[${roomState.roomName}] Ошибка крипа ${creep.name}: ${e.message}`,
      );
    }
  }
}

// ─── Управление башнями одной комнаты ────────────────────────────────────────
function runTowerLogic(roomState) {
  for (const tower of roomState.towers) {
    roleTower.run(tower);
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
  }
};
