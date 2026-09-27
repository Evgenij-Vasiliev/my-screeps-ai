/**
 * МЕНЕДЖЕР КОМНАТ (Room Manager)
 * Единая точка входа уровня комнаты. Строит roomState для каждой комнаты
 * и запускает для неё все комнатные подсистемы: спавн, задачи воркеров,
 * логику крипов, башни, линки, фабрику.
 *
 * Уровень империи (empire.js) знает только про очистку памяти,
 * вызов Room Manager'а и глобальный рынок — вся комнатная логика здесь.
 */
const scanner = require("scanner");
const { getRoomRole } = require("roomRoles");
const mineralManager = require("mineral.manager");
const taskManager = require("task.manager");
const taskGenerators = require("task.generators");
const spawnManager = require("spawn.manager");
const factoryManager = require("factory.manager");
const powerSpawnManager = require("powerSpawn.manager");
const linkManager = require("linkManager");
const roleTower = require("role.tower");

const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");
const roleRepairer = require("role.repairer");
const roleMiner = require("role.miner");
const roleTowerSupplier = require("role.towerSupplier");
const roleLinkWorker = require("role.linkWorker");
const roleMineralMiner = require("role.mineralMiner");
const workerRunner = require("worker.runner");
const cpuMonitor = require("cpuMonitor");
const { TOWER } = require("./constants");

const ROLES = {
  harvester: roleHarvester,
  upgrader: roleUpgrader,
  builder: roleBuilder,
  repairer: roleRepairer,
  miner: roleMiner,
  towerSupplier: roleTowerSupplier,
  linkWorker: roleLinkWorker,
  mineralMiner: roleMineralMiner,
  worker: workerRunner,
};

function runCreep(creep, roomState) {
  const roleModule = ROLES[creep.memory.role];
  if (!roleModule) return;

  try {
    roleModule.run(creep, roomState);
  } catch (e) {
    console.log(`[RoomManager] Ошибка у крипа ${creep.name}: ${e.stack || e}`);
  }
}

function runCreepLogic(roomState) {
  // Обычный режим: без замеров на каждом крипе. Два Game.cpu.getUsed() и
  // замыкание на крипа стоили больше, чем весь остальной оверхед логики
  // (замерено: getUsed() = 0.000244 CPU), а разбивка по ролям нужна редко.
  if (!cpuMonitor.verboseEnabled()) {
    for (const creep of roomState.creeps) {
      if (creep) runCreep(creep, roomState);
    }
    return;
  }

  // Подробный режим (Memory.cpuMonitorVerbose = true) — замер по каждому крипу.
  for (const creep of roomState.creeps) {
    if (!creep) continue;
    cpuMonitor.trackRole(creep.memory.role, () => runCreep(creep, roomState));
  }
}

/** Добавляет в out повреждённые структуры из списка (hits < hitsMax). */
function collectDamaged(structures, out) {
  for (let i = 0; i < structures.length; i++) {
    const s = structures[i];
    if (s.hits < s.hitsMax) out.push(s);
  }
}

/** Резолвит массив id в объекты, пропуская исчезнувшие. */
function resolveByIds(ids) {
  const out = [];
  if (!ids) return out;
  for (let i = 0; i < ids.length; i++) {
    const obj = Game.getObjectById(ids[i]);
    if (obj) out.push(obj);
  }
  return out;
}

/**
 * Стены и валы комнаты — ЛЕНИВО (задание 7 плана).
 *
 * Раньше buildRoomState резолвил их каждый тик на каждую комнату: это
 * сотни Game.getObjectById (замерено 0.000152 CPU каждый) на комнату за
 * тик, тогда как нужны они раз в TOWER.REPAIR_INTERVAL тиков (ремонт) и
 * раз в TOWER.HOSTILE_CHECK_INTERVAL тиков (резервный детектор атаки).
 *
 * Результат мемоизируется на объекте roomState, а тот живёт один тик —
 * поэтому отдельной инвалидации не требуется.
 */
function getWallsAndRamparts(roomState) {
  if (!roomState._wallsAndRamparts) {
    roomState._wallsAndRamparts = resolveByIds(roomState.wallIds).concat(
      resolveByIds(roomState.rampartIds),
    );
  }
  return roomState._wallsAndRamparts;
}

/** Состояние комнаты, которому не обязательно переживать рестарт. */
function roomHeap(roomName) {
  if (!global.__roomHeap) global.__roomHeap = {};
  if (!global.__roomHeap[roomName]) global.__roomHeap[roomName] = {};
  return global.__roomHeap[roomName];
}

