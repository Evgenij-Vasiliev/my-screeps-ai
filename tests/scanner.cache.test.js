"use strict";
/**
 * ===================================================
 * SCANNER.CACHE.TEST.JS — офлайн-проверка инвалидации кэша структур
 * ===================================================
 * Задание 4 плана docs/CPU-OPTIMIZATION-PLAN.md. Проверяем баг и его фикс:
 *   1) первый вызов строит кэш;
 *   2) в пределах CACHE.REFRESH_INTERVAL пересканирования нет (кэш работает);
 *   3) после порога (со сдвигом по комнате) кэш перестраивается и НОВАЯ
 *      структура попадает в него
 *      (раньше не попадала никогда);
 *   4) смена уровня контроллера перестраивает кэш немедленно;
 *   5) кэш старой схемы/неполный перестраивается, а не роняет код;
 *   6) invalidateStructureCache() устаревает кэш принудительно;
 *   7) один проход room.find вместо четырёх;
 *   8) кэш живёт в heap, а Memory его НЕ содержит (задание 5), и прежняя
 *      копия в Memory вычищается при первой перестройке.
 *
 * Запуск: node tests/scanner.cache.test.js
 */

global.STRUCTURE_SPAWN = "spawn";
global.STRUCTURE_TOWER = "tower";
global.STRUCTURE_LINK = "link";
global.STRUCTURE_LAB = "lab";
global.STRUCTURE_EXTENSION = "extension";
global.STRUCTURE_ROAD = "road";
global.STRUCTURE_WALL = "wall";
global.STRUCTURE_RAMPART = "rampart";
global.STRUCTURE_FACTORY = "factory";
global.STRUCTURE_POWER_SPAWN = "powerSpawn";
global.STRUCTURE_OBSERVER = "observer";
global.STRUCTURE_EXTRACTOR = "extractor";
global.STRUCTURE_NUKER = "nuker";
global.FIND_STRUCTURES = 2;
global.FIND_SOURCES = 3;
global.FIND_MINERALS = 4;

global.Memory = { rooms: {} };
global.Game = { time: 1000 };

const { CACHE } = require("../constants");
const scanner = require("../scanner");

let findCalls = 0;

function struct(id, structureType, my, extra) {
  return Object.assign({ id, structureType, my: my !== false }, extra || {});
}

