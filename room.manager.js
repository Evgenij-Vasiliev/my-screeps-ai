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
const { collectDamagedStructures } = scanner;
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
const labManager = require("lab.manager");
const labWorker = require("lab.worker");
const boostManager = require("boost.manager");
const cpuMonitor = require("cpuMonitor");
const { TOWER, TASK_CONFIG } = require("./constants");
const loadShed = require("loadShed");
const systems = require("systems");

const ROLES = {
  harvester: roleHarvester,
  upgrader: roleUpgrader,
  builder: roleBuilder,
  repairer: roleRepairer,
  miner: roleMiner,
  towerSupplier: roleTowerSupplier,
  linkWorker: roleLinkWorker,
  labWorker: labWorker,
  mineralMiner: roleMineralMiner,
  worker: workerRunner,
};

function runCreep(creep, roomState) {
  const role = creep.memory.role;

  // Тумблер роли (systems.js): miner: false — роль не исполняется; она же
  // не спавнится (spawn.manager.js). Живые крипы доживают свой срок сами.
  if (systems[role] === false) return;

  const roleModule = ROLES[role];
  if (!roleModule) return;

  // ── БУСТ ПОДАВЛЯЕТ РОЛЬ (boost.manager) ────────────────────────────────
  // Пока крип едет к буст-лабе, набирает буст-ресурс или стоит у лабы в
  // процессе creep.boost(), его роль НЕ выполняется: worker.runner иначе увёл
  // бы его в задачу посреди процедуры, а часть буста к этому моменту уже
  // списана (LAB_BOOST_MINERAL 30 и LAB_BOOST_ENERGY 20 на часть тела).
  // true — действие тика сделано бустом; false — крип не бустится (нет строки
  // политики для роли, запас ниже MIN_STOCK, рюкзак уже бустнут), управление
  // уходит роли как обычно.
  let boosting = false;
  if (systems.boostManager !== false) {
    cpuMonitor.trackRole("boostManager", () => {
      boosting = boostManager.run(roomState, creep) === true;
    });
  }
  if (boosting) return;

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
  // ВАЖНО: ключ замера — creep.memory.role, а имена ролей и подсистем лежат
  // в одном пространстве имён Memory.cpuStats.subsystems. Пока verbose включён,
  // CPU крипов роли складывается с замером одноимённой подсистемы, поэтому
  // держать флаг постоянно включённым нельзя — только на 1 тик из 100.
  for (const creep of roomState.creeps) {
    if (!creep) continue;
    cpuMonitor.trackRole(creep.memory.role, () =>
      runCreep(creep, roomState),
    );
  }
}

/** Добавляет в out повреждённые структуры из списка (hits < hitsMax). */
function collectDamaged(structures, out) {
  for (let i = 0; i < structures.length; i++) {
    const s = structures[i];
    if (s.hits < s.hitsMax) out.push(s);
  }
}

/**
 * Дорога из кэша сканера всё ещё повреждена.
 *
 * `damagedRoadHits`/`damagedRoadHitsMax` опциональны: их нет у старого кэша
 * в heap. Схему кэша из-за этого не поднимаем — кэш и так перестраивается по
 * возрасту за CACHE.REFRESH_INTERVAL тиков, а до перестройки работает
 * ветка с резолвом объектов. Проверка `typeof === "number"` отсекает слот,
 * которого нет: у ненайденного поля undefined, а не число, и `undefined < m`
 * в JS даёт false, но на это полагаться не будем.
 *
 * @param {Object} cache
 * @param {number} i индекс в damagedRoadIds
 * @returns {boolean}
 */
function isCachedRoadDamaged(cache, i) {
  const h = cache.damagedRoadHits[i];
  const m = cache.damagedRoadHitsMax[i];
  return typeof h === "number" && typeof m === "number" && h >= 0 && h < m;
}

