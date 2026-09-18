/**
 * To start using Traveler, require it in main.js:
 *
 * There are 6 options available to pass to the module. Options are passed in the form
 * of an object with one or more of the following:
 *
 * exportTraveler: boolean Whether the require() should return the Traveler class. Defaults to true.
 * installTraveler: boolean Whether the Traveler class should be stored in `global.Traveler`. Defaults to false.
 * installPrototype: boolean Whether Creep.prototype.travelTo() should be created. Defaults to true.
 *                    Нативный Creep.prototype.moveTo() НЕ подменяется: тактический
 *                    шаг боя (defense.attacker) сознательно использует его (см. аудит, п. 5 «Что НЕ менять»).
 * hostileLocation: string Where in Memory a list of hostile rooms can be found. If it can be found in
 * Memory.empire, use 'empire'. Defaults to 'empire'.
 * maxOps: integer The maximum number of operations PathFinder should use. Defaults to 20000
 * defaultStuckValue: integer The maximum number of ticks the creep is in the same RoomPosition before it
 * determines it is stuck and repaths.
 * reportThreshold: integer The mimimum CPU used on pathing to console.log() warnings on CPU usage. Defaults to 50
 * incompleteReportCooldown: integer Не чаще, чем раз в столько тиков, писать в консоль про одну и ту же
 * неудачную цель (иначе в пробке лог печатается на каждый пересчёт пути). Defaults to 50
 * noPathRetryTicks: integer Пауза в тиках перед повторным поиском пути, если предыдущий поиск не дал
 * ни одной клетки пути (иначе дорогой PathFinder.search вызывается каждый тик впустую). Defaults to 5
 *
 * Examples: var Traveler = require('Traveler')();
 * require('util.traveler')({exportTraveler: false, installTraveler: false, installPrototype: true, defaultStuckValue: 2});
 */
