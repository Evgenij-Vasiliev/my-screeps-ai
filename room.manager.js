/**
 * МЕНЕДЖЕР КОМНАТ (Room Manager)
 * Единая точка входа уровня комнаты. Строит roomState для каждой комнаты
 * и запускает для неё все комнатные подсистемы: спавн, задачи воркеров,
 * логику крипов, башни, линки, фабрику.
 *
 * Уровень империи (empire.js) знает только про очистку памяти,
 * вызов Room Manager'а и глобальный рынок — вся комнатная логика здесь.
 */
const { getRoomRole } = require("roomRoles");
const mineralManager = require("mineral.manager");
const taskManager = require("task.manager");
const taskGenerators = require("task.generators");
const spawnManager = require("spawn.manager");
const factoryManager = require("factory.manager");
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

const STRUCTURE_BUCKETS = {
  [STRUCTURE_SPAWN]: "spawns",
  [STRUCTURE_TOWER]: "towers",
  [STRUCTURE_LINK]: "links",
  [STRUCTURE_LAB]: "labs",
  [STRUCTURE_FACTORY]: "factories",
};

function runCreepLogic(roomState) {
  for (const creep of roomState.creeps) {
    if (!creep) continue;
    const roleModule = ROLES[creep.memory.role];
    if (!roleModule) continue;
    cpuMonitor.trackRole(creep.memory.role, () => {
      try {
        roleModule.run(creep);
      } catch (e) {
        console.log(
          `[RoomManager] Ошибка у крипа ${creep.name}: ${e.stack || e}`,
        );
      }
    });
  }
}

function runTowerLogic(roomState) {
  cpuMonitor.trackRole("towers", () => {
    if (!roomState.towers || roomState.towers.length === 0) return;

    const room = roomState.room;
    const roomData = {
      hostiles: room.find(FIND_HOSTILE_CREEPS),
    };

    if (Game.time % TOWER.REPAIR_INTERVAL === 0) {
      roomData.woundedCreep = room.find(FIND_MY_CREEPS, {
        filter: c => c.hits < c.hitsMax,
      })[0];

      const wallThreshold =
        room.memory.wallThreshold || TOWER.WALL_THRESHOLD_DEFAULT;
      const wallsAndRamparts = room
        .find(FIND_STRUCTURES, {
          filter: s =>
            (s.structureType === STRUCTURE_WALL ||
              s.structureType === STRUCTURE_RAMPART) &&
            s.hits < wallThreshold,
        })
        .sort((a, b) => a.hits - b.hits);

      // Порог поднимается один раз на комнату за тик, а не за каждую башню
      if (wallsAndRamparts.length === 0) {
        room.memory.wallThreshold = wallThreshold + TOWER.WALL_THRESHOLD_STEP;
      }
      roomData.wallsAndRamparts = wallsAndRamparts;

      roomData.damagedStructure = room
        .find(FIND_STRUCTURES, {
          filter: s =>
            s.hits < s.hitsMax &&
            s.structureType !== STRUCTURE_WALL &&
            s.structureType !== STRUCTURE_RAMPART,
        })
        .sort((a, b) => a.hits - b.hits)[0];
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
    const structures = room.find(FIND_MY_STRUCTURES);

    const grouped = {
      spawns: [],
      towers: [],
      links: [],
      labs: [],
      factories: [],
    };
    for (const s of structures) {
      const bucket = STRUCTURE_BUCKETS[s.structureType];
      if (bucket) grouped[bucket].push(s);
    }

    // Контейнеры — не owned-структуры, ищем отдельно
    const containers = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER,
    });

    // Источники энергии
    const sources = room.find(FIND_SOURCES);

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
      storage: room.storage || null,
      terminal: room.terminal || null,
      towers: grouped.towers,
      creeps,
      sources,
      containers,
      links: grouped.links,
      labs: grouped.labs,
      factory: grouped.factories[0] || null,
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
    cpuMonitor.trackRole("taskManager", () =>
      taskGenerators.generateFillSpawnsExtensions(
        Game.rooms[roomState.roomName],
      ),
    );
    runCreepLogic(roomState);
    runTowerLogic(roomState);
    runLinkLogic(roomState);
    cpuMonitor.trackRole("factoryManager", () => factoryManager.run(roomState));
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
