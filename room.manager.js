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
const { isCombatHostile, getHostiles } = require("threat");
const mineralManager = require("mineral.manager");
const taskGenerators = require("task.generators");
const spawnManager = require("spawn.manager");
const factoryManager = require("factory.manager");
const powerSpawnManager = require("powerSpawn.manager");
const linkManager = require("linkManager");
const labManager = require("lab.manager");
const boostManager = require("boost.manager");
const roleTower = require("role.tower");

const roleHarvester = require("role.harvester");
const roleMiner = require("role.miner");
const roleLinkWorker = require("role.linkWorker");
const roleMineralMiner = require("role.mineralMiner");
const workerRunner = require("worker.runner");
const roleLabWorker = require("lab.worker");
const cpuMonitor = require("cpuMonitor");
const { TOWER, TASK_CONFIG } = require("./constants");

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

/**
 * Изоляция сбоев подсистем: ошибка внутри одной подсистемы комнаты
 * (спавн, лаборатории, генераторы задач, роли, башни, линки, фабрика,
 * PowerSpawn) логируется и НЕ мешает остальным. Комнату нельзя «уложить»
 * падением одной из них: раньше исключение прерывало runRoom, а с ним и
 * обработку остальных комнат в этом тике (инцидент 18.09.2026).
 * @param {string} label
 * @param {Function} fn
 */
function safe(label, fn) {
  try {
    fn();
  } catch (e) {
    console.log(`[RoomManager] ${label}: ${e && e.stack ? e.stack : e}`);
  }
}

function runCreepLogic(roomState) {
  for (const creep of roomState.creeps) {
    if (!creep) continue;
    const roleModule = ROLES[creep.memory.role];
    if (!roleModule) continue;

    // Задача 3 роадмапа (ТЗ №1): спавнящийся крип ещё не может действовать, но
    // его роль (worker) успела бы занять Task и держать резервацию «немой» до
    // конца спавна (десятки тиков для больших тел). Роль для него не выполняется.
    if (creep.spawning) continue;

    // БУСТИРОВАНИЕ ИДЁТ ПЕРВЫМ, РОЛЬ — ТОЛЬКО ЕСЛИ КРИП НЕ ЗАНЯТ БУСТОМ.
    //
    // Почему порядок принципиален. У крипа в Screeps ровно ОДНО действие за тик:
    // если роль уже сходила (travelTo/withdraw/transfer), то travelTo и boost из
    // boost.manager в ЭТОМ ЖЕ тике движок игнорирует. Прежний порядок (роль, потом
    // буст) означал, что крип с активной задачей — а Worker едет почти каждый тик —
    // физически не мог ни дойти до буст-лабы, ни бустироваться: живой shard3
    // показал двух Worker'ов с boostTask = XZHO2, которые метались вокруг лабы,
    // полной буста (XZHO2 240) и энергии (1000), и не получили ни одной
    // бустнутой части, а Memory.__boostMetric так и остался "no stock".
    //
    // Резервация Task при этом не теряется: worker.runner хранит выбранную задачу
    // в памяти крипа и перепроверяет её каждый тик, поэтому пропуск тика роли —
    // это пауза, а не отказ от задачи.
    //
    // ВАЖНО (ТЗ №0): бакет роли "worker" — это и есть выполнение Task System
    // (worker.runner: выбор задачи из FIFO Memory.rooms[].tasks + executor).
    // Отдельного бакета ему не нужно — имя бакета совпадает с ролью.
    let boosting = false;
    cpuMonitor.trackRole("boostManager", () => {
      try {
        boosting = boostManager.run(roomState, creep) === true;
      } catch (e) {
        console.log(
          `[RoomManager] Ошибка буста у крипа ${creep.name}: ${e.stack || e}`,
        );
      }
    });
    if (boosting) continue;

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
 * Разыменовывает список id из heap-кэша scanner в массив объектов.
 *
 * Прежний код делал это через `ids.map(id => Game.getObjectById(id)).filter(Boolean)`
 * — тот же результат, но с двумя массивами и двумя замыканиями на каждую группу
 * (в комнате RCL8 это расширения, дороги, линки, лаборатории). Здесь один массив
 * и один цикл.
 *
 * Почему НЕ собираем группы одним `room.find(FIND_STRUCTURES)`: это было
 * замерено и отклонено. В консоли shard3 `room.find(FIND_STRUCTURES)` по 334
 * структурам стоит 1.2 мкс, а разыменование 270 id — 11-35 мкс, поэтому замена
 * выглядела выгодной, но в живом тике она оказалась хуже: полный
 * `buildAllRoomStates()` с find-вариантом = 177 мкс (min из 20), а живой профиль
 * roomState после деплоя не улучшился (0.7265 -> 0.7549 CPU/тик), при том что
 * find трогает больше объектов, чем нужно roomState (все стены, валы и
 * контейнеры комнаты — двигатель материализует их объекты при первом обращении),
 * а прежний путь через id разыменовывает только нужные ~270.
 *
 * @param {string[]} ids
 * @returns {any[]}
 */
function resolveIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const obj = Game.getObjectById(ids[i]);
    if (obj) out.push(obj);
  }
  return out;
}