"use strict";
module.exports = function (globalOpts = {}) {
  const gOpts = _.defaults(globalOpts, {
    exportTraveler: true,
    installTraveler: false,
    installPrototype: true,
    hostileLocation: "empire",
    maxOps: 20000,
    defaultStuckValue: 3,
    reportThreshold: 50,
    incompleteReportCooldown: 50,
    noPathRetryTicks: 5,
  });
  class Traveler {
    constructor() {
      this.memory = _.defaultsDeep(_.get(Memory, gOpts.hostileLocation, {}), {
        hostileRooms: {},
      });
    }
    findAllowedRooms(origin, destination, options = {}) {
      _.defaults(options, { restrictDistance: 16 });
      if (
        Game.map.getRoomLinearDistance(origin, destination) >
        options.restrictDistance
      ) {
        return;
      }
      let allowedRooms = { [origin]: true, [destination]: true };
      let ret = Game.map.findRoute(origin, destination, {
        routeCallback: roomName => {
          if (options.routeCallback) {
            let outcome = options.routeCallback(roomName);
            if (outcome !== undefined) {
              return outcome;
            }
          }
          if (
            Game.map.getRoomLinearDistance(origin, roomName) >
            options.restrictDistance
          )
            return false;
          let parsed;
          if (options.preferHighway) {
            parsed = /^[WE]([0-9]+)[NS]([0-9]+)$/.exec(roomName);
            let isHighway =
              Number(parsed[1]) % 10 === 0 || Number(parsed[2]) % 10 === 0;
            if (isHighway) {
              return 1;
            }
          }
          if (!options.allowSK && !Game.rooms[roomName]) {
            if (!parsed) {
              parsed = /^[WE]([0-9]+)[NS]([0-9]+)$/.exec(roomName);
            }
            let isSK =
              (Number(parsed[1]) % 10 === 4 || Number(parsed[1]) % 10 === 6) &&
              (Number(parsed[2]) % 10 === 4 || Number(parsed[2]) % 10 === 6);
            if (isSK) {
              return 10;
            }
          }
          if (
            !options.allowHostile &&
            this.memory.hostileRooms[roomName] &&
            roomName !== destination &&
            roomName !== origin
          ) {
            return Number.POSITIVE_INFINITY;
          }
        },
      });
      if (!_.isArray(ret)) {
        console.log(`couldn't findRoute to ${destination}`);
        return;
      }
      for (let value of /** @type {any[]} */ (ret)) {
        allowedRooms[value.room] = true;
      }
      return allowedRooms;
    }
    findTravelPath(origin, destination, options = {}) {
      _.defaults(options, {
        ignoreCreeps: true,
        range: 1,
        obstacles: [],
        maxOps: gOpts.maxOps,
      });
      let origPos = origin.pos || origin,
        destPos = destination.pos || destination;
      let allowedRooms;
      if (
        options.useFindRoute ||
        (options.useFindRoute === undefined &&
          Game.map.getRoomLinearDistance(origPos.roomName, destPos.roomName) >
            2)
      ) {
        allowedRooms = this.findAllowedRooms(
          origPos.roomName,
          destPos.roomName,
          options,
        );
      }
      let callback = roomName => {
        if (options.roomCallback) {
          let outcome = options.roomCallback(roomName, options.ignoreCreeps);
          if (outcome !== undefined) {
            return outcome;
          }
        }
        if (allowedRooms) {
          if (!allowedRooms[roomName]) {
            return false;
          }
        } else if (
          this.memory.hostileRooms[roomName] &&
          !options.allowHostile
        ) {
          return false;
        }
        let room = Game.rooms[roomName];
        if (!room) return;
        let matrix;
        if (options.ignoreStructures) {
          matrix = new PathFinder.CostMatrix();
          if (!options.ignoreCreeps) {
            Traveler.addCreepsToMatrix(room, matrix);
          }
        } else if (options.ignoreCreeps || roomName !== origin.pos.roomName) {
          matrix = this.getStructureMatrix(room);
        } else {
          matrix = this.getCreepMatrix(room);
        }
        for (let obstacle of options.obstacles) {
          matrix.set(obstacle.pos.x, obstacle.pos.y, 0xff);
        }
        return matrix;
      };
      return PathFinder.search(
        origPos,
        { pos: destPos, range: options.range },
        {
          swampCost: options.ignoreRoads ? 5 : 10,
          plainCost: options.ignoreRoads ? 1 : 2,
          maxOps: options.maxOps,
          roomCallback: callback,
        },
      );
    }
    travelTo(creep, destination, options = {}) {
      let creepPos = creep.pos,
        destPos = destination.pos || destination;
      if (creep.room.controller) {
        if (creep.room.controller.owner && !creep.room.controller.my) {
          this.memory.hostileRooms[creep.room.name] =
            creep.room.controller.level;
        } else {
          this.memory.hostileRooms[creep.room.name] = undefined;
        }
      }
      if (!creep.memory._travel) {
        creep.memory._travel = { stuck: 0, tick: Game.time, cpu: 0, count: 0 };
      }
      let travelData = creep.memory._travel;
      if (creep.fatigue > 0) {
        travelData.tick = Game.time;
        return ERR_BUSY;
      }
      if (!destination) {
        return ERR_INVALID_ARGS;
      }
      let rangeToDestination = creep.pos.getRangeTo(destPos);
      if (rangeToDestination <= 1) {
        let outcome = OK;
        if (rangeToDestination === 1) {
          outcome = creep.move(creep.pos.getDirectionTo(destPos));
        }
        if (options.returnPosition && outcome === OK) {
          return destPos;
        } else {
          return outcome;
        }
      }
      let hasMoved = true;
      if (travelData.prev) {
        travelData.prev = new RoomPosition(
          travelData.prev.x,
          travelData.prev.y,
          travelData.prev.roomName,
        );
        if (creepPos.inRangeTo(travelData.prev, 0)) {
          hasMoved = false;
          travelData.stuck++;
        } else {
          travelData.stuck = 0;
        }
      }
      if (travelData.stuck >= gOpts.defaultStuckValue) {
        if (options.ignoreStuck) {
          if (
            options.returnPosition &&
            travelData.path &&
            travelData.path.length > 0
          ) {
            let direction = parseInt(travelData.path[0]);
            return Traveler.positionAtDirection(creepPos, direction);
          } else {
            return OK;
          }
        } else {
          options.ignoreCreeps = false;
          delete travelData.path;
        }
      }
      if (Game.time - travelData.tick > 1 && hasMoved) {
        delete travelData.path;
      }
      travelData.tick = Game.time;
      if (
        !travelData.dest ||
        travelData.dest.x !== destPos.x ||
        travelData.dest.y !== destPos.y ||
        travelData.dest.roomName !== destPos.roomName
      ) {
        delete travelData.path;
        // Новая цель — старые «нет пути» и «уже жаловались» больше не относятся к делу.
        delete travelData.noPathTick;
        delete travelData.incompleteDest;
      }
      if (!travelData.path) {
        if (creep.spawning) return ERR_BUSY;
        // Предыдущий поиск не дал ни одной клетки пути — не жжём CPU на повтор
        // каждый тик. Пауза короткая: цель может освободиться (крип ушёл,
        // структура достроена), но за 5 тиков ситуация успевает измениться.
        if (
          travelData.noPathTick &&
          Game.time - travelData.noPathTick < gOpts.noPathRetryTicks
        ) {
          return ERR_NO_PATH;
        }
        travelData.dest = destPos;
        travelData.prev = undefined;
        let cpu = Game.cpu.getUsed();
        let ret = this.findTravelPath(creep, destPos, options);
        // cpu/count — это ОКНО между отчётами, а не накопление за всю жизнь.
        // Раньше travelData.cpu суммировался за всю жизнь крипа и не сбрасывался:
        // у долгоживущего крипа после порога 50 сообщение печаталось на КАЖДОМ
        // пересчёте пути (лог-спам, а сам console.log в Screeps тоже ест CPU),
        // при этом число в логе — не стоимость текущего тика, а суммарная.
        // Теперь окно обнуляется после отчёта, cpuTotal хранит значение за жизнь
        // только для диагностики.
        const pathCost = Game.cpu.getUsed() - cpu;
        travelData.cpu += pathCost;
        travelData.count++;
        travelData.cpuTotal = (travelData.cpuTotal || 0) + pathCost;
        if (travelData.cpu > gOpts.reportThreshold) {
          console.log(
            `TRAVELER: heavy pathing: ${creep.name}, cpu: ${_.round(
              travelData.cpu,
              2,
            )} за ${travelData.count} перепчётов (avg ${_.round(
              travelData.cpu / travelData.count,
              3,
            )}), всего за жизнь: ${_.round(
              travelData.cpuTotal,
              2,
            )}, pos: ${creep.pos}`,
          );
          travelData.cpu = 0;
          travelData.count = 0;
        }
        if (ret.incomplete) {
          ret = this.handleIncomplete(creep, travelData, destPos, ret, options);
        }
        travelData.path = Traveler.serializePath(creep.pos, ret.path);
        travelData.stuck = 0;
        // Пути нет совсем — запомним тик, чтобы не пересчитывать его каждый тик.
        if (travelData.path.length === 0) {
          travelData.noPathTick = Game.time;
        } else {
          delete travelData.noPathTick;
        }
      }
      if (!travelData.path || travelData.path.length === 0) {
        return ERR_NO_PATH;
      }
      if (travelData.prev && travelData.stuck === 0) {
        travelData.path = travelData.path.substr(1);
      }
      // Одноклеточный путь: если путь состоял ровно из одного шага, то после
      // вычитания уже сделанного шага строка пуста. Раньше это давало
      // parseInt("") === NaN и creep.move(NaN) — невалидный интент и
      // «залипание» крипа. Сбрасываем исчерпанный путь: следующий тик либо
      // пересчитает его, либо travelTo вернётся по раннему условию «уже у цели».
      if (travelData.path.length === 0) {
        delete travelData.path;
        return ERR_NO_PATH;
      }
      travelData.prev = creep.pos;
      let nextDirection = parseInt(travelData.path[0]);
      let outcome = creep.move(nextDirection);
      if (!options.returnPosition || outcome !== OK) {
        return outcome;
      } else {
        return Traveler.positionAtDirection(creep.pos, nextDirection);
      }
    }

    /**
     * Разбирает неудачный поиск пути (`result.incomplete`) и пытается исправить его.
     *
     * Почему поиск вообще может не дойти до цели:
     * 1. `ignoreCreeps === false` — так ищется маршрут ПОСЛЕ застревания (крип стоит
     *    `defaultStuckValue` тиков). Все крипы, включая самого ходока, помечены как
     *    стена. В плотном узле базы (storage/terminal/лабы) подходных клеток к цели
     *    всего 2–5, и если их заняли другие крипы, PathFinder не находит НИ ОДНОЙ
     *    клетки в радиусе `range` → `incomplete`. Это не «нет маршрута», а пробка:
     *    по структурной матрице цель комнаты достижима (замер 18.09.2026: у всех
     *    структур E35S39 есть достижимая подходная клетка). Поэтому повторяем поиск
     *    без крипов и берём более длинный, но валидный маршрут вместо пустого.
     * 2. Обычный случай (структурная матрица) — `useFindRoute` мог переусердствовать
     *    с ограничением комнат: пробуем ещё раз без него (как было в оригинале).
     *
     * Лог печатается один раз на (крип, цель) и не чаще `incompleteReportCooldown`
     * тиков: иначе в пробке сообщение выводится на каждый пересчёт пути и забивает
     * консоль (и само по себе ест CPU).
     *
     * @param {Creep} creep
     * @param {Object} travelData элемент `creep.memory._travel`
     * @param {RoomPosition} destPos
     * @param {Object} ret результат `PathFinder.search`
     * @param {Object} options опции текущего вызова `travelTo`
     * @returns {Object} возможно исправленный результат поиска
     */
    handleIncomplete(creep, travelData, destPos, ret, options) {
      if (options.ignoreCreeps === false) {
        let relaxed = this.findTravelPath(
          creep,
          destPos,
          _.assign({}, options, { ignoreCreeps: true }),
        );
        if (!relaxed.incomplete || relaxed.path.length > ret.path.length) {
          ret = relaxed;
        }
      } else if (
        ret.ops < 2000 &&
        options.useFindRoute === undefined &&
        travelData.stuck < gOpts.defaultStuckValue
      ) {
        options.useFindRoute = false;
        ret = this.findTravelPath(creep, destPos, options);
      }

      let destKey = destPos.roomName + ":" + destPos.x + ":" + destPos.y;
      let cooldown = gOpts.incompleteReportCooldown;
      if (
        travelData.incompleteDest !== destKey ||
        Game.time - (travelData.incompleteTick || 0) >= cooldown
      ) {
        console.log(
          `TRAVELER: incomplete path for ${creep.name}, dest: ${destPos}, ` +
            `pos: ${creep.pos}, ops: ${ret.ops}, path: ${ret.path.length}, ` +
            `creepsAsWalls: ${options.ignoreCreeps === false ? "yes" : "no"}, ` +
            `stuck: ${travelData.stuck}`,
        );
        travelData.incompleteDest = destKey;
        travelData.incompleteTick = Game.time;
      }
      return ret;
    }

    refreshMatrices() {
      if (Game.time !== this.currentTick) {
        this.currentTick = Game.time;
        this.structureMatrixCache = {};
        this.creepMatrixCache = {};
      }
    }
    getStructureMatrix(room) {
      this.refreshMatrices();
      if (!this.structureMatrixCache[room.name]) {
        let matrix = new PathFinder.CostMatrix();
        this.structureMatrixCache[room.name] = Traveler.addStructuresToMatrix(
          room,
          matrix,
          1,
        );
      }
      return this.structureMatrixCache[room.name];
    }
    static addStructuresToMatrix(room, matrix, roadCost) {
      for (let structure of room.find(FIND_STRUCTURES)) {
        if (structure instanceof StructureRampart) {
          if (!structure.my) {
            matrix.set(structure.pos.x, structure.pos.y, 0xff);
          }
        } else if (structure instanceof StructureRoad) {
          matrix.set(structure.pos.x, structure.pos.y, roadCost);
        } else if (structure.structureType !== STRUCTURE_CONTAINER) {
          matrix.set(structure.pos.x, structure.pos.y, 0xff);
        }
      }
      for (let site of room.find(FIND_CONSTRUCTION_SITES)) {
        if (
          site.structureType === STRUCTURE_CONTAINER ||
          site.structureType === STRUCTURE_ROAD
        ) {
          continue;
        }
        matrix.set(site.pos.x, site.pos.y, 0xff);
      }
      return matrix;
    }
    getCreepMatrix(room) {
      this.refreshMatrices();
      if (!this.creepMatrixCache[room.name]) {
        this.creepMatrixCache[room.name] = Traveler.addCreepsToMatrix(
          room,
          this.getStructureMatrix(room).clone(),
        );
      }
      return this.creepMatrixCache[room.name];
    }
    static addCreepsToMatrix(room, matrix) {
      room
        .find(FIND_CREEPS)
        .forEach(creep => matrix.set(creep.pos.x, creep.pos.y, 0xff));
      return matrix;
    }
    /**
     * Направление шага, пересекающего границу комнат.
     *
     * `RoomPosition.getDirectionTo()` считает направление по «сырым» x/y и на
     * границе даёт мусор: переход на восток `(49,y,roomA) -> (0,y,roomB)`
     * выглядит как шаг ВЛЕВО на 49 клеток. Раньше `serializePath` такие шаги
     * просто выбрасывала, из-за чего весь последующий путь оказывался сдвинут
     * на одну клетку и крип упирался в границу, не переходя в соседнюю комнату.
     * Направление перехода восстанавливаем по кромке: `49 -> 0` — шаг на
     * восток/юг, `0 -> 49` — на запад/север (та же логика, что у `creep.move`).
     *
     * @param {RoomPosition} from
     * @param {RoomPosition} to
     * @returns {number} DirectionConstant (1..8) либо 0, если шаг не распознан
     */
    static directionAcrossRooms(from, to) {
      let dx = 0;
      let dy = 0;
      if (from.x === 49 && to.x === 0) dx = 1;
      else if (from.x === 0 && to.x === 49) dx = -1;
      if (from.y === 49 && to.y === 0) dy = 1;
      else if (from.y === 0 && to.y === 49) dy = -1;
      return Traveler.directionFromDelta(dx, dy);
    }
    /**
     * @param {number} dx
     * @param {number} dy
     * @returns {number} DirectionConstant (1..8) либо 0
     */
    static directionFromDelta(dx, dy) {
      const offsetX = [0, 0, 1, 1, 1, 0, -1, -1, -1];
      const offsetY = [0, -1, -1, 0, 1, 1, 1, 0, -1];
      for (let direction = 1; direction <= 8; direction++) {
        if (offsetX[direction] === dx && offsetY[direction] === dy) {
          return direction;
        }
      }
      return 0;
    }
    static serializePath(startPos, path) {
      let serializedPath = "";
      let lastPosition = startPos;
      for (let position of path) {
        if (position.roomName === lastPosition.roomName) {
          serializedPath += lastPosition.getDirectionTo(position);
        } else {
          // Шаг через границу комнат — не теряем его (см. directionAcrossRooms).
          // Если кромка не распознана (на практике не бывает), шаг пропускаем,
          // но НЕ пишем 0 — это невалидное направление для creep.move.
          const direction = Traveler.directionAcrossRooms(
            lastPosition,
            position,
          );
          if (direction !== 0) {
            serializedPath += direction;
          }
        }
        lastPosition = position;
      }
      return serializedPath;
    }
    static positionAtDirection(origin, direction) {
      let offsetX = [0, 0, 1, 1, 1, 0, -1, -1, -1];
      let offsetY = [0, -1, -1, 0, 1, 1, 1, 0, -1];
      return new RoomPosition(
        origin.x + offsetX[direction],
        origin.y + offsetY[direction],
        origin.roomName,
      );
    }
  }

  if (gOpts.installTraveler) {
    global.Traveler = Traveler;
    global.traveler = new Traveler();
    global.travelerTick = Game.time;
  }

  if (gOpts.installPrototype) {
    if (!gOpts.installTraveler) {
      global.traveler = new Traveler();
      global.travelerTick = Game.time;
    }

    Creep.prototype.travelTo = function (destination, options) {
      if (global.traveler && global.travelerTick !== Game.time) {
        global.traveler = new Traveler();
        // ВАЖНО: без этой строки travelerTick оставался равным тику загрузки
        // модуля (Global Reset), и условие выше было истинно ВСЕГДА. Тогда
        // каждый вызов travelTo создавал новый экземпляр Traveler с пустыми
        // кэшами матриц — то есть CostMatrix комнаты (room.find(FIND_STRUCTURES)
        // + обход дорог/стен, traveler.js:312-334) перестраивалась на КАЖДЫЙ
        // пересчёт пути вместо одного раза за тик.
        global.travelerTick = Game.time;
      }
      return global.traveler.travelTo(this, destination, options);
    };
  }

  if (gOpts.exportTraveler) {
    return Traveler;
  }
};