/**
 * Записывает флаг атаки в Memory ТОЛЬКО при смене значения.
 * Раньше underAttack переписывался каждый тик на каждую комнату, хотя
 * меняется раз в сотни тиков.
 */
function setUnderAttack(roomName, underAttack) {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};

  if (Memory.rooms[roomName].underAttack !== underAttack) {
    Memory.rooms[roomName].underAttack = underAttack;
  }
}

function detectAttack(roomState) {
  const roomName = roomState.roomName;
  const ATTACK_DROP_THRESHOLD = 1500;

  const wallsAndRamparts = getWallsAndRamparts(roomState);

  let currentTotalHits = 0;
  for (let i = 0; i < wallsAndRamparts.length; i++) {
    currentTotalHits += wallsAndRamparts[i].hits;
  }

  // lastWallHits — в heap: это детектор, а не состояние Империи. После
  // рестарта он просто начнёт отсчёт заново (как при первом запуске).
  const heap = roomHeap(roomName);
  const previousTotalHits = heap.lastWallHits;
  heap.lastWallHits = currentTotalHits;

  if (previousTotalHits === undefined) {
    return false;
  }

  return previousTotalHits - currentTotalHits > ATTACK_DROP_THRESHOLD;
}

function runTowerLogic(roomState) {
  cpuMonitor.trackRole("towers", () => {
    if (!roomState.towers || roomState.towers.length === 0) return;

    const roomName = roomState.roomName;
    const heap = roomHeap(roomName);
    // После рестарта heap пуст — подхватываем последнее известное значение
    // из Memory, чтобы не потерять тик на повторное обнаружение атаки.
    if (heap.underAttack === undefined) {
      heap.underAttack = !!(
        Memory.rooms &&
        Memory.rooms[roomName] &&
        Memory.rooms[roomName].underAttack
      );
    }

    // Основной сигнал — присутствие враждебных крипов. room.find движок
    // кэширует в пределах тика, и это дешевле JS-обхода списка id стен.
    const hostiles = roomState.room.find(FIND_HOSTILE_CREEPS);
    let underAttack = hostiles.length > 0;

    // Резервный сигнал — падение hits стен и валов: стены могут бить и без
    // враждебных крипов в поле зрения. Обход дорогой, поэтому раз в
    // TOWER.HOSTILE_CHECK_INTERVAL тиков, а не каждый тик.
    if (
      !underAttack &&
      Game.time % TOWER.HOSTILE_CHECK_INTERVAL === 0 &&
      detectAttack(roomState)
    ) {
      underAttack = true;
    }

    const roomData = { hostiles: underAttack ? hostiles : [] };

    heap.underAttack = underAttack;
    setUnderAttack(roomName, underAttack);

    if (Game.time % TOWER.REPAIR_INTERVAL === 0) {
      // Только крипы, физически находящиеся в комнате: heal() по крипу
      // из другой комнаты — бесполезный интент.
      roomData.woundedCreep = roomState.creepsInRoom.find(
        c => c.hits < c.hitsMax,
      );

      const wallThreshold =
        roomState.room.memory.wallThreshold || TOWER.WALL_THRESHOLD_DEFAULT;

      // Поиск самой повреждённой стены/рампарта одним проходом, без filter+sort
      let weakestWallOrRampart = null;
      let foundBelowThreshold = false;
      const wallsAndRamparts = getWallsAndRamparts(roomState);

      for (let i = 0; i < wallsAndRamparts.length; i++) {
        const s = wallsAndRamparts[i];
        if (s.hits < wallThreshold) {
          foundBelowThreshold = true;
          if (
            weakestWallOrRampart === null ||
            s.hits < weakestWallOrRampart.hits
          ) {
            weakestWallOrRampart = s;
          }
        }
      }

      if (!foundBelowThreshold) {
        roomState.room.memory.wallThreshold =
          wallThreshold + TOWER.WALL_THRESHOLD_STEP;
      }
      roomData.wallsAndRamparts = weakestWallOrRampart
        ? [weakestWallOrRampart]
        : [];

      // Поиск самого повреждённого здания одним проходом, без sort
      let weakestDamagedStructure = null;
      const damagedStructures = roomState.damagedStructures;
      for (let i = 0; i < damagedStructures.length; i++) {
        const s = damagedStructures[i];
        if (
          weakestDamagedStructure === null ||
          s.hits < weakestDamagedStructure.hits
        ) {
          weakestDamagedStructure = s;
        }
      }
      roomData.damagedStructure = weakestDamagedStructure;
    }

    for (const tower of roomState.towers) {
      roleTower.run(tower, roomData);
    }
  });
}

