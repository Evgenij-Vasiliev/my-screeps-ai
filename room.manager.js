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

const ROLES = {
  harvester: roleHarvester,
  upgrader: roleUpgrader,
  builder: roleBuilder,
  repairer: roleRepairer,
  miner: roleMiner,
  towerSupplier: roleTowerSupplier,
  linkWorker: roleLinkWorker,
  mineralMiner: roleMineralMiner,
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
    try {
      roleModule.run(creep);
    } catch (e) {
      console.log(
        `[RoomManager] Ошибка у крипа ${creep.name}: ${e.stack || e}`,
      );
    }
  }
}

function runTowerLogic(roomState) {
  for (const tower of roomState.towers) {
    roleTower.run(tower);
  }
}

function runLinkLogic(roomState) {
  try {
    linkManager.run(roomState);
  } catch (e) {
    console.log(
      `[RoomManager] Ошибка linkManager в комнате ${roomState.roomName}: ${
        e.stack || e
      }`,
    );
  }
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
  buildRoomState: function (room) {
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

    // Крипы, приписанные к данной комнате
    const creeps = Object.values(Game.creeps).filter(
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
    return this.getOwnedRooms().map(room => this.buildRoomState(room));
  },

  /**
   * Запускает все комнатные подсистемы для одной комнаты:
   * спавн, задачи воркеров, крипы, башни, линки, фабрика.
   * @param {Object} roomState
   */
  runRoom: function (roomState) {
    spawnManager.run(roomState);
    taskManager.run(roomState);
    runCreepLogic(roomState);
    runTowerLogic(roomState);
    runLinkLogic(roomState);
    factoryManager.run(roomState);
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
