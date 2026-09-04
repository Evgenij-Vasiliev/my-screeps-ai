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

function runCreepLogic(roomState) {
  for (const creep of roomState.creeps) {
    if (!creep) continue;
    const roleModule = ROLES[creep.memory.role];
    if (!roleModule) continue;
    cpuMonitor.trackRole(creep.memory.role, () => {
      try {
        roleModule.run(creep, roomState);
      } catch (e) {
        console.log(
          `[RoomManager] Ошибка у крипа ${creep.name}: ${e.stack || e}`,
        );
      }
    });
  }
}

function detectAttack(roomState) {
  const roomName = roomState.roomName;
  const ATTACK_DROP_THRESHOLD = 1500;

  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};

  const wallsAndRamparts = []
    .concat(roomState.walls)
    .concat(roomState.ramparts);

  const currentTotalHits = wallsAndRamparts.reduce((sum, s) => sum + s.hits, 0);
  const previousTotalHits = Memory.rooms[roomName].lastWallHits;

  Memory.rooms[roomName].lastWallHits = currentTotalHits;

  if (previousTotalHits === undefined) {
    return false;
  }

  return previousTotalHits - currentTotalHits > ATTACK_DROP_THRESHOLD;
}

function runTowerLogic(roomState) {
  cpuMonitor.trackRole("towers", () => {
    if (!roomState.towers || roomState.towers.length === 0) return;

    const roomName = roomState.roomName;
    const wasUnderAttack =
      Memory.rooms[roomName] && Memory.rooms[roomName].underAttack;
    const hitsDropped = detectAttack(roomState);

    const roomData = {};

    if (wasUnderAttack || hitsDropped) {
      roomData.hostiles = roomState.room.find(FIND_HOSTILE_CREEPS);
    } else {
      roomData.hostiles = [];
    }

    Memory.rooms[roomName].underAttack = roomData.hostiles.length > 0;

    if (Game.time % TOWER.REPAIR_INTERVAL === 0) {
      roomData.woundedCreep = roomState.creeps.find(c => c.hits < c.hitsMax);

      const wallThreshold =
        roomState.room.memory.wallThreshold || TOWER.WALL_THRESHOLD_DEFAULT;

      // Поиск самой повреждённой стены/рампарта одним проходом, без filter+sort
      let weakestWallOrRampart = null;
      let foundBelowThreshold = false;
      const wallsAndRamparts = []
        .concat(roomState.walls)
        .concat(roomState.ramparts);

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
  /**
   * Возвращает массив всех комнат, принадлежащих игроку.
   * @returns {Room[]}
   */
  getOwnedRooms: function () {
    return Object.values(Game.rooms).filter(
      room => room.controller && room.controller.my,
    );
  },

  /**
   * Строит объект состояния для одной комнаты.
   * @param {Room} room
   * @returns {Object} roomState
   */
  buildRoomState: function (room, precomputedCreeps) {
    const cache = scanner.getStructureCache(room);

    const grouped = {
      spawns: cache.spawnIds.map(id => Game.getObjectById(id)).filter(Boolean),
      towers: cache.towerIds.map(id => Game.getObjectById(id)).filter(Boolean),
      links: cache.linkIds.map(id => Game.getObjectById(id)).filter(Boolean),
      labs: cache.labIds.map(id => Game.getObjectById(id)).filter(Boolean),
      extensions: cache.extensionIds
        .map(id => Game.getObjectById(id))
        .filter(Boolean),
      roads: cache.roadIds.map(id => Game.getObjectById(id)).filter(Boolean),
      walls: cache.wallIds.map(id => Game.getObjectById(id)).filter(Boolean),
      ramparts: cache.rampartIds
        .map(id => Game.getObjectById(id))
        .filter(Boolean),
      factories: cache.factoryId
        ? [Game.getObjectById(cache.factoryId)].filter(Boolean)
        : [],
      powerSpawns: cache.powerSpawnId
        ? [Game.getObjectById(cache.powerSpawnId)].filter(Boolean)
        : [],
      observers: cache.observerId
        ? [Game.getObjectById(cache.observerId)].filter(Boolean)
        : [],
      extractors: cache.extractorId
        ? [Game.getObjectById(cache.extractorId)].filter(Boolean)
        : [],
      nukers: cache.nukerId
        ? [Game.getObjectById(cache.nukerId)].filter(Boolean)
        : [],
    };

    const allStructuresForRepair = []
      .concat(grouped.spawns)
      .concat(grouped.towers)
      .concat(grouped.extensions)
      .concat(grouped.links)
      .concat(grouped.labs)
      .concat(grouped.roads);

    if (grouped.factories[0]) allStructuresForRepair.push(grouped.factories[0]);
    if (grouped.powerSpawns[0])
      allStructuresForRepair.push(grouped.powerSpawns[0]);
    if (cache.storageId) {
      const s = Game.getObjectById(cache.storageId);
      if (s) allStructuresForRepair.push(s);
    }
    if (cache.terminalId) {
      const t = Game.getObjectById(cache.terminalId);
      if (t) allStructuresForRepair.push(t);
    }
    if (grouped.observers[0]) allStructuresForRepair.push(grouped.observers[0]);
    if (grouped.extractors[0])
      allStructuresForRepair.push(grouped.extractors[0]);
    if (grouped.nukers[0]) allStructuresForRepair.push(grouped.nukers[0]);

    const damagedStructures = allStructuresForRepair.filter(
      s => s.hits < s.hitsMax,
    );

    // Источники энергии — статичны, резолвятся из кэша
    const sources = cache.sourceIds
      .map(id => Game.getObjectById(id))
      .filter(Boolean);

    // Крипы, приписанные к данной комнате — если список уже собран заранее
    // (buildAllRoomStates группирует всех крипов за один проход, а не за N),
    // используем его; иначе (прямой вызов buildRoomState) считаем сами.
    const creeps =
      precomputedCreeps ||
      Object.values(Game.creeps).filter(
        c => c.memory.homeRoom === room.name || c.room.name === room.name,
      );

    return {
      room,
      roomName: room.name,
      role: getRoomRole(room),
      spawn: grouped.spawns[0] || null,
      spawns: grouped.spawns,
      controller: room.controller,
      storage: cache.storageId ? Game.getObjectById(cache.storageId) : null,
      terminal: cache.terminalId ? Game.getObjectById(cache.terminalId) : null,
      towers: grouped.towers,
      extensions: grouped.extensions,
      roads: grouped.roads,
      walls: grouped.walls,
      ramparts: grouped.ramparts,
      damagedStructures,
      creeps,
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
    // Сохраняем оригинальное поведение: крип может попасть в список и своей
    // homeRoom, и текущей физической комнаты, если они различаются.
    const creepsByRoom = {};
    for (const c of Object.values(Game.creeps)) {
      const homeRoom = c.memory.homeRoom;
      const currentRoom = c.room.name;

      if (homeRoom && roomNames.has(homeRoom)) {
        (creepsByRoom[homeRoom] = creepsByRoom[homeRoom] || []).push(c);
      }
      if (currentRoom !== homeRoom && roomNames.has(currentRoom)) {
        (creepsByRoom[currentRoom] = creepsByRoom[currentRoom] || []).push(c);
      }
    }

    return rooms.map(room =>
      this.buildRoomState(room, creepsByRoom[room.name] || []),
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