/**
 * Повреждённые дороги — из предвычисленного списка сканера (правка шага 2).
 *
 * Было: Game.getObjectById на КАЖДУЮ дорогу комнаты каждый тик (100-300
 * вызовов x 0.000152 CPU = до 0.045 CPU/тик на комнату). Условным был только
 * push, а не сам резолв: комментарий выше обещал «почти всегда 0 вызовов»,
 * но резолв шёл по всему списку дорог.
 *
 * Теперь сканер отмечает повреждённые дороги в том же проходе по
 * FIND_STRUCTURES, где и так собирает roadIds (scanner.js, case
 * STRUCTURE_ROAD) — без единого лишнего вызова API, а здесь резолвятся
 * только они. Свежесть списка — CACHE.REFRESH_INTERVAL (20 тиков), как и у
 * остального кэша структур; починенные за это время дороги отсеиваются
 * проверкой hits < hitsMax при резолве.
 *
 * Фолбэк: если кэш пришёл без damagedRoadIds (чужая фикстура, старый кэш в
 * heap), работает прежний полный обход — поведение не меняется.
 *
 * Третий аргумент numbersOnly (правка 29.09.2026, вариант B плана) — для
 * потребителя, которому от структуры нужны только числа: генератор
 * repair-задач сравнивает hits с hitsMax * 0.5 (task.generators.js) и объект
 * ему не нужен вовсе. В этом режиме список берётся прямо из чисел кэша, без
 * единого Game.getObjectById: замер показал 0.15272 CPU/тик на резолв 752
 * дорог и ещё 0.08158 CPU/тик на перебор их генератором при нуле найденных
 * кандидатов (docs/CPU-BASELINE.md, раздел 12).
 *
 * Элементы в этом режиме — НЕ объекты Structure, а лёгкие дескрипторы
 * { id, hits, hitsMax }, где hits/hitsMax взяты из кэша сканера (возраст до
 * CACHE.REFRESH_INTERVAL тиков). Задаче нужен только id (task.executors сам
 * резолвит цель и сам проверяет hits перед действием), поэтому подмена
 * объекта дескриптором безопасна.
 *
 * @param {Object} cache кэш сканера комнаты
 * @param {Array} out массив, в который складываются результаты
 * @param {boolean} [numbersOnly] не резолвить объекты, отдать числа из кэша
 */
