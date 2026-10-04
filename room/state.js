// ===================================================
// ROOM/STATE.JS — сборка roomState комнаты
// ===================================================
// Часть разбиения room.manager.js (960 строк, 04.10.2026).
// Публичный API не изменился: наружу его отдаёт фасад room.manager.js
// (empire.js и консольные замеры зовут require("room.manager")).
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "room/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const scanner = require("scanner");
const { getRoomRole } = require("roomRoles");
const mineralManager = require("mineral.manager");

const { resolveByIds, getDamagedStructures } = require("./repair");

module.exports = {
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
      // roads убран: roomState.roads не читается ни одним модулем, а резолв
      // стоил Game.getObjectById на каждую дорогу комнаты (100-300 вызовов x
      // 0.000152 CPU = до 0.045 CPU/тик на комнату). Дороги нужны только как
      // кандидаты в ремонт — они и так попадают в damagedStructures через
      // генератор задач, который берёт их из сканера.
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

    // Повреждённые структуры больше НЕ собираются здесь (вариант B плана):
    // список строится лениво, при первом обращении через
    // getDamagedStructures (см. её комментарий). Потребители — генератор
    // repair-задач (task/gen.repair.js:68) и тесты; башни берут цель из
    // чисел кэша сканера (pickRepairTarget).

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
      // Только id: объекты резолвятся лениво, см. getWallsAndRamparts.
      wallIds: cache.wallIds,
      rampartIds: cache.rampartIds,
      // Список повреждённых — ленивый: пока его никто не читал, он не стоит
      // ни одного Game.getObjectById. Первое чтение мемоизируется на этом же
      // объекте (геттер подменяет себя массивом — roomState живёт один тик).
      get damagedStructures() {
        if (!this._damagedStructures) {
          this._damagedStructures = getDamagedStructures(this);
        }
        return this._damagedStructures;
      },
      // Кэш сканера: источник чисел и для ленивого резолва, и для генератора
      // repair-задач (он читает повреждённые дороги и структуры без резолва).
      _structureCache: cache,
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

};
