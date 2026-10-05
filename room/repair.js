// ===================================================
// ROOM/REPAIR.JS — повреждения структур и дорог, выбор цели ремонта
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
const { collectDamagedStructures } = scanner;
const { TOWER, TASK_CONFIG, REPAIR } = require("../constants");

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
 * башнями раз в TOWER.REPAIR_INTERVAL тиков (runTowerLogic ниже).
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

        // ОДНА ЦЕЛЬ с воркером (constants/defense.js, REPAIR): дорога на
        // REPAIR.ROAD_DONE_HITS и выше считается отремонтированной —
        // ровно на этом числе воркер закрывает задачу
        // (task/exec.repair.js, isDoneRepair). Без этого гейта башня,
        // выбирающая цель по ДОЛЕ потерянных хитов, гнала болотную дорогу
        // (25 000 хитов) до максимума — 29 действий по 10 энергии на одну
        // дорогу, пока воркер уже считал её сделанной.
        if (hits >= REPAIR.ROAD_DONE_HITS) continue;

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


module.exports = {
  collectDamaged,
  isCachedRoadDamaged,
  collectDamagedRoads,
  resolveByIds,
  getWallsAndRamparts,
  getDamagedStructures,
  getRamparts,
  pickRepairTarget,
};