function runLinkLogic(roomState) {
  cpuMonitor.trackRole("linkManager", () => {
    try {
      linkManager.run(roomState);
    } catch (e) {
      console.log(
        `[RoomManager] Ошибка linkManager в комнате ${roomState.roomName}: ${
          e.stack || e
        }`,
      );
    }
  });
}

module.exports = {
  // Экспортируется для офлайн-тестов (tests/tower.attack.test.js):
  // логика башен и детектор атаки проверяются без запуска всего цикла.
  runTowerLogic,
  detectAttack,

  /**
   * Возвращает массив всех комнат, принадлежащих игроку.
   * @returns {Room[]}
   */
  getOwnedRooms: function () {
    // for...in вместо Object.values().filter(): без массива всех видимых
    // комнат и без промежуточного массива на фильтрацию.
    const owned = [];
    for (const name in Game.rooms) {
      const room = Game.rooms[name];
      if (room && room.controller && room.controller.my) owned.push(room);
    }
    return owned;
  },

  /**
   * Строит объект состояния для одной комнаты.
   * @param {Room} room
   * @returns {Object} roomState
   */
  buildRoomState: function (room, precomputedCreeps, precomputedCreepsInRoom) {
    const cache = scanner.getStructureCache(room);

    // Один проход с push вместо map().filter() на каждую группу: было 13 пар
    // массивов-посредников на комнату за тик, осталось 13 итоговых.
    const grouped = {
      spawns: resolveByIds(cache.spawnIds),
      towers: resolveByIds(cache.towerIds),
      links: resolveByIds(cache.linkIds),
      labs: resolveByIds(cache.labIds),
      extensions: resolveByIds(cache.extensionIds),
      roads: resolveByIds(cache.roadIds),
      factories: resolveByIds(cache.factoryId ? [cache.factoryId] : null),
      powerSpawns: resolveByIds(
        cache.powerSpawnId ? [cache.powerSpawnId] : null,
      ),
      observers: resolveByIds(cache.observerId ? [cache.observerId] : null),
      extractors: resolveByIds(cache.extractorId ? [cache.extractorId] : null),
      nukers: resolveByIds(cache.nukerId ? [cache.nukerId] : null),
    };

    const storage = cache.storageId
      ? Game.getObjectById(cache.storageId)
      : null;
    const terminal = cache.terminalId
      ? Game.getObjectById(cache.terminalId)
      : null;

    // Повреждённые структуры — один проход без промежуточных concat:
    // раньше здесь собирались 6 массивов ради одного filter().
    const damagedStructures = [];

    collectDamaged(grouped.spawns, damagedStructures);
    collectDamaged(grouped.towers, damagedStructures);
    collectDamaged(grouped.extensions, damagedStructures);
    collectDamaged(grouped.links, damagedStructures);
    collectDamaged(grouped.labs, damagedStructures);
    collectDamaged(grouped.roads, damagedStructures);
    collectDamaged(grouped.factories, damagedStructures);
    collectDamaged(grouped.powerSpawns, damagedStructures);
    collectDamaged(grouped.observers, damagedStructures);
    collectDamaged(grouped.extractors, damagedStructures);
    collectDamaged(grouped.nukers, damagedStructures);
    if (storage) collectDamaged([storage], damagedStructures);
    if (terminal) collectDamaged([terminal], damagedStructures);

    // Источники энергии — статичны, резолвятся из кэша
    const sources = resolveByIds(cache.sourceIds);

    // Крипы, приписанные к данной комнате — если список уже собран заранее
    // (buildAllRoomStates группирует всех крипов за один проход, а не за N),
    // используем его; иначе (прямой вызов buildRoomState) считаем сами.
    const creeps =
      precomputedCreeps ||
      Object.values(Game.creeps).filter(
        c => c.memory.homeRoom === room.name || c.room.name === room.name,
      );

    // Физически находящиеся в комнате — для задач, привязанных к месту
    // (лечение башней), а не к принадлежности крипа комнате.
    const creepsInRoom =
      precomputedCreepsInRoom ||
      Object.values(Game.creeps).filter(
        c => c.room && c.room.name === room.name,
      );

    return {
      room,
      roomName: room.name,
      role: getRoomRole(room),
      spawn: grouped.spawns[0] || null,
      spawns: grouped.spawns,
      controller: room.controller,
      storage,
      terminal,
      towers: grouped.towers,
      extensions: grouped.extensions,
      roads: grouped.roads,
      // Только id: объекты резолвятся лениво, см. getWallsAndRamparts.
      wallIds: cache.wallIds,
      rampartIds: cache.rampartIds,
      damagedStructures,
      creeps,
      creepsInRoom,
      // Стройплощадки комнаты из общего индекса (один проход за тик).
      constructionSites: scanner.getSitesByRoom()[room.name] || [],
      sources,
      links: grouped.links,
      labs: grouped.labs,
      factory: grouped.factories[0] || null,
      powerSpawn: grouped.powerSpawns[0] || null,
      observer: grouped.observers[0] || null,
      extractor: grouped.extractors[0] || null,
      nuker: grouped.nukers[0] || null,
      mineral: mineralManager.buildMineralState(room),
    };
  },

  /**
   * Возвращает массив roomState для всех собственных комнат.
   * @returns {Object[]} массив roomState
   */
  buildAllRoomStates: function () {
    const rooms = this.getOwnedRooms();
    const roomNames = new Set(rooms.map(r => r.name));

    // Один проход по всем крипам империи вместо повторного
    // Object.values(Game.creeps).filter() внутри buildRoomState на каждую комнату.
    //
    // ОДИН КРИП — РОВНО ОДИН roomState. Приоритет у homeRoom: именно он
    // «владеет» крипом (квоты ролей, спавн). Раньше крип попадал и в свою
    // homeRoom, и в текущую физическую комнату, если они различались, —
    // и исполнял логику дважды за тик, а countRole считал его дважды.
    //
    // Кто физически находится в комнате — отдельный список creepsInRoom
    // (нужен башням для лечения: лечить крипа из другой комнаты бессмысленно).
    const creepsByRoom = {};
    const creepsInRoom = {};

    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if (!c) continue;

      const homeRoom = c.memory.homeRoom;
      const currentRoom = c.room && c.room.name;

      if (currentRoom && roomNames.has(currentRoom)) {
        (creepsInRoom[currentRoom] = creepsInRoom[currentRoom] || []).push(c);
      }

      if (homeRoom && roomNames.has(homeRoom)) {
        (creepsByRoom[homeRoom] = creepsByRoom[homeRoom] || []).push(c);
      } else if (currentRoom && roomNames.has(currentRoom)) {
        (creepsByRoom[currentRoom] = creepsByRoom[currentRoom] || []).push(c);
      }
    }

    return rooms.map(room =>
      this.buildRoomState(
        room,
        creepsByRoom[room.name] || [],
        creepsInRoom[room.name] || [],
      ),
    );
  },

  /**
   * Запускает все комнатные подсистемы для одной комнаты:
   * спавн, задачи воркеров, крипы, башни, линки, фабрика.
   * @param {Object} roomState
   */
  runRoom: function (roomState) {
    cpuMonitor.trackRole("spawnManager", () => spawnManager.run(roomState));
    cpuMonitor.trackRole("taskManager", () => {
      taskGenerators.generateFillSpawnsExtensions(roomState);
      taskGenerators.generateFillPowerSpawnPower(roomState);
      taskGenerators.generateFillPowerSpawnEnergy(roomState);
      taskGenerators.generateFillFactoryEnergy(roomState);
      taskGenerators.generateCollectFactoryBattery(roomState);
      taskGenerators.generateFillTerminalEnergy(roomState);
      taskGenerators.generateFillTerminalResources(roomState);
      taskGenerators.generateFillTowers(roomState);
      taskGenerators.generateRepairStructures(roomState);
      taskGenerators.generateBuildStructures(roomState);
      taskGenerators.generateUpgradeController(roomState);
    });
    runCreepLogic(roomState);
    runTowerLogic(roomState);
    runLinkLogic(roomState);
    cpuMonitor.trackRole("factoryManager", () => factoryManager.run(roomState));
    cpuMonitor.trackRole("powerSpawnManager", () =>
      powerSpawnManager.run(roomState),
    );
  },

  /**
   * Главный метод уровня комнат: строит состояния и запускает
   * логику для каждой собственной комнаты.
   * @returns {Object[]} массив roomState
   */
  run: function () {
    const roomStates = this.buildAllRoomStates();

    for (const roomState of roomStates) {
      this.runRoom(roomState);
    }

    return roomStates;
  },
};