/**
 * Добавляет повреждённые структуры одной группы в общий список.
 * Прежний filter(s => s.hits < s.hitsMax) заменён обычным циклом: без
 * замыкания и без промежуточного массива allStructuresForRepair, который
 * собирался шестью concat'ами (каждый concat копировал весь накопленный массив).
 * @param {Array} group
 * @param {Array} out
 */
function collectDamaged(group, out) {
  for (let i = 0; i < group.length; i++) {
    const s = group[i];
    if (s.hits < s.hitsMax) out.push(s);
  }
}

/**
 * То же для одиночных структур (фабрика, PowerSpawn, storage, терминал,
 * обсервер, экстрактор, нюкер): отсутствующая структура — null.
 * @param {Object|null} s
 * @param {Array} out
 */
function collectDamagedSingle(s, out) {
  if (s && s.hits < s.hitsMax) out.push(s);
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

/**
 * Сколько башен комнаты реально могут ремонтировать в этом тике: у остальных
 * энергии не больше TOWER.REPAIR_ENERGY_MIN, и role.tower в ремонт не пойдёт
 * (в атаку/лечение — пойдёт). Нужно, чтобы не собирать цели для башен, которые
 * всё равно простаивают, и чтобы нулевой случай (все башни пусты или в комнате
 * бой) не гонял проход по сотням повреждённых структур.
 * @param {StructureTower[]} towers
 * @returns {number}
 */
function countRepairCapableTowers(towers) {
  let count = 0;
  for (let i = 0; i < towers.length; i++) {
    if (towers[i].store[RESOURCE_ENERGY] > TOWER.REPAIR_ENERGY_MIN) count++;
  }
  return count;
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
    // Скан идёт через threat.getHostiles: башни — производитель списка на тик,
    // defense.manager переиспользует его (см. threat.js). room.find выполняется
    // только в комнатах с башнями.
    const hostiles = getHostiles(roomState.room);
    const hasHostiles = hostiles.length > 0;

    // «Угроза» в комнате определяется тем же предикатом, что и тревога
    // defense.manager (боевые тела), — определения больше не расходятся.
    let hasCombatHostiles = false;
    for (let i = 0; i < hostiles.length; i++) {
      if (isCombatHostile(hostiles[i])) {
        hasCombatHostiles = true;
        break;
      }
    }

    const roomData = {
      hostiles,
      // Лекарей ищем один раз на комнату (а не в каждой башне).
      healers: hasHostiles ? findHealers(hostiles) : null,
      // Раненый союзник нужен каждый тик: лечение не должно ждать
      // WALL_SCAN_INTERVAL и не должно блокироваться ремонтом (см. role.tower).
      woundedCreep: findWoundedCreep(roomState, roomName),
    };

    // Тяжёлая часть (стены/валы) выполняется только раз в
    // TOWER.WALL_SCAN_INTERVAL тиков — разыменование стен и валов по id и
    // проход по ним. Цели ремонта СТРУКТУР/ДОРОГ считаются КАЖДЫЙ тик
    // (см. блок ниже): скана раз в 15 тиков для них недостаточно.
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
    }

    // ── ЦЕЛИ РЕМОНТА СТРУКТУР И ДОРОГ — КАЖДЫЙ ТИК ──────────────────────
    // Поиск самых повреждённых зданий одним проходом, без sort.
    // Критерий — ДОЛЯ остатка хитов (hits/hitsMax), а не абсолютные хиты:
    // дороги отданы башням (воркеры их больше не ремонтируют, C2), а у дороги
    // hitsMax 5000 — по абсолютным хитам она проигрывала любой раненой лабе
    // (1500) или линку (1000) и до башен не доходила вовсе. По доле дорога в
    // 51 % обгоняет лабу в 80 % именно тогда, когда она действительно хуже.
    //
    // ПОЧЕМУ ЦЕЛИ ПЕРЕСОБИРАЮТСЯ КАЖДЫЙ ТИК (правка по разрушению дорог
    // E35S37, 4 башни). Было две ошибки, и обе били по пропускной способности:
    //   1) ОДНА цель на всю комнату — все башни били в один тайл (800 хитов
    //      каждая в цель с hitsMax 5000), излишек сгорал, так как действие
    //      башни стоит TOWER_ENERGY_COST независимо от числа восстановленных
    //      хитов;
    //   2) цели выбирались раз в 15 тиков (в тик скана стен), а ремонт шёл
    //      только в тот же тик. Но у большинства повреждённых структур дефицит
    //      МЕНЬШЕ мощности башни (800 хитов), поэтому цель добивалась за один
    //      интент и башня простаивала остальные 14 тиков: комната восстанавливала
    //      4 тайла за 15 тиков вместо 4 тайлов КАЖДЫЙ тик.
    // Теперь тот же ОДИН проход выполняется каждый тик и собирает до
    // TOWER.REPAIR_ACTIONS_PER_TICK самых повреждённых структур, а комната
    // раздаёт их башням по одной (см. цикл ниже): одна башня — один тайл —
    // 800 хитов за тик, цели не дублируются. Проход по damagedStructures — та
    // же работа, что и раньше, только чаще (замер в node: 6.3 мкс на 670
    // структур, то есть ~0.03 мс/тик на 5 комнат), плюс бюджет действий
    // ограничивает трату энергии башен и вместе с ней логистические задачи
    // fillTowers (см. TOWER.REPAIR_ACTIONS_PER_TICK).
    const damagedStructures = roomState.damagedStructures;
    const capable = countRepairCapableTowers(towers);
    const maxTargets =
      capable < TOWER.REPAIR_ACTIONS_PER_TICK
        ? capable
        : TOWER.REPAIR_ACTIONS_PER_TICK;
    const picked = [];
    const pickedRatios = [];

    if (maxTargets > 0) {
      for (let i = 0; i < damagedStructures.length; i++) {
        const s = damagedStructures[i];
        const ratio = s.hits / s.hitsMax;

        if (picked.length === maxTargets) {
          // Список полон: подавляющее большинство структур отсекается здесь,
          // без вставки (сравнение с худшей из выбранных).
          if (ratio >= pickedRatios[maxTargets - 1]) continue;
          picked.pop();
          pickedRatios.pop();
        }

        // Вставка по возрастанию доли; элементов не больше бюджета (2).
        let pos = picked.length;
        while (pos > 0 && pickedRatios[pos - 1] > ratio) pos--;
        picked.splice(pos, 0, s);
        pickedRatios.splice(pos, 0, ratio);
      }
    }

    // РАЗДАЧА ЦЕЛЕЙ: цель получает башня, которая её ДОСТАЁТ и ещё не занята.
    // Без этой проверки слот тратится впустую: башня шлёт интент по тайлу вне
    // TOWER_FALLOFF_RANGE (ERR_NOT_IN_RANGE, энергия не тратится, хиты не
    // растут), а цель остаётся в списке и выбирается снова и снова — при
    // бюджете в 2 действия это остановило бы весь ремонт комнаты.
    const assigned = [];
    const busy = [];
    for (let i = 0; i < towers.length; i++) {
      assigned.push(null);
      busy.push(false);
    }

    for (let t = 0; t < picked.length; t++) {
      const target = picked[t];
      for (let i = 0; i < towers.length; i++) {
        if (busy[i]) continue;
        if (towers[i].store[RESOURCE_ENERGY] <= TOWER.REPAIR_ENERGY_MIN) continue;
        const towerPos = towers[i].pos;
        const targetPos = target.pos;
        if (
          Math.max(
            Math.abs(towerPos.x - targetPos.x),
            Math.abs(towerPos.y - targetPos.y),
          ) <= TOWER_FALLOFF_RANGE
        ) {
          busy[i] = true;
          assigned[i] = target;
          break;
        }
      }
    }

    roomData.repairTargets = assigned;
    roomData.damagedTarget = picked.length > 0 ? picked[0] : null;

    // Пишем только при изменении: одно и то же значение каждый тик — лишний
    // нагрев Memory (её сериализация + парсинг в начале следующего тика).
    // Флаг согласован с определением тревоги defense.manager: «угроза» — это
    // боевой враг (ATTACK/RANGED_ATTACK/HEAL) или просадка хитов стен.
    const underAttack = hasCombatHostiles || hitsDropped;
    if (roomMemory.underAttack !== underAttack) {
      roomMemory.underAttack = underAttack;
    }
    // Флаг нужен roleTower: ремонт (особенно дорог — их теперь ремонтируют
    // каждый тик) не должен высасывать энергию башен в бою, где она нужна на
    // атаку и лечение. Атака/лечение в role.tower этот гейт игнорируют.
    roomData.underAttack = underAttack;

    // Каждой башне — СВОЯ цель этого тика (см. блок выше: раньше все башни били
    // в одну структуру, и действие тратилось на уже добитый тайл). Целей ровно
    // столько, сколько башен с достаточной энергией, поэтому они не дублируются.
    const towerTargets = roomData.repairTargets;
    for (let i = 0; i < towers.length; i++) {
      roleTower.run(towers[i], roomData, towerTargets[i]);
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
   * for..in вместо Object.values(Game.rooms).filter(): не создаётся
   * промежуточный массив со всеми комнатами; порядок обхода тот же.
   * @returns {Room[]}
   */
  getOwnedRooms: function () {
    const rooms = [];
    for (const name in Game.rooms) {
      const room = Game.rooms[name];
      if (room.controller && room.controller.my) rooms.push(room);
    }
    return rooms;
  },

  /**
   * Строит объект состояния для одной комнаты.
   * @param {Room} room
   * @param {Creep[]} [precomputedCreeps]
   * @returns {Object} roomState
   */
  buildRoomState: function (room, precomputedCreeps) {
    // Группы структур — по id из heap-кэша scanner, одним циклом на группу
    // (см. resolveIds: почему не room.find и почему без map/filter).
    const cache = scanner.getStructureCache(room);

    const spawns = resolveIds(cache.spawnIds);
    const towers = resolveIds(cache.towerIds);
    const links = resolveIds(cache.linkIds);
    const labs = resolveIds(cache.labIds);
    const extensions = resolveIds(cache.extensionIds);
    const roads = resolveIds(cache.roadIds);

    // Одиночные структуры разыменовываются напрямую: раньше каждая собиралась
    // как [Game.getObjectById(id)].filter(Boolean) — лишний массив и замыкание
    // на каждую структуру каждый тик.
    const factory = cache.factoryId
      ? Game.getObjectById(cache.factoryId)
      : null;
    const powerSpawn = cache.powerSpawnId
      ? Game.getObjectById(cache.powerSpawnId)
      : null;
    const observer = cache.observerId
      ? Game.getObjectById(cache.observerId)
      : null;
    const extractor = cache.extractorId
      ? Game.getObjectById(cache.extractorId)
      : null;
    const nuker = cache.nukerId ? Game.getObjectById(cache.nukerId) : null;

    // storage/terminal — ровно один раз на комнату за тик. Раньше они
    // разыменовывались дважды: в списке структур на ремонт и в самом roomState.
    const storage = cache.storageId
      ? Game.getObjectById(cache.storageId)
      : null;
    const terminal = cache.terminalId
      ? Game.getObjectById(cache.terminalId)
      : null;

    // Порядок ровно как в прежней сборке allStructuresForRepair + filter:
    // спавны, башни, расширения, линки, лаборатории, дороги, затем одиночные
    // (фабрика, PowerSpawn, storage, терминал, обсервер, экстрактор, нюкер).
    // Порядок значим: task.generators.generateRepairStructures создаёт задачи
    // на ремонт в этом порядке, а воркеры разбирают очередь FIFO.
    const damagedStructures = [];
    collectDamaged(spawns, damagedStructures);
    collectDamaged(towers, damagedStructures);
    collectDamaged(extensions, damagedStructures);
    collectDamaged(links, damagedStructures);
    collectDamaged(labs, damagedStructures);
    collectDamaged(roads, damagedStructures);
    collectDamagedSingle(factory, damagedStructures);
    collectDamagedSingle(powerSpawn, damagedStructures);
    collectDamagedSingle(storage, damagedStructures);
    collectDamagedSingle(terminal, damagedStructures);
    collectDamagedSingle(observer, damagedStructures);
    collectDamagedSingle(extractor, damagedStructures);
    collectDamagedSingle(nuker, damagedStructures);

    // Источники энергии — статичны, резолвятся из кэша (без map/filter).
    const sources = resolveIds(cache.sourceIds);

    // Крипы, приписанные к данной комнате — если список уже собран заранее
    // (buildAllRoomStates группирует всех крипов за один проход, а не за N),
    // используем его; иначе (прямой вызов buildRoomState) считаем сами.
    // for..in вместо Object.values(Game.creeps): без промежуточного массива
    // со всеми крипами империи.
    let creeps = precomputedCreeps;
    if (!creeps) {
      creeps = [];
      for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.memory.homeRoom === room.name || c.room.name === room.name) {
          creeps.push(c);
        }
      }
    }

    return {
      room,
      roomName: room.name,
      // roomState.role (специализация комнаты) убран: поле никто не читал,
      // а getRoomRole() тратил время на каждой комнате каждый тик. Реестр
      // roomRoles.js оставлен как есть — он не подключён ни к одному
      // потребителю (см. отчёт/аудит, п. 37).
      spawn: spawns[0] || null,
      spawns,
      controller: room.controller,
      storage,
      terminal,
      towers,
      extensions,
      roads,
      damagedStructures,
      creeps,
      sources,
      links,
      labs,
      factory,
      powerSpawn,
      observer,
      extractor,
      nuker,
      mineral: mineralManager.buildMineralState(room),
    };
  },

  /**
   * Возвращает массив roomState для всех собственных комнат.
   * @returns {Object[]} массив roomState
   */
  buildAllRoomStates: function () {
    const rooms = this.getOwnedRooms();

    // Set имён своих комнат — без промежуточного rooms.map(r => r.name).
    const roomNames = new Set();
    for (let i = 0; i < rooms.length; i++) roomNames.add(rooms[i].name);

    // Один проход по всем крипам империи вместо повторного
    // Object.values(Game.creeps).filter() внутри buildRoomState на каждую комнату.
    // Сохраняем оригинальное поведение: крип может попасть в список и своей
    // homeRoom, и текущей физической комнаты, если они различаются.
    const creepsByRoom = {};
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      const homeRoom = c.memory.homeRoom;
      const currentRoom = c.room.name;

      if (homeRoom && roomNames.has(homeRoom)) {
        (creepsByRoom[homeRoom] = creepsByRoom[homeRoom] || []).push(c);
      }
      if (currentRoom !== homeRoom && roomNames.has(currentRoom)) {
        (creepsByRoom[currentRoom] = creepsByRoom[currentRoom] || []).push(c);
      }
    }

    const roomStates = [];
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      roomStates.push(this.buildRoomState(room, creepsByRoom[room.name] || []));
    }
    return roomStates;
  },

  /**
   * Запускает все комнатные подсистемы для одной комнаты:
   * спавн, задачи воркеров, крипы, башни, линки, фабрика.
   * @param {Object} roomState
   */
  runRoom: function (roomState) {
    safe("spawnManager", () =>
      cpuMonitor.trackRole("spawnManager", () => spawnManager.run(roomState)),
    );
    safe("labManager", () =>
      cpuMonitor.trackRole("labManager", () => labManager.run(roomState.room)),
    );
    // Единая точка генерации задач с троттлингом по категориям
    // (TASK_GEN_INTERVAL в constants.js): генераторы идемпотентны, поэтому
    // дорогие сканы целей (ремонт, стройка) не обязаны идти каждый тик.
    safe("taskManager", () =>
      cpuMonitor.trackRole("taskManager", () =>
        taskGenerators.runAll(roomState),
      ),
    );
    safe("creeps", () => runCreepLogic(roomState));
    safe("towers", () => runTowerLogic(roomState));
    safe("links", () => runLinkLogic(roomState));
    // Задача 16 «Экономика»: структурные подсистемы включаются флагами
    // TASK_CONFIG; при false вызов менеджера не делается вовсе — раньше
    // структуры «дёргались» каждый тик вхолостую (produce/processPower без
    // сырья). Фабрика включена: снабжение fillFactoryEnergy оставляет в store
    // резерв под результат производства (FACTORY.PRODUCT_RESERVE), а менеджер
    // проверяет место по правилу движка — см. factory.manager.
    if (TASK_CONFIG.factory) {
      safe("factoryManager", () =>
        cpuMonitor.trackRole("factoryManager", () =>
          factoryManager.run(roomState),
        ),
      );
    }
    if (TASK_CONFIG.powerSpawn) {
      safe("powerSpawnManager", () =>
        cpuMonitor.trackRole("powerSpawnManager", () =>
          powerSpawnManager.run(roomState),
        ),
      );
    }
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
      // Изоляция по комнатам: исключение в одной комнате не должно лишать
      // обработки остальные (иначе одна «больная» подсистема кладёт империю).
      try {
        cpuMonitor.trackRole(`room:${roomState.roomName}`, () =>
          this.runRoom(roomState),
        );
      } catch (e) {
        console.log(
          `[RoomManager] room:${roomState.roomName}: ${e && e.stack ? e.stack : e}`,
        );
      }
    }

    return roomStates;
  },
};
