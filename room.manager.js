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
const taskGenerators = require("task.generators");
const spawnManager = require("spawn.manager");
const factoryManager = require("factory.manager");
const powerSpawnManager = require("powerSpawn.manager");
const linkManager = require("linkManager");
const labManager = require("lab.manager");
const roleTower = require("role.tower");

const roleHarvester = require("role.harvester");
const roleMiner = require("role.miner");
const roleLinkWorker = require("role.linkWorker");
const roleMineralMiner = require("role.mineralMiner");
const workerRunner = require("worker.runner");
const roleLabWorker = require("lab.worker");
const cpuMonitor = require("cpuMonitor");
const { TOWER } = require("./constants");

// Специализации, которые действительно спавнятся (см. SPAWN_QUOTA).
// Роли upgrader/builder/repairer/towerSupplier убраны: их квота равна 0 во всех
// комнатах, а всю их работу (включая прокачку контроллера, стройку, ремонт и
// подвоз башен) выполняет Task System через worker (worker.runner).
const ROLES = {
  harvester: roleHarvester,
  miner: roleMiner,
  linkWorker: roleLinkWorker,
  mineralMiner: roleMineralMiner,
  worker: workerRunner,
  labWorker: roleLabWorker,
};

function runCreepLogic(roomState) {
  for (const creep of roomState.creeps) {
    if (!creep) continue;
    const roleModule = ROLES[creep.memory.role];
    if (!roleModule) continue;

    // Задача 3 роадмапа (ТЗ №1): спавнящийся крип ещё не может действовать, но
    // его роль (worker) успела бы занять Task и держать резервацию «немой» до
    // конца спавна (десятки тиков для больших тел). Роль для него не выполняется.
    if (creep.spawning) continue;

    // ВАЖНО (ТЗ №0): бакет роли "worker" — это и есть выполнение Task System
    // (worker.runner: выбор задачи из FIFO Memory.rooms[].tasks + executor).
    // Отдельного бакета ему не нужно — имя бакета совпадает с ролью.
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

/**
 * Суммарные хиты стен/валов на прошлом скане. Хранится в heap, а не в Memory:
 * значение живёт ровно между двумя сканами (TOWER.WALL_SCAN_INTERVAL) и
 * больше никому не нужно, а запись в Memory каждый тик держала всю Memory
 * «грязной» ради одного числа.
 * @returns {Object<string, number>}
 */
function getWallHitsCache() {
  if (!global._towerWallHits) global._towerWallHits = {};
  return global._towerWallHits;
}

/**
 * Один проход по стенам и валам комнаты (выполняется раз в
 * TOWER.WALL_SCAN_INTERVAL тиков): суммарные хиты — сигнал «враг бьёт только
 * стены», плюс самая слабая стена/рампарт ниже порога ремонта. Разыменование
 * идёт по id из scanner-кэша, без map/filter/concat, то есть без аллокаций
 * массивов на каждый тик.
 * @param {Object} roomState
 * @returns {{ totalHits: number, weakest: any, wallThreshold: number }}
 */
function scanWallsAndRamparts(roomState) {
  const cache = scanner.getStructureCache(roomState.room);
  const wallThreshold =
    roomState.room.memory.wallThreshold || TOWER.WALL_THRESHOLD_DEFAULT;

  let totalHits = 0;
  let weakest = null;

  const wallIds = cache.wallIds;
  for (let i = 0; i < wallIds.length; i++) {
    const s = Game.getObjectById(wallIds[i]);
    if (!s) continue;
    totalHits += s.hits;
    if (s.hits < wallThreshold && (weakest === null || s.hits < weakest.hits)) {
      weakest = s;
    }
  }

  const rampartIds = cache.rampartIds;
  for (let i = 0; i < rampartIds.length; i++) {
    const s = Game.getObjectById(rampartIds[i]);
    if (!s) continue;
    totalHits += s.hits;
    if (s.hits < wallThreshold && (weakest === null || s.hits < weakest.hits)) {
      weakest = s;
    }
  }

  return { totalHits, weakest, wallThreshold };
}

/**
 * Список вражеских лекарей (их башни убивают первыми). Считается один раз на
 * комнату за тик, а не внутри roleTower.run для каждой башни: раньше
 * body.some(HEAL) прогонялся N_башен × N_врагов раз за тик.
 * @param {Creep[]} hostiles
 * @returns {Creep[]|null}
 */
function findHealers(hostiles) {
  let healers = null;

  for (let i = 0; i < hostiles.length; i++) {
    const body = hostiles[i].body;
    for (let j = 0; j < body.length; j++) {
      if (body[j].type === HEAL) {
        if (healers === null) healers = [];
        healers.push(hostiles[i]);
        break;
      }
    }
  }

  return healers;
}

/**
 * Возвращает самого сильно раненого союзного крипа, физически находящегося
 * в комнате башни, либо null. В roomState.creeps попадают и крипы с
 * homeRoom == комнаты, ушедшие в ремоут/на другой сквад — их башня вылечить
 * не может, поэтому фильтруем по текущей комнате. Выбирается крип с худшим
 * отношением hits/hitsMax (а не первый попавшийся), чтобы лечение спасало
 * именно того, кто вот-вот погибнет.
 * @param {Object} roomState
 * @param {string} roomName
 * @returns {Creep|null}
 */
function findWoundedCreep(roomState, roomName) {
  let wounded = null;
  let worstRatio = 1;

  for (let i = 0; i < roomState.creeps.length; i++) {
    const creep = roomState.creeps[i];
    if (creep.room.name !== roomName) continue;
    if (creep.hits >= creep.hitsMax) continue;

    const ratio = creep.hits / creep.hitsMax;
    if (ratio < worstRatio) {
      worstRatio = ratio;
      wounded = creep;
    }
  }

  return wounded;
}

function runTowerLogic(roomState) {
  cpuMonitor.trackRole("towers", () => {
    const towers = roomState.towers;
    if (!towers || towers.length === 0) return;

    const roomName = roomState.roomName;

    if (!Memory.rooms) Memory.rooms = {};
    const roomMemory = Memory.rooms[roomName] || (Memory.rooms[roomName] = {});

    // Врагов сканируем КАЖДЫЙ тик, а не "по тревоге". Раньше список
    // hostiles заполнялся только при Memory.rooms[].underAttack, который сам
    // вычислялся из этого же списка (всегда пустого) — из-за этого башни
    // молчали, пока враг не снесёт >1500 хитов стен за один тик.
    // room.find выполняется только в комнатах с башнями.
    const hostiles = roomState.room.find(FIND_HOSTILE_CREEPS);
    const hasHostiles = hostiles.length > 0;

    const roomData = {
      hostiles,
      // Лекарей ищем один раз на комнату (а не в каждой башне).
      healers: hasHostiles ? findHealers(hostiles) : null,
      // Раненый союзник нужен каждый тик: лечение не должно ждать
      // WALL_SCAN_INTERVAL и не должно блокироваться ремонтом (см. role.tower).
      woundedCreep: findWoundedCreep(roomState, roomName),
    };

    // Тяжёлая часть (стены/валы) выполняется только раз в
    // TOWER.WALL_SCAN_INTERVAL тиков — в тот же тик, в который башни
    // ремонтируют (REPAIR_INTERVAL), поэтому цели ремонта считаются тогда,
    // когда нужны, и ни один интент ремонта не теряется.
    let hitsDropped = false;

    if (Game.time % TOWER.WALL_SCAN_INTERVAL === 0) {
      const scan = scanWallsAndRamparts(roomState);

      if (scan.weakest) {
        roomData.wallTarget = scan.weakest;
      } else {
        // Стен ниже порога нет — поднимаем планку (как и раньше).
        roomMemory.wallThreshold =
          scan.wallThreshold + TOWER.WALL_THRESHOLD_STEP;
      }

      // Просадка суммарных хитов стен/валов — дополнительный признак атаки
      // (например, враг бьёт только стены/валы). Порог масштабирован на длину
      // интервала, чтобы чувствительность (хитов на тик) не изменилась.
      const wallHits = getWallHitsCache();
      const previousTotalHits = wallHits[roomName];
      wallHits[roomName] = scan.totalHits;
      hitsDropped =
        previousTotalHits !== undefined &&
        previousTotalHits - scan.totalHits >
          TOWER.HITS_DROP_THRESHOLD * TOWER.WALL_SCAN_INTERVAL;

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
      roomData.damagedTarget = weakestDamagedStructure;
    }

    // Пишем только при изменении: одно и то же значение каждый тик — лишний
    // нагрев Memory (её сериализация + парсинг в начале следующего тика).
    const underAttack = hasHostiles || hitsDropped;
    if (roomMemory.underAttack !== underAttack) {
      roomMemory.underAttack = underAttack;
    }

    for (const tower of towers) {
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
      // walls/ramparts здесь НЕ разыменовываются: их читает только
      // runTowerLogic, и только раз в TOWER.WALL_SCAN_INTERVAL тиков —
      // напрямую по id из scanner-кэша (см. scanWallsAndRamparts).
      // Раньше на каждый тик в каждой комнате уходило ~190 Game.getObjectById
      // плюс два массива map/filter только ради башенного скана.
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
    cpuMonitor.trackRole("labManager", () => labManager.run(roomState.room));
    // Единая точка генерации задач с троттлингом по категориям
    // (TASK_GEN_INTERVAL в constants.js): генераторы идемпотентны, поэтому
    // дорогие сканы целей (ремонт, стройка) не обязаны идти каждый тик.
    cpuMonitor.trackRole("taskManager", () =>
      taskGenerators.runAll(roomState),
    );
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
   *
   * Профилирование (ТЗ №0): замеряются только два дополнительных крупных
   * блока — построение roomState всех комнат ("roomState") и полная
   * обработка одной комнаты (`room:<имя>`, она включает в себя уже
   * существующие бакеты spawnManager/labManager/taskManager/роли/towers/
   * linkManager/factoryManager/powerSpawnManager). Логика и порядок вызовов
   * не изменены — добавлены только обёртки измерения.
   * @returns {Object[]} массив roomState
   */
  run: function () {
    const roomStates = cpuMonitor.trackRole("roomState", () =>
      this.buildAllRoomStates(),
    );

    for (const roomState of roomStates) {
      cpuMonitor.trackRole(`room:${roomState.roomName}`, () =>
        this.runRoom(roomState),
      );
    }

    return roomStates;
  },
};