/** Комната с подменяемым набором структур. */
function makeRoom(structures, level) {
  return {
    name: "W1N1",
    controller: { level },
    storage: null,
    terminal: null,
    structures,
    find(kind) {
      findCalls++;
      if (kind === global.FIND_STRUCTURES) return this.structures;
      if (kind === global.FIND_SOURCES) return [{ id: "src1" }];
      if (kind === global.FIND_MINERALS) return [{ id: "min1" }];
      return [];
    },
  };
}

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra === undefined ? "" : " — " + extra}`);
  }
}

const room = makeRoom(
  [
    struct("sp1", "spawn"),
    struct("ext1", "extension"),
    struct("ext2", "extension"),
    struct("road1", "road"),
    struct("wall1", "wall"),
    struct("ramp1", "rampart"),
    struct("tow1", "tower"),
    struct("enemySpawn", "spawn", false), // чужой — не должен попасть
  ],
  4,
);

console.log("1. Первый вызов строит кэш");
findCalls = 0;
let cache = scanner.getStructureCache(room);
check("кэш создан", !!cache && Array.isArray(cache.extensionIds));
check("расширения найдены", cache.extensionIds.length === 2, String(cache.extensionIds.length));
check("чужие структуры не попали", cache.spawnIds.length === 1, JSON.stringify(cache.spawnIds));
check("дороги/стены/валы на месте", cache.roadIds.length === 1 && cache.wallIds.length === 1 && cache.rampartIds.length === 1);
check("версия схемы записана", cache.v === scanner.CACHE_VERSION, String(cache.v));
check("updatedAt записан", cache.updatedAt === 1000, String(cache.updatedAt));

console.log("\n2. Один проход room.find вместо четырёх");
check("room.find вызван 3 раза (structures + sources + minerals)", findCalls === 3, String(findCalls));

console.log("\n3. В пределах интервала — пересканирования нет");
findCalls = 0;
global.Game.time = 1000 + CACHE.REFRESH_INTERVAL - 1;
scanner.getStructureCache(room);
check("room.find не вызывался", findCalls === 0, String(findCalls));

console.log("\n4. После порога — пересканирование и НОВАЯ структура в кэше");
// Именно этот сценарий раньше был сломан: построили extension — кэш не обновился.
room.structures.push(
  struct("ext3", "extension"),
  // Повреждённая дорога: hits < hitsMax (правка шага 2 — damagedRoadIds).
  struct("road2", "road", true, { hits: 100, hitsMax: 5000 }),
  // Повреждённая владельческая структура (правка 29.09.2026 — damagedStats):
  // башня вдвое хуже максимума.
  struct("tow2", "tower", true, { hits: 1500, hitsMax: 3000 }),
);
// Порог перестройки сдвинут по имени комнаты (разносим пики по тикам),
// поэтому берём время с запасом в один полный интервал.
global.Game.time = 1000 + CACHE.REFRESH_INTERVAL * 2;
findCalls = 0;
const rebuilt = scanner.getStructureCache(room);
check("пересканирование выполнено", findCalls > 0, String(findCalls));
check("новый extension попал в кэш", rebuilt.extensionIds.includes("ext3"), rebuilt.extensionIds.join(","));
check("новая дорога попала в кэш", rebuilt.roadIds.includes("road2"), rebuilt.roadIds.join(","));
check(
  "повреждённая дорога отмечена в damagedRoadIds",
  rebuilt.damagedRoadIds.length === 1 && rebuilt.damagedRoadIds[0] === "road2",
  JSON.stringify(rebuilt.damagedRoadIds),
);
check(
  "целая дорога в damagedRoadIds не попала",
  !rebuilt.damagedRoadIds.includes("road1"),
  JSON.stringify(rebuilt.damagedRoadIds),
);
// Правка 29.09.2026 (вариант B): рядом с id кладутся ЧИСЛА hits/hitsMax,
// чтобы генератор repair-задач обходился без Game.getObjectById на каждую
// дорогу. Проверяем, что числа те же, что у объекта.
check(
  "числа кэша совпадают с дорогой",
  rebuilt.damagedRoadCount === 1 &&
    rebuilt.damagedRoadHits[0] === 100 &&
    rebuilt.damagedRoadHitsMax[0] === 5000,
  `${rebuilt.damagedRoadCount}: ${rebuilt.damagedRoadHits[0]}/${rebuilt.damagedRoadHitsMax[0]}`,
);
check(
  "целая дорога чисел не добавила",
  rebuilt.damagedRoadCount === rebuilt.damagedRoadIds.length,
  `${rebuilt.damagedRoadCount} != ${rebuilt.damagedRoadIds.length}`,
);
// Повреждённая башня в числах владельческих структур: typeCode 2 — это
// STRUCTURE_TOWER (порядок DAMAGED_TYPE_NAMES в scanner.js).
check(
  "повреждённая башня попала в damagedIds",
  rebuilt.damagedCount === 1 && rebuilt.damagedIds[0] === "tow2",
  `${rebuilt.damagedCount}: ${JSON.stringify(rebuilt.damagedIds)}`,
);
check(
  "числа владельческой структуры сняты верно",
  rebuilt.damagedStats[0] === 2 &&
    rebuilt.damagedStats[1] === 1500 &&
    rebuilt.damagedStats[2] === 3000,
  Array.from(rebuilt.damagedStats).slice(0, 3).join(","),
);
check(
  "целые владельческие структуры чисел не дали",
  rebuilt.damagedCount === 1,
  String(rebuilt.damagedCount),
);
check("всего расширений 3", rebuilt.extensionIds.length === 3, String(rebuilt.extensionIds.length));
check("updatedAt обновлён", rebuilt.updatedAt === 1000 + CACHE.REFRESH_INTERVAL * 2, String(rebuilt.updatedAt));

console.log("\n5. Смена уровня контроллера — перестройка немедленно");
global.Game.time += 1;
findCalls = 0;
room.controller.level = 5;
scanner.getStructureCache(room);
check("кэш перестроен вне возрастного порога", findCalls > 0, String(findCalls));

console.log("\n6. Битая/старая схема кэша перестраивается");
global.__structureCache.W1N1 = { v: 1, extensionIds: [] };
global.Game.time += 1;
findCalls = 0;
const fixed = scanner.getStructureCache(room);
check("старая версия перестроена", findCalls > 0 && fixed.v === scanner.CACHE_VERSION);
check("массивы восстановлены", Array.isArray(fixed.towerIds) && fixed.spawnIds.length === 1);

global.__structureCache.W1N1 = {
  v: scanner.CACHE_VERSION,
  updatedAt: global.Game.time,
  extensionIds: [],
};
global.Game.time += 1;
findCalls = 0;
scanner.getStructureCache(room);
check("неполный кэш перестроен", findCalls > 0, String(findCalls));

console.log("\n8. Кэш живёт в heap, Memory его не содержит");
check("в Memory кэша нет", (Memory.rooms.W1N1 || {}).structureCache === undefined);
check(
  "в heap кэш есть",
  !!global.__structureCache.W1N1 && global.__structureCache.W1N1.v === scanner.CACHE_VERSION,
);
// Прежняя копия в Memory вычищается при первой же перестройке.
// scanner больше не создаёт Memory.rooms[room] сам — только читает.
Memory.rooms.W1N1 = Memory.rooms.W1N1 || {};
Memory.rooms.W1N1.structureCache = { v: 1, legacy: true };
scanner.invalidateStructureCache("W1N1");
scanner.getStructureCache(room);
check("старая копия в Memory удалена", Memory.rooms.W1N1.structureCache === undefined);
check(
  "кэш по-прежнему доступен из heap",
  scanner.getStructureCache(room).v === scanner.CACHE_VERSION &&
    Array.isArray(scanner.getStructureCache(room).extensionIds),
);

console.log("\n7. Принудительная инвалидация");
scanner.getStructureCache(room);
global.Game.time += 1;
room.structures.push(struct("ext4", "extension"));
scanner.invalidateStructureCache("W1N1");
findCalls = 0;
const forced = scanner.getStructureCache(room);
check("перестройка по требованию", findCalls > 0, String(findCalls));
check("новый extension виден", forced.extensionIds.includes("ext4"), forced.extensionIds.join(","));

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