function collectDamagedRoads(cache, out, numbersOnly) {
  const damagedIds = cache.damagedRoadIds;

  if (!damagedIds) {
    const roadIds = cache.roadIds;
    if (!roadIds) return;

    for (let i = 0; i < roadIds.length; i++) {
      const road = Game.getObjectById(roadIds[i]);
      if (road && road.my !== false && road.hits < road.hitsMax) out.push(road);
    }
    return;
  }

  for (let i = 0; i < damagedIds.length; i++) {
    if (numbersOnly) {
      // Без резолва: берём числа, снятые сканером в том же проходе.
      if (!isCachedRoadDamaged(cache, i)) continue;
      out.push({
        id: damagedIds[i],
        hits: cache.damagedRoadHits[i],
        hitsMax: cache.damagedRoadHitsMax[i],
      });
      continue;
    }

    const road = Game.getObjectById(damagedIds[i]);
    // road.my !== false, а не road.my: дорога не имеет владельца, поэтому
    // движок отдаёт undefined — строгая проверка выбросила бы все дороги.
    if (road && road.my !== false && road.hits < road.hitsMax) out.push(road);
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

/**
 * Повреждённые структуры комнаты — ЛЕНИВО (вариант B плана, 29.09.2026).
 *
 * Раньше список собирался в buildRoomState КАЖДЫЙ тик на каждую комнату:
 * резолв повреждённых дорог 0.15272 + резолв групп 0.10744 = 0.26016 CPU/тик
 * на империю из 5 комнат (замер 29.09.2026, docs/CPU-BASELINE.md, раздел 12).
 * При этом потребитель, читающий список каждый тик, — генератор
 * repair-задач — берёт числа из кэша сканера (task.generators.js,
 * generateRepairStructures) и эту функцию не трогает вовсе: она вызывается
 * башнями раз в TOWER.REPAIR_INTERVAL тиков (runTowerLogic ниже) и
 * потенциально ролью repairer.
 *
 * Второй замер (раздел 13) показал, что дорогая часть — не дороги, а ГРУППЫ
 * структур: 0.12080 CPU/тик на резолв 366 объектов при нуле повреждённых
 * среди них. Поэтому группы тоже берутся из чисел сканера
 * (scanner.js, collectDamagedStructures) и резолвятся только те, что реально
 * повреждены — обычно ни одной.
 *
 * Мемоизация — на объекте roomState, а он живёт один тик, поэтому отдельной
 * инвалидации не требуется (как у getWallsAndRamparts выше).
 *
 * Терпимость к неполному состоянию: `_structureCache` есть только у
 * roomState, собранного buildRoomState. Прямые вызовы из тестов
 * (tests/task.index.test.js передаёт { roomName, damagedStructures })
 * не должны падать, поэтому отсутствующие части пропускаются.
 *
 * @param {Object} roomState
 * @returns {Array<Structure>}
 */
function getDamagedStructures(roomState) {
  if (!roomState._damagedStructures) {
    const damaged = [];
    const cache = roomState._structureCache;

    if (cache) {
      // Группы структур: сначала числа, объект — только для повреждённых.
      // Резолв идёт ДО дорог, чтобы ниже отфильтровать по structureType:
      // у дорог его нет, у структур он есть.
      collectDamagedStructures(cache, damaged);
      for (let i = 0; i < damaged.length; i++) {
        const live = Game.getObjectById(damaged[i].id);
        if (live) damaged[i] = live;
      }
      for (let i = damaged.length - 1; i >= 0; i--) {
        if (!damaged[i]) damaged.splice(i, 1);
      }

      // Дороги: один резолв на повреждённую дорогу (их сотни, но нужен
      // живой объект — башня ремонтирует именно его).
      collectDamagedRoads(cache, damaged);
    }

    if (roomState.storage) collectDamaged([roomState.storage], damaged);
    if (roomState.terminal) collectDamaged([roomState.terminal], damaged);

    roomState._damagedStructures = damaged;
  }
  return roomState._damagedStructures;
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

/**
 * Тик ремонта башен — СВОЙ у каждой комнаты.
 *
 * Раньше условие было общим для всей империи (`Game.time % TOWER.REPAIR_INTERVAL
 * === 0`), поэтому все 16 башен всех 5 комнат били ремонтом в ОДИН тик:
 * замер 29.09.2026 (scripts/cpu.peaks.measure.js, флаг Memory.cpuGenProfile,
 * 92 окна) — 4.5031 CPU в этом тике против 0.0464 CPU/тик в среднем, то есть
 * 16 интентов × 0.2 CPU + резолв стен и повреждённых в одном тике.
 *
 * Фаза берётся хэшем имени комнаты — тем же детерминированным сдвигом, который
 * уже разносит перестройку кэша сканера (scanner.js rebuildStagger). Среднее и
 * поведение при этом НЕ меняются: каждая башня по-прежнему ремонтирует 1 раз
 * в TOWER.REPAIR_INTERVAL тиков, меняется только тик, в который это происходит.
 *
 * @param {string} roomName
 * @returns {boolean}
 */
function isTowerRepairTick(roomName) {
  const phase = scanner.rebuildStagger(roomName) % TOWER.REPAIR_INTERVAL;
  return (Game.time + phase) % TOWER.REPAIR_INTERVAL === 0;
}

/**
 * Валы комнаты — ЛЕНИВО и с мемоизацией на roomState (как getWallsAndRamparts).
 *
 * Стены в цели ремонта больше не входят (они не распадаются), поэтому
 * резолвятся только валы: 26 объектов вместо 188 в самой большой комнате.
 * roomState живёт один тик, поэтому отдельной инвалидации не требуется.
 *
 * @param {Object} roomState
 * @returns {Array<Structure>}
 */
function getRamparts(roomState) {
  if (!roomState._ramparts) {
    roomState._ramparts = resolveByIds(roomState.rampartIds);
  }
  return roomState._ramparts;
}

/**
 * Цель ремонта башен — одна на комнату, с НАИБОЛЬШЕЙ долей потерянных хитов.
 *
 * Правка 29.09.2026 (решение человека, пункты 1-3). Что изменилось:
 *
 * 1. СТЕНЫ ИСКЛЮЧЕНЫ. Constructed wall в Screeps не распадается вовсе: движок
 *    (src/processor/intents/constructedWalls/tick.js) не трогает hits — он
 *    только выставляет hitsMax по уровню контроллера и удаляет стену по
 *    таймеру decayTime, который ставится стенам в ЧУЖОЙ комнате. Ремонт стен
 *    был фиктивной статьёй расхода, а порог Memory.rooms[r].wallThreshold
 *    бессмысленно рос на 1000 каждый тик ремонта (стены выше порога всегда).
 *
 * 2. Порог сравнивается не по абсолютным хитам, а по ДОЛЕ потерянных:
 *    hitsMax у вала на RCL8 — 300 000 000 (RAMPART_HITS_MAX), у дороги — 5000.
 *    Абсолютный дефицит всегда «выигрывал» бы вал, и дороги не ремонтировались
 *    бы никогда. Доля же у почти целого вала — 0.03 %, у дороги 3000/5000 — 40 %.
 *
 * 3. Цель берётся только если дефицит хитов не меньше одного действия башни
 *    (TOWER.REPAIR_POWER = 800, @screeps/common lib/constants.js:251): иначе
 *    движок обрежет хиты по hitsMax и 10 энергии уйдут в 1 хит.
 *
 * Числа дорог и владельческих структур берутся из кэша сканера (без резолва
 * объектов), объект резолвится ОДИН раз — для победителя. Валы и storage с
 * terminal смотрим объектами: их десятки, а не сотни.
 *
 * @param {Object} roomState
 * @returns {Structure|null}
 */
function pickRepairTarget(roomState) {
  const cache = roomState._structureCache;

  let bestId = null;
  let bestObj = null;
  let bestLoss = 0;

  if (cache) {
    // Дороги: hits/hitsMax сняты сканером в его проходе (scanner.js).
    const roadIds = cache.damagedRoadIds;
    if (roadIds) {
      for (let i = 0; i < roadIds.length; i++) {
        if (!isCachedRoadDamaged(cache, i)) continue;
        const hits = cache.damagedRoadHits[i];
        const max = cache.damagedRoadHitsMax[i];
        if (max - hits < TOWER.REPAIR_POWER) continue;
        const loss = (max - hits) / max;
        if (loss > bestLoss) {
          bestLoss = loss;
          bestId = roadIds[i];
          bestObj = null;
        }
      }
    }

    // Владельческие структуры: плоский Int32Array по stride 3 — [тип, hits, hitsMax].
    const stats = cache.damagedStats;
    const ids = cache.damagedIds;
    if (stats && ids) {
      for (let i = 0; i < cache.damagedCount; i++) {
        const n = i * 3;
        const hits = stats[n + 1];
        const max = stats[n + 2];
        if (max - hits < TOWER.REPAIR_POWER) continue;
        const loss = (max - hits) / max;
        if (loss > bestLoss) {
          bestLoss = loss;
          bestId = ids[i];
          bestObj = null;
        }
      }
    }
  }

  // Валы: распадаются (300 хитов за 100 тиков, ramparts/tick.js), поэтому
  // участвуют наравне со всеми. Объектов десятки — резолв дешёвый и
  // мемоизируется на roomState (getRamparts), как и у стен раньше.
  const ramparts = getRamparts(roomState);
  for (let i = 0; i < ramparts.length; i++) {
    const s = ramparts[i];
    const deficit = s.hitsMax - s.hits;
    if (deficit < TOWER.REPAIR_POWER) continue;
    const loss = deficit / s.hitsMax;
    if (loss > bestLoss) {
      bestLoss = loss;
      bestId = s.id;
      bestObj = s;
    }
  }

  // storage и terminal в числах сканера не перечислены — смотрим объектами.
  const extra = [roomState.storage, roomState.terminal];
  for (let i = 0; i < extra.length; i++) {
    const s = extra[i];
    if (!s) continue;
    const deficit = s.hitsMax - s.hits;
    if (deficit < TOWER.REPAIR_POWER) continue;
    const loss = deficit / s.hitsMax;
    if (loss > bestLoss) {
      bestLoss = loss;
      bestId = s.id;
      bestObj = s;
    }
  }

  // Объект резолвится только для победителя, пришедшего из чисел кэша:
  // валы, storage и terminal уже под рукой.
  const target = bestObj || (bestId ? Game.getObjectById(bestId) : null);
  // Между сканом кэша и этим тиком цель могли починить или снести.
  if (!target || target.hits >= target.hitsMax) return null;
  return target;
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

    // Тик ремонта у каждой комнаты свой — роль читает готовый флаг, а не
    // Game.time, иначе фаза комнаты в роли не учитывалась бы.
    const repairTick = isTowerRepairTick(roomName);
    roomData.canRepair = repairTick;

    if (repairTick) {
      // Только крипы, физически находящиеся в комнате: heal() по крипу
      // из другой комнаты — бесполезный интент.
      roomData.woundedCreep = roomState.creepsInRoom.find(
        c => c.hits < c.hitsMax,
      );

      // ОДНА цель на комнату и ОДНА башня под неё — ближайшая к цели.
      // Почему одна башня: интент стоит 0.2 CPU, а 16 башен по одной цели
      // давали пик 4.5031 CPU раз в 15 тиков (замер 29.09.2026) — при том,
      // что распад всей империи (валы 78 + дороги 75 хитов/тик) с запасом
      // покрывается одним действием на комнату за тик ремонта.
      // Ближайшая башня даёт максимум хитов: у repair падение по дальности
      // (TOWER_OPTIMAL_RANGE 5, TOWER_FALLOFF_RANGE 20 — @screeps/common).
      const target = pickRepairTarget(roomState);

      if (target) {
        let bestTower = null;
        let bestRange = Infinity;

        for (let i = 0; i < roomState.towers.length; i++) {
          const tower = roomState.towers[i];
          const range = tower.pos.getRangeTo(target);
          if (range < bestRange) {
            bestRange = range;
            bestTower = tower;
          }
        }

        roomData.repairTarget = target;
        roomData.repairTowerId = bestTower ? bestTower.id : null;
      }
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
  // Экспортируется для тестов и для роли (roomData.canRepair): тик ремонта
  // башен у каждой комнаты свой, см. комментарий к функции.
  isTowerRepairTick,

  // Экспортируется для генератора repair-задач (task.generators.js) и роли
  // repairer: список повреждённых структур комнаты собирается лениво.
  getDamagedStructures,

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
    // getDamagedStructures (см. её комментарий). После правки 29.09.2026 его
    // читает только роль repairer (roomState.damagedStructures), а она не
    // спавнится (SPAWN_QUOTA.repairer = 0): башни берут цель из чисел кэша
    // сканера (pickRepairTarget), а генератор repair-задач — тоже числами.

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

  /**
   * Запускает все комнатные подсистемы для одной комнаты:
   * спавн, задачи воркеров, крипы, башни, линки, фабрика.
   * @param {Object} roomState
   */
  runRoom: function (roomState) {
    // Уровень нагрузки читается ОДИН раз на комнату, а не в каждом условии:
    // уровни только повышаются, поэтому кэш внутри тика безопасен (сам
    // loadShed уровень не кэширует — переключение из консоли действует
    // со следующего обращения).
    const shed = loadShed.effectiveLevel();
    const shedLite = shed >= 1;
    const shedHard = shed >= 2;

    // Тумблеры систем — в systems.js. Выключатель и loadShed складываются
    // по ИЛИ: выключенную систему loadShed не включает.

    // ── ЛАБОРАТОРИИ ИДУТ ПЕРВЫМИ В ТИКЕ ──────────────────────────────────
    // labManager делает три вещи, от которых зависят ОСТАЛЬНЫЕ подсистемы
    // этого же тика: чинит привязку троек по LAB_BINDING (ensureTriples),
    // восстанавливает Memory.rooms[room].boostLab (ensureBoostLab) и дописывает
    // план реакций в конфиги троек (sync). Порядок важен: reagentList
    // терминальной сети строится из этих конфигов, поэтому сеть, рынок и
    // буст-менеджер обязаны увидеть их уже заполненными.
    // Гейта loadShed здесь нет намеренно: это производство, а не фоновая
    // уборка; в установившемся тике стоимость — проверки по tick-кэшу.
    // Выключатель `labManager: { scope: "room", on: false }` (systems.js)
    // гасит блок целиком: тройки не перепривязываются, boostLab не
    // восстанавливается, план реакций не дописывается — конфиги в Memory
    // остаются в последнем состоянии, и terminalNetwork продолжает работать
    // по ним (порядок шагов не меняется).
    if (systems.labManager !== false) {
      cpuMonitor.trackRole("labManager", () => labManager.run(roomState.room));
    }

    if (systems.spawnManager !== false) {
      cpuMonitor.trackRole("spawnManager", () => spawnManager.run(roomState));
    }
    cpuMonitor.trackRole("taskManager", () => {
      // ── Замер цены КАЖДОГО генератора задач ──────────────────────────
      // Включается флагом Memory.cpuGenProfile = true (снять —
      // `delete Memory.cpuGenProfile`). Пока флаг не задан, генераторы
      // вызываются напрямую, одним вызовом функции — накладных расходов нет.
      //
      // Почему по флагу, а не всегда: 6 генераторов × 5 комнат = 30 вызовов за
      // тик, а trackRole стоит 0.0007-0.0017 CPU за вызов
      // (docs/PROFILING-ON-DEMAND.md:83), то есть включённый замер добавляет
      // 0.02-0.05 CPU/тик. Тот же приём, что у поролевого профиля крипов:
      // подробный замер — по требованию, а не постоянно.
      //
      // Имена с префиксом "gen." не сталкиваются ни с именами ролей
      // (worker, miner, linkWorker), ни с именами подсистем: и то и другое
      // пишется в один объект Memory.cpuStats.subsystems (cpuMonitor.js:70-73).
      const genProfile = Memory.cpuGenProfile === true;
      const gen = genProfile
        ? (name, fn) => cpuMonitor.trackRole("gen." + name, () => fn(roomState))
        : (name, fn) => fn(roomState);

      // Выключенный в TASK_CONFIG генератор не вызывается ВООБЩЕ: раньше все
      // 11 вызывались всегда, и 5 из них (powerSpawn x2, factoryEnergy,
      // factoryBattery, terminalResources) делали только `if (!flag) return`
      // — это 5 лишних вызовов на комнату за тик, каждый со своим замыканием
      // и чтением roomState. Набор задач и их порядок в очереди при этом НЕ
      // меняются: выключенный генератор и раньше ничего не создавал.
      //
      // Тумблер генератора (systems.js): upgradeController: false перестаёт
      // ставить НОВЫЕ задачи этого типа, стоящие в очереди доигрываются.
      //
      // ── loadShed ─────────────────────────────────────────────────────
      // Понижение нагрузки НЕ удаляет уже стоящие задачи и не меняет их
      // порядок: оно лишь перестаёт СТАВИТЬ новые фоновые задачи. Поэтому
      // при lite/hard воркеры дорабатывают то, что уже в очереди (и FIFO
      // сохраняется), а срочное (спавны, башни, терминал на hard) ставится
      // всегда. При max срочное тоже продолжает ставиться — бот должен
      // выжить, а не остановиться.
      if (TASK_CONFIG.fillSpawnsExtensions && systems.fillSpawnsExtensions !== false) {
        gen("fillSpawnsExtensions", taskGenerators.generateFillSpawnsExtensions);
      }
      if (
        TASK_CONFIG.fillPowerSpawnPower &&
        !shedHard &&
        systems.fillPowerSpawnPower !== false
      ) {
        gen("fillPowerSpawnPower", taskGenerators.generateFillPowerSpawnPower);
      }
      if (
        TASK_CONFIG.fillPowerSpawnEnergy &&
        !shedHard &&
        systems.fillPowerSpawnEnergy !== false
      ) {
        gen("fillPowerSpawnEnergy", taskGenerators.generateFillPowerSpawnEnergy);
      }
      if (
        TASK_CONFIG.fillFactoryEnergy &&
        !shedHard &&
        systems.fillFactoryEnergy !== false
      ) {
        gen("fillFactoryEnergy", taskGenerators.generateFillFactoryEnergy);
      }
      if (
        TASK_CONFIG.collectFactoryBattery &&
        !shedHard &&
        systems.collectFactoryBattery !== false
      ) {
        gen(
          "collectFactoryBattery",
          taskGenerators.generateCollectFactoryBattery,
        );
      }
      if (
        TASK_CONFIG.fillTerminalEnergy &&
        !shedHard &&
        systems.fillTerminalEnergy !== false
      ) {
        gen("fillTerminalEnergy", taskGenerators.generateFillTerminalEnergy);
      }
      if (
        TASK_CONFIG.fillTerminalResources &&
        !shedHard &&
        systems.fillTerminalResources !== false
      ) {
        gen(
          "fillTerminalResources",
          taskGenerators.generateFillTerminalResources,
        );
      }
      if (TASK_CONFIG.fillTowers && systems.fillTowers !== false) {
        gen("fillTowers", taskGenerators.generateFillTowers);
      }
      // Фоновое: апгрейд, стройка, ремонт — только в обычном режиме.
      if (
        TASK_CONFIG.repairStructures &&
        !shedLite &&
        systems.repairStructures !== false
      ) {
        gen("repairStructures", taskGenerators.generateRepairStructures);
      }
      if (
        TASK_CONFIG.buildStructures &&
        !shedLite &&
        systems.buildStructures !== false
      ) {
        gen("buildStructures", taskGenerators.generateBuildStructures);
      }
      if (
        TASK_CONFIG.upgradeController &&
        !shedLite &&
        systems.upgradeController !== false
      ) {
        gen("upgradeController", taskGenerators.generateUpgradeController);
      }
    });
    // Рубильники систем комнаты. Выключенная система не вызывается вовсе —
    // это не «пустой вызов», а отсутствие вызова и его замыкания.
    if (systems.creeps !== false) runCreepLogic(roomState);
    if (systems.towers !== false) runTowerLogic(roomState);
    if (systems.linkManager !== false) runLinkLogic(roomState);
    // Шаг 8: проверка читается В ТОЧКЕ ВЫЗОВА, а не из `shed` выше (он прочитан
    // в начале комнаты, room.manager.js:610). Фабрика и powerSpawn идут ПОСЛЕ
    // ролевой логики и башен, поэтому пик внутри этой же комнаты иначе в гейт не
    // попадёт. Цена — один Game.cpu.getUsed() на комнату за тик
    // (0.000256–0.000310 CPU за вызов, docs/PROFILING-ON-DEMAND.md:82).
    if (!shedHard && !loadShed.overBudget()) {
      if (systems.factoryManager !== false) {
        cpuMonitor.trackRole("factoryManager", () =>
          factoryManager.run(roomState),
        );
      }
      if (systems.powerSpawnManager !== false) {
        cpuMonitor.trackRole("powerSpawnManager", () =>
          powerSpawnManager.run(roomState),
        );
      }
    }
  },

  /**
   * Главный метод уровня комнат: строит состояния и запускает
   * логику для каждой собственной комнаты.
   *
   * ── Тумблер комнаты (systems.js) ────────────────────────────────────
   * Комната с тумблером false (`E35S37: false`) теряет ВСЮ логику: спавн,
   * задачи, роли, башни, линки, лабы, фабрику. Её крипы перестают получать
   * команды, задачи в очереди замирают. Уборка памяти мёртвых крипов в
   * empire.js работает независимо и продолжает убирать.
   *
   * Сборка roomState для выключенной комнаты пока оплачивается (scanner +
   * резолвы): фильтр стоит здесь, а не в buildAllRoomStates, чтобы контракт
   * «состояние всех комнат» не зависел от тумблера.
   *
   * @returns {Object[]} массив roomState
   */
  run: function () {
    const roomStates = this.buildAllRoomStates();

    for (const roomState of roomStates) {
      if (systems[roomState.roomName] === false) continue;
      this.runRoom(roomState);
    }

    return roomStates;
  },
};
