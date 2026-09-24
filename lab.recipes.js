/**
 * ===================================================
 * LAB.RECIPES.JS — две реакции на производственную тройку
 * ===================================================
 * Реализация docs/LAB_BOOST_PRODUCTION_PLAN.md:
 *   - каждая производственная тройка (Memory.rooms[].labs*) получает ДВА
 *     рецепта (recipeA / recipeB) и пороги буферизации (lowA/highA, lowB/highB);
 *   - рецепт выбирается по фактическому дефициту продукта с гистерезисом
 *     LOW < HIGH (без дребезга и без фиксированного таймера);
 *   - выбранный рецепт проецируется в привычные поля конфига
 *     `reagent1 / reagent2 / product` (+ служебное `active`), поэтому весь
 *     существующий код (lab.manager.runReaction, lab.worker, terminalNetwork,
 *     market.manager) продолжает работать без изменения своих контрактов.
 *
 * Схема конфига тройки в Memory.rooms[roomName].labs*:
 *
 *   {
 *     lab1: 'ID', lab2: 'ID', reactor: 'ID',
 *     // активный рецепт — то, что читают все потребители:
 *     reagent1: 'KH2O', reagent2: 'X', product: 'XKH2O', active: 'A',
 *     // план (пишется из LAB_PLAN, консольных правок не требует):
 *     recipeA: { reagent1: 'KH2O', reagent2: 'X', product: 'XKH2O' },
 *     recipeB: { reagent1: 'KHO2', reagent2: 'X', product: 'XKHO2' },
 *     lowA: 1200, highA: 3000, lowB: 900, highB: 2400
 *   }
 *
 * ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВДЫ по комнатам и рецептам — LAB_PLAN в
 * constants.js. Из плана в Memory синхронизируются reagent1/reagent2, product,
 * recipeA/recipeB и пороги, поэтому старый код, читающий Memory.rooms[].labs*,
 * видит актуальную реакцию.
 *
 * ВАЖНО ПРО ИМЕНА РЕАКЦИЙ (проверено запросом к живому shard3, а не по
 * документации): движок различает UHO2 и UH2O — это РАЗНЫЕ ресурсы:
 *   REACTIONS.UO.OH === "UHO2"  (utrium alkalide  → XUHO2, harvest 7)
 *   REACTIONS.UH.OH === "UH2O"  (utrium acid      → XUH2O, attack 4)
 * Прежний комментарий здесь утверждал обратное («ресурса UHO2 в таблице реакций
 * нет»), из-за чего план E37S38 требовал несуществующую реакцию UO + OH → UH2O,
 * а продуктом хаба вместо добычного XUHO2 стоял боевой XUH2O. В LAB_PLAN теперь
 * стоят ФАКТИЧЕСКИЕ движковые имена.
 *
 * CPU: одна синхронизация на комнату за тик (tick-кэш в heap
 * `global._labPlan`); объекты лабораторий разрешаются один раз за тик на
 * комнату. room.find появляется только в момент реальной починки привязки
 * троек (ensureTriples), а не каждый тик. Циклов по империи нет.
 * ===================================================
 */

const { LAB_PLAN, LAB_BINDING, LAB_BOOST, LAB_PRIORITY } = require("./constants");

/** Ключи слотов троек (совпадают с ключами Memory.rooms[]). */
const SLOT_KEYS = ["labs", "labs2", "labs3", "labs4", "labs5"];

/** Роли лабораторий внутри тройки (см. docs/Labs.md). */
const LAB_SLOTS = ["lab1", "lab2", "reactor"];

/**
 * Через сколько тиков непрерывного простоя тройка обязана возобновить работу,
 * если цель (HIGH) так и не достигнута.
 *
 * 100 тиков. Ориентиры при выборе: цикл реакции — 60 тиков (REACTION_TIME), то
 * есть срок должен быть не меньше его, иначе тройка дёргалась бы вокруг
 * собственного производства; поставка сети приходит за единицы тиков. Первая
 * редакция правила держала 600 тиков, и это оказалось непрактично: на медленном
 * шарде (замер: ~0.03–0.3 тика/с) 600 тиков — это часы реального времени, а
 * простаивающие тройки владелец видит как «лабы не работают».
 *
 * Дребезга порог не создаёт: возобновление возможно только при НЕДОСТИГНУТОЙ
 * цели (продукт < HIGH). Насыщенная тройка, чей продукт выше цели, не
 * возобновляется вовсе — сколько бы ни простояла. Дребезг возможен лишь в узкой
 * полосе чуть ниже цели: там тройка сваривает 5 единиц и снова уходит в простой,
 * то есть пишет Memory раз в 100 тиков — это дешевле, чем вечный простой.
 */
const IDLE_RESUME_TICKS = 100;

// ── ПЕР-ТИКОВЫЙ КЭШ ──────────────────────────────────────────────────────
/**
 * Кэш на тик: разрешённые объекты лабораторий и вычисленный список активных
 * троек. Живёт в heap и сбрасывается при смене тика/Global Reset.
 * @returns {{tick: number, rooms: Object<string, Object>}}
 */
function heap() {
  const cache = global._labPlan;
  if (!cache || cache.tick !== Game.time) {
    return (global._labPlan = { tick: Game.time, rooms: {} });
  }
  return cache;
}

/**
 * @param {Room} room
 * @returns {Object} запись комнаты в heap-кэше
 */
function roomEntry(room) {
  const h = heap();
  let entry = h.rooms[room.name];
  if (!entry) entry = h.rooms[room.name] = { byId: {}, synced: false };
  return entry;
}


/**
 * Разрешённый объект по id из tick-кэша комнаты. Разрушенная лаборатория
 * остаётся в кэше как null и не разыменовывается повторно в этом тике.
 * @param {Room} room
 * @param {string} id
 * @returns {StructureLab|null}
 */
function labById(room, id) {
  if (!id) return null;
  const byId = roomEntry(room).byId;
  let lab = byId[id];
  if (lab === undefined) {
    lab = Game.getObjectById(id) || null;
    byId[id] = lab;
  }
  return lab;
}

// ── ЗАПАС ПРОДУКТА ───────────────────────────────────────────────────────
/**
 * Запас продукта: реактор тройки + Storage + Terminal комнаты.
 *
 * Берётся именно реактор, а не lab1/lab2: продукт синтеза падает в реактор и
 * не смешивается там с реагентами. Если считать ещё и lab1/lab2, при смене
 * рецепта остаток реагента прошлой реакции засчитывался бы как запас нового
 * продукта и рецепт «перевыбирался» бы на пустом месте.
 *
 * @param {Room} room
 * @param {StructureLab|null} reactor
 * @param {string} product
 * @returns {number}
 */
function stockOf(room, reactor, product) {
  if (!product) return 0;
  let total = 0;
  if (reactor) total += reactor.store[product] || 0;
  const storage = room.storage;
  if (storage) total += storage.store[product] || 0;
  const terminal = room.terminal;
  if (terminal) total += terminal.store[product] || 0;
  return total;
}

// ── ВЫБОР РЕЦЕПТА ────────────────────────────────────────────────────────
/**
 * Выбор активного рецепта по дефициту с гистерезисом (чистая функция, без
 * обращений к Memory — юнит-тестируема).
 *
 * Правило (ТЗ, раздел «Правило переключения двух рецептов»):
 *   1. активный рецепт не добрал свой HIGH → продолжаем его;
 *   2. иначе (насыщен) → переключаемся на второй рецепт, если его продукт ниже
 *      своего HIGH и он РЕАЛЬНО может вариться;
 *   3. иначе тройка простаивает и возобновляет работу, только когда продукт
 *      ушёл ниже своего LOW (коридор [low, high] = гистерезис простоя).
 *
 * ПОЧЕМУ ПЕРЕКЛЮЧЕНИЕ ТОЛЬКО ПО HIGH:
 *   - это и есть гистерезис: чтобы сменить решение, продукту нужно пройти весь
 *     коридор [low, high], поэтому переключений «около границы» не бывает;
 *   - «залипание» исключено: HIGH всегда достижим (реактор вмещает 3000),
 *     а правило 3 держит тройку на рецепте, пока он не доберёт верхнюю границу.
 *
 * ЧТО ДОБАВЛЕНО (дефект живого shard3). Раньше функция ВСЕГДА возвращала "A"
 * или "B", не проверяя, есть ли в лабораториях сырьё вообще. Тройка E35S37.labs3
 * переключилась на XGHO2 (GHO2 + X) в тот момент, когда XLHO2 перевалил highA, а
 * GHO2 не существовало нигде (G-цепочка стояла): stockB = 0 < highB, поэтому
 * правило «продолжаем B» держало её на B НАВСЕГДА — при том, что XLHO2 в
 * терминале было 6220 при цели 3000. Финальная тройка хаба перестала работать
 * навсегда, а с ней и весь резерв.
 *
 * Поэтому:
 *   - `canRun(slot)` — можно ли провести реакцию ПРЯМО СЕЙЧАС (оба реагента
 *     лежат в lab1/lab2 не меньше LAB_REACTION_AMOUNT). Рецепт, который не может
 *     вариться, не удерживает тройку, если второй рецепт вариться может;
 *   - возврат `null` = «не варим»: продуктов достаточно (или сырья нет ни для
 *     одного рецепта). Раньше тройка в этом состоянии продолжала варить активный
 *     продукт выше HIGH (именно так в E35S39 накопилось 82 700 KO).
 *
 * @param {Object} params
 * @param {string|undefined} params.active текущий рецепт ("A"/"B"/null)
 * @param {number} params.lowA
 * @param {number} params.highA
 * @param {number} params.lowB
 * @param {number} params.highB
 * @param {function(string): number} params.stock запас продукта по слоту
 * @param {function(string): boolean} [params.canRun] можно ли варить слот сейчас
 *   (по умолчанию true — поведение без проверки сырья, как для ручных конфигов)
 * @param {number} [params.idleTicks] сколько тиков тройка уже простаивает (0 или
 *   не задано — обычный режим). При idleTicks ≥ IDLE_RESUME_TICKS тройка
 *   возобновляет работу, даже если продукт не упал ниже LOW, — при условии, что
 *   цель (HIGH) ещё не достигнута. Без этого параметра поведение прежнее.
 * @returns {"A"|"B"|null} рецепт для работы либо null — тройка не варит
 */
function selectRecipe(params) {
  const { active, highA, highB, stock } = params;

  // Порог LOW по умолчанию равен HIGH: конфиг без low ведёт себя как
  // «порог включения», без гистерезиса (безопасный дефолт, не типичный режим).
  const lowA = typeof params.lowA === "number" ? params.lowA : highA;
  const lowB = typeof params.lowB === "number" ? params.lowB : highB;
  const canRun =
    typeof params.canRun === "function" ? params.canRun : () => true;

  const stockA = stock("A") || 0;
  const stockB = stock("B") || 0;
  const fullA = stockA >= highA;
  const fullB = stockB >= highB;

  // 1. Активный рецепт не насыщен и реально может вариться → продолжаем его.
  if (active === "A" && !fullA && canRun("A")) return "A";
  if (active === "B" && !fullB && canRun("B")) return "B";

  // 2. Активный рецепт насыщен (или стоит без сырья) → второй рецепт, если он
  //    не насыщен и может вариться. Проверка canRun здесь и есть лекарство от
  //    «вечного залипания»: рецепт без сырья не занимает тройку.
  if (active === "A" && !fullB && canRun("B")) return "B";
  if (active === "B" && !fullA && canRun("A")) return "A";

  // 3. Простой. Возобновляем рецепт только после того, как его продукт ушёл
  //    ниже LOW (гистерезис простоя; сюда же попадает первый запуск/сброс
  //    Memory, когда active ещё не выставлен, а склады пусты).
  if (stockA < lowA && canRun("A")) return "A";
  if (stockB < lowB && canRun("B")) return "B";

  // 3b. ДЛИТЕЛЬНЫЙ ПРОСТОЙ ПРИ НЕДОСТИГНУТОЙ ЦЕЛИ — ВОЗОБНОВЛЯЕМ (ТЗ владельца
  //     «лабы должны работать»). Гистерезис [LOW, HIGH] задуман против дребезга
  //     около границы, но у него есть побочный эффект: тройка, чей продукт встал
  //     ВНУТРИ коридора (LOW ≤ stock < HIGH), не варит НИКОГДА, если продукт
  //     никто не расходует. Живой shard3 при выключенных бустах: E35S37 XKH2O
  //     1410 при пороге 800/2500 — запас НЕ набран, а все три тройки комнаты на
  //     паузе (8 троек из 15 по империи). Продукт не расходуется → ниже LOW он не
  //     уйдёт никогда → тройка простаивает вечно.
  //
  //     Поэтому у простоя появился срок: если тройка простояла idleTicks ≥
  //     IDLE_RESUME_TICKS и цель ВСЁ ЕЩЁ не достигнута (stock < HIGH), она
  //     возобновляет работу. Дребезг это не возвращает: возобновление возможно
  //     не чаще, чем раз в IDLE_RESUME_TICKS, а обычный (короткий) простой при
  //     насыщенной цели ведёт себя ровно как раньше — параметр idleTicks
  //     приходит только из lab.manager (config.pausedTick), и без него функция
  //     работает по прежним правилам.
  const idleTicks = typeof params.idleTicks === "number" ? params.idleTicks : 0;
  if (idleTicks >= IDLE_RESUME_TICKS) {
    if (stockA < highA && canRun("A")) return "A";
    if (stockB < highB && canRun("B")) return "B";
  }

  // 4. Ни один рецепт не нужен (всё насыщено) или сырья нет ни для одного:
  //    тройка НЕ варит. lab.manager.runReaction пропускает такую тройку по
  //    флагу config.paused.
  return null;
}

/**
 * Статическая запись плана для слота комнаты.
 * @param {string} roomName
 * @param {string} key
 * @returns {Object|null}
 */
function plannedSlot(roomName, key) {
  const plan = LAB_PLAN[roomName];
  if (!plan) return null;
  return plan[key] || null;
}

/**
 * Лаборатория, которую тройки комнаты уже занимают, либо null.
 *
 * Нужна bootstrap-у буст-лабы: одна и та же лаборатория не может быть
 * одновременно участником реакции и точкой бустирования (ТЗ §17 «не
 * использовать boost-lab как production-lab» и наоборот). Проверяются ВСЕ
 * слоты Memory, а не только те, что есть в LAB_PLAN: тройка могла быть
 * настроена вручную.
 * @param {Object} mem Memory.rooms[roomName]
 * @param {string} labId
 * @returns {{key: string, slot: string}|null}
 */
function tripleSlotOf(mem, labId) {
  if (!labId) return null;
  for (let i = 0; i < SLOT_KEYS.length; i++) {
    const key = SLOT_KEYS[i];
    const config = mem[key];
    if (!config) continue;
    for (let j = 0; j < LAB_SLOTS.length; j++) {
      if (config[LAB_SLOTS[j]] === labId) return { key, slot: LAB_SLOTS[j] };
    }
  }
  return null;
}

/**
 * Свободная лаборатория комнаты для буст-лабы: принадлежит этой комнате, не
 * занята ни одной тройкой и, если слот в плане есть, лежит в нём.
 *
 * Координаты слотов (lab1/lab2/reactor) в LAB_PLAN намеренно не хранятся (см.
 * constants.js: привязка лабораторий — свойство комнаты, docs/Labs.md), но
 * фактические ID лежат в Memory.rooms[].labs* — и при первой настройке, и при
 * восстановлении Memory. Поэтому слот нужен только как порядок предпочтения:
 * сначала lab1 плановых троек, затем lab2, затем reactor, затем любая
 * свободная лаборатория комнаты. Если ни одна тройка не настроена (пустая
 * Memory), предпочтение не работает и берётся любая лаборатория комнаты —
 * иначе буст-лаба не восстановилась бы без ручной настройки Memory.
 * @param {Room} room
 * @param {Object} mem
 * @returns {StructureLab|null}
 */
function findBoostLab(room, mem) {
  const free = (candidate) => {
    if (!candidate) return false;
    if (candidate.room && candidate.room.name !== room.name) return false;
    return !tripleSlotOf(mem, candidate.id);
  };

  // 1. Порядок предпочтения из плана: lab1 → lab2 → reactor.
  for (let j = 0; j < LAB_SLOTS.length; j++) {
    const slot = LAB_SLOTS[j];
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const planned = plannedSlot(room.name, SLOT_KEYS[i]);
      if (!planned) continue;
      const config = mem[SLOT_KEYS[i]];
      if (!config) continue;
      const lab = labById(room, config[slot]);
      if (free(lab)) return lab;
    }
  }

  // 2. План не помог (тройки не настроены) — любая свободная лаборатория
  //    комнаты. Список берётся из лабораторий, уже прописанных в Memory
  //    комнаты (labs*/lab1|lab2|reactor): без циклов по империи и без
  //    room.find, тем же tick-кэшем labById, что и весь остальной модуль.
  for (let i = 0; i < SLOT_KEYS.length; i++) {
    const config = mem[SLOT_KEYS[i]];
    if (!config) continue;
    for (let j = 0; j < LAB_SLOTS.length; j++) {
      const lab = labById(room, config[LAB_SLOTS[j]]);
      if (free(lab)) return lab;
    }
  }
  return null;
}

/**
 * ── ПОЧИНКА И ВОССТАНОВЛЕНИЕ ПРИВЯЗКИ ТРОЕК ─────────────────────────────
 * Слоты lab1/lab2/reactor в Memory мог занять кто угодно: в живом shard3
 * E35S37.labs3 был связан с ТЕМИ ЖЕ лабораториями, что и labs (30,12 / 32,12 /
 * 31,12), а три лаборатории 23,9 / 21,9 / 22,9 не использовались ни одной
 * тройкой. Следствие: у хаба финального производства было две работающие тройки
 * вместо трёх, и весь резерв бустов набирался в полтора раза медленнее.
 *
 * ensureTriples сверяет привязку с таблицей координат LAB_BINDING и починяет её
 * тем же приёмом, что ensureBoostLab лечит буст-лабу:
 *   - КОРРЕКТНАЯ привязка не трогается (проверка: лаборатория каждого слота
 *     существует, лежит на ожидаемых координатах и не занята другим слотом);
 *   - при расхождении слоты перепривязываются к лабораториям, найденным по
 *     координатам LAB_BINDING (один room.find — и только в момент починки);
 *   - отсутствующий конфиг тройки создаётся (Global Reset/правка Memory):
 *     рецепты, пороги и активный рецепт допишет обычный sync → applyPlan;
 *   - если лабораторий по координатам нет, НИЧЕГО не пишется: привязка не
 *     создаётся «в театре», комната просто продолжает работать как есть.
 *
 * CPU: одна проверка на комнату за тик (heap-флаг), объекты — из tick-кэша
 * labById. room.find выполняется только при реальной починке, то есть один раз
 * за всю жизнь привязки, а не каждый тик.
 *
 * @param {Room} room
 * @returns {string[]|null} ключи починенных/созданных троек либо null
 */
function ensureTriples(room) {
  if (!room || !room.name) return null;
  const entry = roomEntry(room);
  if (entry.bindingChecked) return entry.bindingFixed || null;
  entry.bindingChecked = true;

  const table = LAB_BINDING[room.name];
  const mem = room.memory;
  if (!table || !mem) return null;

  const fixed = [];
  const used = /** @type {Object<string, string>} */ ({});

  for (let i = 0; i < SLOT_KEYS.length; i++) {
    const key = SLOT_KEYS[i];
    const coords = table[key];
    if (!coords) continue;

    const config = mem[key];
    if (config && config.lab1 && config.lab2 && config.reactor) {
      // Проверка соответствия таблице и отсутствия пересечений со слотами,
      // проверенными ранее в этом же проходе.
      let ok = true;
      for (let j = 0; j < LAB_SLOTS.length; j++) {
        const id = config[LAB_SLOTS[j]];
        if (used[id] || !matchesCoords(labById(room, id), coords[j])) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (let j = 0; j < LAB_SLOTS.length; j++)
          used[config[LAB_SLOTS[j]]] = key;
        continue;
      }
    }

    const ids = resolveByCoords(room, coords);
    if (!ids) continue;

    const target = config || (mem[key] = {});
    for (let j = 0; j < LAB_SLOTS.length; j++) target[LAB_SLOTS[j]] = ids[j];
    for (let j = 0; j < LAB_SLOTS.length; j++) used[ids[j]] = key;
    // Пустой конфиг (Global Reset) — не «залипаем» на неполной проекции: sync
    // запишет рецепты и пороги, потому что planUpToDate вернёт false.
    fixed.push(key);
    console.log(
      `[LabRecipes] ${room.name}.${key}: привязка троек ${config ? "исправлена" : "создана"} по координатам LAB_BINDING`,
    );
  }

  entry.bindingFixed = fixed.length ? fixed : null;
  return entry.bindingFixed;
}

/**
 * Лаборатория комнаты на ожидаемых координатах.
 * @param {StructureLab|null} lab
 * @param {number[]} coords [x, y]
 * @returns {boolean}
 */
function matchesCoords(lab, coords) {
  if (!lab || !lab.pos || !coords) return false;
  return lab.pos.x === coords[0] && lab.pos.y === coords[1];
}

/**
 * ID слотов тройки по координатам таблицы. Возвращает null, если хотя бы одной
 * лаборатории по координатам нет (или комната не умеет room.find — например,
 * мок в офлайн-тестах): тогда привязка не трогается вовсе.
 * @param {Room} room
 * @param {number[][]} coords
 * @returns {string[]|null}
 */
function resolveByCoords(room, coords) {
  const entry = roomEntry(room);
  let byPos = entry.labPos;
  if (!byPos) {
    if (typeof room.find !== "function") return null;
    byPos = entry.labPos = {};
    const labs = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LAB,
    });
    for (let i = 0; i < labs.length; i++) {
      const lab = labs[i];
      if (!lab || !lab.pos) continue;
      byPos[lab.pos.x + "," + lab.pos.y] = lab;
    }
  }

  const ids = [];
  for (let j = 0; j < LAB_SLOTS.length; j++) {
    const lab = byPos[coords[j][0] + "," + coords[j][1]];
    if (!lab) return null;
    ids.push(lab.id);
  }
  return ids;
}

/**
 * Восстанавливает Memory.rooms[roomName].boostLab из конфигурации комнаты
 * (LAB_BOOST.BOOST_LAB в constants.js), если записи нет.
 *
 * Раньше boostLab приходилось прописывать в Memory вручную из консоли, и после
 * Global Reset (Memory пуста) буст-лаба исчезала: lab.worker не видел её
 * ресурсы, boost.manager не выдавал бусты, а рынок терял защиту бустов от
 * продажи. Теперь запись восстанавливается сама в первом же тике.
 *
 * Вызывается из lab.manager.run — то есть ДО терминальной сети, рынка и
 * boost.manager в том же тике, поэтому все потребители видят уже
 * восстановленную запись. Отдельного планировщика нет: одна проверка на
 * комнату за тик (heap-флаг), стоимость — одно чтение Memory.
 *
 * Идемпотентность и безопасность:
 *   - корректная существующая запись НЕ затирается (даже если её нет в
 *     конфигурации: ручная привязка остаётся в силе);
 *   - привязка создаётся, только если лаборатория РЕАЛЬНО существует в игре и
 *     находится в этой комнате, иначе буст-лаба не подменяется театром;
 *   - привязка не создаётся, если по конфигурации буст-лабы для комнаты нет
 *     (комната с одной лабораторией не отдаёт её под бусты);
 *   - привязка не создаётся, если все лаборатории заняты тройками (иначе
 *     буст-лаба украла бы лабораторию реакции);
 *   - уже существующая запись не считается «испорченной» из-за того, что она
 *     совпала с тройкой: это дело конфигурации комнаты, а не bootstrap-а.
 *
 * @param {Room} room
 * @returns {string|null} итоговый id буст-лабы комнаты
 */
function ensureBoostLab(room) {
  if (!room || !room.name) return null;
  const entry = roomEntry(room);
  if (entry.boostChecked) {
    const mem = room.memory;
    return mem && mem.boostLab ? mem.boostLab : null;
  }
  entry.boostChecked = true;

  const mem = room.memory;
  if (!mem) return null;

  // Конфигурация не описывает буст-лабу этой комнаты — записи быть не должно.
  const configured = LAB_BOOST.BOOST_LAB[room.name];
  if (!configured) return null;

  // Уже настроено вручную — не трогаем.
  if (mem.boostLab) return mem.boostLab;

  // План есть, но тройки в Memory ещё не привязаны к лабораториям: слоты
  // неизвестны, автоподбор мог бы занять лабораторию будущей тройки. Пропускаем
  // (проверка повторится в следующем тике и восстановление произойдёт сразу
  // после того, как Memory получит свой labs*/lab1/lab2/reactor).
  const plan = LAB_PLAN[room.name];
  if (plan) {
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      if (plan[SLOT_KEYS[i]] && !mem[SLOT_KEYS[i]]) return null;
    }
  }

  const id = findBoostLabId(room, mem, configured);
  if (id) mem.boostLab = id;
  return id;
}

/**
 * ID буст-лабы: сначала лаборатория из конфигурации комнаты, затем — свободная
 * лаборатория комнаты (её ID стабилен, поэтому запись в Memory остаётся
 * корректной между тиками).
 * @param {Room} room
 * @param {Object} mem
 * @param {string} configured
 * @returns {string|null}
 */
function findBoostLabId(room, mem, configured) {
  const lab = labById(room, configured);
  if (lab && !tripleSlotOf(mem, configured)) return configured;
  const fallback = findBoostLab(room, mem);
  return fallback ? fallback.id : null;
}

/**
 * Проверяет, совпадает ли статическая часть конфига с планом (рецепты, пороги).
 * @param {Object} config
 * @param {Object} planned
 * @returns {boolean}
 */
function planUpToDate(config, planned) {
  return (
    !!config.recipeA &&
    !!config.recipeB &&
    config.recipeA.reagent1 === planned.recipeA.reagent1 &&
    config.recipeA.reagent2 === planned.recipeA.reagent2 &&
    config.recipeA.product === planned.recipeA.product &&
    config.recipeB.reagent1 === planned.recipeB.reagent1 &&
    config.recipeB.reagent2 === planned.recipeB.reagent2 &&
    config.recipeB.product === planned.recipeB.product &&
    config.lowA === planned.lowA &&
    config.highA === planned.highA &&
    config.lowB === planned.lowB &&
    config.highB === planned.highB
  );
}

/**
 * ── ГОТОВНОСТЬ ТРОЙКИ К РЕАКЦИИ ──────────────────────────────────────────
 * Движок требует LAB_REACTION_AMOUNT (5) единиц КАЖДОГО реагента; при меньшем
 * количестве runReaction возвращает ERR_NOT_ENOUGH_RESOURCES, и тройка просто
 * молчит. Живой пример: в E35S37.labs лежало KH2O 500 и X 4 — реакция XKH2O не
 * запускалась НИКОГДА, хотя запас выглядел ненулевым.
 * @returns {number}
 */
function reactionAmount() {
  return typeof LAB_REACTION_AMOUNT === "number" ? LAB_REACTION_AMOUNT : 5;
}

/**
 * Может ли слот вариться прямо сейчас (оба реагента есть в своих лабораториях).
 * @param {Room} room
 * @param {Object} config
 * @param {string} slot "A" | "B"
 * @returns {boolean}
 */
function reactionReady(room, config, slot) {
  const recipe = slot === "B" ? config.recipeB : config.recipeA;
  if (!recipe) return false;
  const need = reactionAmount();
  const lab1 = labById(room, config.lab1);
  const lab2 = labById(room, config.lab2);
  if (!lab1 || !lab2) return false;
  return (
    (lab1.store[recipe.reagent1] || 0) >= need &&
    (lab2.store[recipe.reagent2] || 0) >= need
  );
}

/**
 * Приводит конфиг тройки к плану: recipeA/recipeB, пороги, выбранный рецепт и
 * его проекция в reagent1/reagent2/product.
 *
 * Запись в Memory происходит ТОЛЬКО при реальном расхождении (первый запуск,
 * правка LAB_PLAN, смена рецепта), поэтому Memory не «пачкается» каждый тик.
 * Поля lab1/lab2/reactor не трогаются: план задаёт рецепты и пороги, а
 * привязка тройки к конкретным лабораториям остаётся в Memory (её же
 * описывает docs/Labs.md и правит консоль).
 *
 * @param {Room} room
 * @param {string} key
 * @param {Object} config
 * @param {Object} planned
 * @returns {Object} тот же объект конфига (изменённый и записанный в Memory)
 */
function applyPlan(room, key, config, planned) {
  const fresh = planUpToDate(config, planned);

  if (!fresh) {
    // План изменился (деплой новой версии констант) — переписываем рецепты и
    // пороги и выбираем рецепт заново.
    config.recipeA = {
      reagent1: planned.recipeA.reagent1,
      reagent2: planned.recipeA.reagent2,
      product: planned.recipeA.product,
    };
    config.recipeB = {
      reagent1: planned.recipeB.reagent1,
      reagent2: planned.recipeB.reagent2,
      product: planned.recipeB.product,
    };
    config.lowA = planned.lowA;
    config.highA = planned.highA;
    config.lowB = planned.lowB;
    config.highB = planned.highB;
    config.active = undefined;
    config.paused = false;
  }

  // Текущее решение тройки обязано дойти до селектора: от него зависит
  // гистерезис. Если тройка была на простое, решения у неё нет (null), и
  // селектор решает заново — возобновление возможно только после того, как
  // продукт ушёл ниже LOW.
  const wasPaused = config.paused === true;
  const prior =
    wasPaused || !fresh
      ? wasPaused
        ? null
        : undefined
      : config.active === "A" || config.active === "B"
        ? config.active
        : undefined;

  // Срок простоя: только он позволяет тройке возобновиться при НЕДОСТИГНУТОЙ
  // цели, не дожидаясь падения продукта ниже LOW (см. правило 3b в
  // selectRecipe и IDLE_RESUME_TICKS). Тик начала простоя пишется один раз — в
  // момент перехода в простой, поэтому в обычном тике Memory не трогается.
  const idleTicks =
    wasPaused && typeof config.pausedTick === "number"
      ? Game.time - config.pausedTick
      : 0;

  // Объекты тройки разрешаются через tick-кэш по одному разу на тик. Запас
  // продуктов считается ОДИН раз: и решение, и проекция реагентов смотрят на
  // одни и те же числа.
  const reactor = labById(room, config.reactor);
  const stockOfSlot = (s) =>
    stockOf(
      room,
      reactor,
      s === "B" ? config.recipeB.product : config.recipeA.product,
    );
  const stockA = stockOfSlot("A");
  const stockB = stockOfSlot("B");
  const stock = (s) => (s === "B" ? stockB : stockA);

  // РЕШЕНИЕ тройки: что варим прямо сейчас (с учётом реального наличия сырья).
  const slot = selectRecipe({
    active: prior === null ? undefined : prior,
    lowA: config.lowA,
    highA: config.highA,
    lowB: config.lowB,
    highB: config.highB,
    stock,
    idleTicks,
    canRun: (s) => reactionReady(room, config, s),
  });

  // ПРОЕКЦИЯ: reagent1/reagent2/product обязаны быть заполнены ВСЕГДА, даже
  // когда тройка на простое или ждёт первый подвоз. Их читают labWorker (что
  // везти), terminalNetwork (что заказывать у сети), market.manager (что
  // защищать от продажи) и lab.manager (что варить). Если очистить проекцию на
  // простое (или не заполнить её при первом запуске), тройка НИКОГДА не начнёт
  // варить: сеть не узнает, какой реагент ей нужен. Поэтому «что варить» (slot)
  // и «с чем работает тройка» (intended) — разные величины:
  //   intended — рецепт по дефициту БЕЗ проверки сырья (его проекция и идёт в
  //              reagent1/2/product), поэтому заявка на реагент живёт, пока
  //              продукт ниже LOW.
  const intended =
    selectRecipe({
      active: prior === null ? undefined : prior,
      lowA: config.lowA,
      highA: config.highA,
      lowB: config.lowB,
      highB: config.highB,
      stock,
      idleTicks,
      canRun: () => true,
    }) ||
    (stockA < config.lowA ? "A" : stockB < config.lowB ? "B" : "A");

  const intendedRecipe =
    intended === "B" ? config.recipeB : config.recipeA;
  const projectionChanged =
    !config.reagent1 ||
    !config.reagent2 ||
    !config.product ||
    config.reagent1 !== intendedRecipe.reagent1 ||
    config.reagent2 !== intendedRecipe.reagent2 ||
    config.product !== intendedRecipe.product;

  // Запись в Memory — только при смене решения (смена рецепта, простой, выход
  // из простоя) или при перепроекции реагентов. В обычном тике Memory не
  // трогается.
  if (!fresh || slot !== prior || projectionChanged) {
    // Проекция реагентов — всегда по intended-рецепту.
    config.reagent1 = intendedRecipe.reagent1;
    config.reagent2 = intendedRecipe.reagent2;
    config.product = intendedRecipe.product;

    if (slot === null) {
      // Простой: реакции нет, но тройка по-прежнему «работает с» intended-
      // рецептом (см. выше) — labWorker не считает содержимое лабораторий чужим
      // и не вывозит реагенты, а lab.manager пропускает её по флагу paused.
      // Тик начала простоя фиксируется ОДИН раз: по нему selectRecipe решает,
      // не пора ли возобновиться при недостигнутой цели (правило 3b).
      config.paused = true;
      if (typeof config.pausedTick !== "number") config.pausedTick = Game.time;
      config.active = undefined;
    } else {
      config.paused = false;
      // Выход из простоя: срок обнуляется, иначе следующая пауза унаследовала бы
      // чужой отсчёт и возобновилась бы мгновенно.
      delete config.pausedTick;
      config.active = slot;
    }

    // Ссылка та же (объект берётся из room.memory), присваивание нужно только
    // для случая, когда конфиг строится заново (восстановление после правки).
    const mem = Memory.rooms && Memory.rooms[room.name];
    if (mem && mem[key] !== config) mem[key] = config;
  }

  // ОТСЧЁТ ПРОСТОЯ УЖЕ СТОЯЩЕЙ ТРОЙКИ. Пауза могла прийти из Memory (деплой этой
  // правки, правка порогов, Global Reset) — тогда перехода в простой в этом тике
  // не было, и без этой строки pausedTick остался бы незаданным: idleTicks всегда
  // 0, срок никогда не истекает, и простой снова вечный. Запись разовая — только
  // пока отсчёта нет.
  if (config.paused === true && typeof config.pausedTick !== "number") {
    config.pausedTick = Game.time;
  }

  return config;
}

/**
 * Синхронизирует тройки комнаты с LAB_PLAN и возвращает активные рецепты.
 *
 * Вызывается из lab.manager.run() до реакций. Повторные вызовы в том же тике
 * бесплатны (tick-кэш в heap). Комнаты без плана (и без полей recipeA/recipeB)
 * не трогаются вовсе — их конфиги работают в прежнем режиме одного рецепта.
 *
 * @param {Room} room
 * @returns {Array<{key: string, config: Object, recipe: Object}>}
 */
function sync(room) {
  const entry = roomEntry(room);
  if (entry.synced) return entry.list || [];

  const plan = LAB_PLAN[room.name];
  const mem = room.memory;
  const list = [];

  if (plan && mem) {
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const key = SLOT_KEYS[i];
      const planned = plan[key];
      if (!planned) continue;

      const config = mem[key];
      if (!config) continue;
      if (!config.lab1 || !config.lab2 || !config.reactor) continue;

      // Тройка, у которой уже есть свои рецепты в Memory (ручная настройка),
      // а плана на этот слот нет, сюда не попадает: planned отсутствует.
      applyPlan(room, key, config, planned);

      // В списке — рецепт, с которым тройка РАБОТАЕТ (проекция reagent1/2), и
      // признак простоя: реакции в простое нет (lab.manager её пропускает), но
      // проекция заполнена, поэтому `recipe` остаётся валидным описанием того,
      // что тройка варит при возобновлении.
      const recipe = config.active === "B" ? config.recipeB : config.recipeA;
      if (recipe)
        list.push({
          key,
          config,
          recipe,
          paused: config.paused === true,
        });
    }
  }

  entry.list = list;
  entry.synced = true;
  return list;
}

/**
 * ── ПРИОРИТЕТ ДОСТАВКИ КОМПОНЕНТОВ ФИНАЛЬНОГО ПРОИЗВОДСТВА ──────────────
 *
 * terminalNetwork делает максимум ОДНУ успешную отправку за тик, поэтому
 * очередь заявок решает, кто её получит. Заявки базовых минералов (их излишек
 * лежит без дела) забивали очередь, и E35S37 не получала промежуточные
 * компоненты: конечные X-бусты не варились, хотя сырьё было в терминалах
 * соседних комнат.
 *
 * Комната-финишёр НЕ задаётся именем: это комната плана, у которой есть тройка
 * с продуктом, содержащим маркер (LAB_PRIORITY.PRODUCT_MARKER = "X"). Так
 * приоритет работает по данным LAB_PLAN и автоматически распространяется на
 * любую комнату, которую план назначит финальной.
 * @param {string} roomName
 * @returns {boolean}
 */
function isFinalHub(roomName) {
  const plan = LAB_PLAN[roomName];
  if (!plan) return false;
  const marker = LAB_PRIORITY.PRODUCT_MARKER;
  for (let i = 0; i < SLOT_KEYS.length; i++) {
    const triple = plan[SLOT_KEYS[i]];
    if (!triple) continue;
    if (triple.recipeA && String(triple.recipeA.product).indexOf(marker) === 0)
      return true;
    if (triple.recipeB && String(triple.recipeB.product).indexOf(marker) === 0)
      return true;
  }
  return false;
}

/**
 * Ресурсы, которые считаются «промежуточными компонентами финального
 * производства»: реагенты реакций, дающих X-буст (X и шесть соединений
 * KH2O/KHO2/ZHO2/UH2O/LHO2/GHO2). Реагент2 финальных реакций — сам X, поэтому
 * он попадает в набор автоматически, без отдельной константы.
 * Считается из LAB_PLAN один раз за тик (heap-кэш).
 * @returns {Object<string, boolean>}
 */
function priorityCompounds() {
  let cached = global._labPriorityCompounds;
  if (cached && cached.tick === Game.time) return cached.map;

  const map = /** @type {Object<string, boolean>} */ ({});
  const marker = LAB_PRIORITY.PRODUCT_MARKER;
  for (const roomName in LAB_PLAN) {
    const plan = LAB_PLAN[roomName];
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const triple = plan[SLOT_KEYS[i]];
      if (!triple) continue;
      const recipes = [triple.recipeA, triple.recipeB];
      for (let j = 0; j < recipes.length; j++) {
        const recipe = recipes[j];
        if (!recipe) continue;
        if (String(recipe.product).indexOf(marker) !== 0) continue;
        if (recipe.reagent1) map[recipe.reagent1] = true;
        if (recipe.reagent2) map[recipe.reagent2] = true;
      }
    }
  }

  global._labPriorityCompounds = { tick: Game.time, map };
  return map;
}

/**
 * Реагент ли этот ресурс для тройки комнаты-завода (по плану).
 *
 * Берётся АКТИВНЫЙ рецепт, когда он известен (Memory синхронизирована): заявка
 * нужна на то сырьё, которое расходуется сейчас. Если проекции ещё нет (Global
 * Reset), ресурс считается расходуемым, когда он есть хотя бы в одном рецепте
 * тройки — так же, как это делает consumerRooms.
 * @param {string} roomName
 * @param {string} resourceType
 * @returns {boolean}
 */
function roomConsumesReagent(roomName, resourceType) {
  const plan = LAB_PLAN[roomName];
  if (!plan) return false;
  const mem = Memory.rooms && Memory.rooms[roomName];

  for (let i = 0; i < SLOT_KEYS.length; i++) {
    const key = SLOT_KEYS[i];
    const triple = plan[key];
    if (!triple) continue;

    const config = mem && mem[key] ? mem[key] : null;
    const items =
      config && config.active
        ? [config.active === "B" ? config.recipeB : config.recipeA]
        : [triple.recipeA, triple.recipeB];

    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      if (!item) continue;
      if (item.reagent1 === resourceType || item.reagent2 === resourceType)
        return true;
    }
  }
  return false;
}

/**
 * Нужен ли комнате приоритет по этому реагенту и насколько срочно.
 *
 * Уровни (БОЛЬШЕ — раньше; terminalNetwork.prioritizeLabRequests сортирует
 * заявки по убыванию priority):
 *   3 — хаб: реагент ниже своего LOW-порога из LAB_PLAN, то есть активная
 *       (ожидаемая) финальная реакция уже встала. Это ровно тот случай, ради
 *       которого приоритет и вводится.
 *   2 — хаб: компонент финального производства, но буфер ещё цел: заявка
 *       остаётся заявкой сети (порог LAB_REQUEST_BELOW), просто идёт раньше
 *       обычного balancing-а.
 *   1 — комната-завод (тройка промежуточного производства): её собственный
 *       реагент ниже порога сети. Без этого приоритета сырьё к заводам не
 *       доезжает: обычные отправки требуют энергии донора ≥
 *       TERMINAL_SUPPLY.ENERGY_MIN (100000), а в живом shard3 в терминалах
 *       48–77k — базовые минералы (O/H/Z/K/L/U) физически не могли уехать,
 *       и промежуточные тройки стояли пустыми. Приоритетная заявка идёт с
 *       полом TERMINAL_NETWORK.PRIORITY_ENERGY_FLOOR (20000).
 *   0 — приоритета нет (обычная заявка сети).
 *
 * «Ожидаемая» реакция — не только активная: у тройки два рецепта, и оба её
 * реагента входят в набор priorityCompounds, поэтому компонент под следующее
 * переключение тоже доставляется, пока буфер не насыщен.
 *
 * @param {string} roomName
 * @param {string} resourceType
 * @param {number} have локальный запас: Storage + Terminal + лаборатории
 * @returns {number}
 */
function priorityLevel(roomName, resourceType, have) {
  const plan = LAB_PLAN[roomName];
  if (!plan) return 0;

  if (isFinalHub(roomName)) {
    if (!priorityCompounds()[resourceType]) {
      // Комнат-заводов в плане больше НЕТ: финальная X-тройка стоит в каждой
      // комнате (комнату-финишёра определяет продукт с маркером "X", а не имя),
      // поэтому «свой реагент комнаты-завода» обязан получать приоритет и
      // ВНУТРИ финальной комнаты. Без этой ветки базовые минералы (K/O/H/Z/U) и
      // OH выпадали из приоритетной доставки (уровень 0) и могли ехать только
      // обычной балансировкой, а она требует энергии терминала-донора
      // ≥ TERMINAL_SUPPLY.ENERGY_MIN (100 000) — на живом shard3 это 44–77k,
      // то есть сырьё не уехало бы НИКОГДА. Именно ради обхода этого порога
      // уровень 1 и вводился.
      return roomConsumesReagent(roomName, resourceType) ? 1 : 0;
    }

    let low = 0;
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const triple = plan[SLOT_KEYS[i]];
      if (!triple) continue;
      const pairs = [
        [triple.recipeA, triple.lowA],
        [triple.recipeB, triple.lowB],
      ];
      for (let j = 0; j < pairs.length; j++) {
        const recipe = pairs[j][0];
        if (!recipe) continue;
        if (recipe.reagent1 !== resourceType && recipe.reagent2 !== resourceType)
          continue;
        const candidate = pairs[j][1];
        if (typeof candidate !== "number") continue;
        if (low === 0 || candidate < low) low = candidate;
      }
    }

    if (low > 0 && have < low) return 3;
    return 2;
  }

  // Комната-завод: приоритет только по своему реагенту.
  if (!roomConsumesReagent(roomName, resourceType)) return 0;
  return 1;
}

/**
 * Комнаты империи, чьи тройки РАСХОДУЮТ этот ресурс как реагент: в их
 * терминалах он должен лежать в первую очередь.
 *
 * Нужно там, где состояние Memory читать нельзя или рано (закупка X на рынке):
 * ресурс кладётся сразу в терминал реального потребителя, а не в «первый по
 * порядку» терминал империи, откуда его ещё надо везти межкомнатной отправкой.
 *
 * Источник — LAB_PLAN (единственный источник правды по комнатам и рецептам);
 * Memory используется только чтобы понять, какая из двух реакций тройки активна
 * сейчас. Если проекции ещё нет (Global Reset), ресурс считается расходуемым,
 * когда он есть хотя бы в одном рецепте тройки.
 * @param {string} resourceType
 * @returns {string[]}
 */
function consumerRooms(resourceType) {
  const rooms = [];
  const seen = /** @type {Object<string, boolean>} */ ({});

  const add = (name) => {
    if (!seen[name]) {
      seen[name] = true;
      rooms.push(name);
    }
  };

  // Список комнат-троек собирается ОДИН раз из плана, поэтому набор ключей не
  // меняется во время обхода (в тестах план подменяется).
  const planRooms = Object.keys(LAB_PLAN);

  for (let r = 0; r < planRooms.length; r++) {
    const roomName = planRooms[r];
    // Комната, которой план больше не соответствует (её убрали из LAB_PLAN),
    // не считается и по Memory: Memory — это рантайм-проекция плана, и
    // расхождение означает именно несоответствие, а не «второй источник».
    if (!LAB_PLAN[roomName]) continue;
    const tripleConfigs = [];
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const triple = LAB_PLAN[roomName][SLOT_KEYS[i]];
      if (!triple) continue;
      const mem = Memory.rooms && Memory.rooms[roomName];
      tripleConfigs.push(mem && mem[SLOT_KEYS[i]] ? mem[SLOT_KEYS[i]] : triple);
    }

    for (let i = 0; i < tripleConfigs.length; i++) {
      const config = tripleConfigs[i];
      // Активный рецепт берётся, когда он известен (Memory синхронизирована);
      // иначе (Global Reset, конфиг без проекции) ресурс считается
      // расходуемым, если он есть хотя бы в одном рецепте тройки.
      const items = config.active
        ? [config.active === "B" ? config.recipeB : config.recipeA]
        : [config.recipeA, config.recipeB];
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        if (!item) continue;
        if (item.reagent1 === resourceType || item.reagent2 === resourceType) {
          add(roomName);
          break;
        }
      }
    }
  }

  return rooms;
}

/**
 * ── РЕАГЕНТЫ ПЛАНА (источник для автозакупки рынка) ──────────────────────
 *
 * Возвращает КАЖДЫЙ реагент, который расходуют тройки LAB_PLAN, и плановый
 * резерв по нему: сумму LOW тех рецептов, которые его тратят. Величина
 * отвечает на вопрос «сколько реагента должно лежать в империи, чтобы тройки
 * плана не стояли» — именно по ней market.manager решает, покупать ли
 * (запас империи < резерва) и до какого уровня добирать.
 *
 * Считается из ДАННЫХ плана, а не из списка в market.manager: добавили тройку
 * или рецепт в LAB_PLAN — рынок начнёт страховать и его реагент, без правки
 * рынка. Активный слот при этом не важен: оба рецепта тройки расходуют свои
 * реагенты, а переключение A/B — решение плана, а не рынка.
 *
 * Вклад одной тройки в резерв реагента — МАКСИМУМ из LOW её рецептов, где
 * реагент участвует, а не сумма: тройка варит ровно один слот за раз, и
 * складывать LOW двух слотов по одному ресурсу было бы завышением.
 *
 * Кэш — на тик (heap, как у priorityCompounds): план статичен, а сумма
 * переиспользуется и решением о закупке, и диагностикой.
 *
 * @returns {Object<string, {low: number, rooms: string[]}>}
 */
function requiredReagents() {
  let cached = global._labRequiredReagents;
  if (cached && cached.tick === Game.time) return cached.map;

  /** @type {Object<string, {low: number, rooms: string[]}>} */
  const map = {};
  for (const roomName in LAB_PLAN) {
    const plan = LAB_PLAN[roomName];
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const triple = plan[SLOT_KEYS[i]];
      if (!triple) continue;

      // Резерв по реагенту внутри ОДНОЙ тройки (максимум, см. шапку функции).
      /** @type {Object<string, number>} */
      const perTriple = {};
      const pairs = [
        [
          triple.recipeA,
          typeof triple.lowA === "number" ? triple.lowA : 0,
        ],
        [
          triple.recipeB,
          typeof triple.lowB === "number" ? triple.lowB : 0,
        ],
      ];
      for (let j = 0; j < pairs.length; j++) {
        const recipe = pairs[j][0];
        const low = pairs[j][1];
        if (!recipe) continue;
        const add = (/** @type {string} */ res) => {
          if (!res) return;
          if (!(res in perTriple) || low > perTriple[res]) perTriple[res] = low;
        };
        add(recipe.reagent1);
        add(recipe.reagent2);
      }

      for (const res in perTriple) {
        if (!map[res]) map[res] = { low: 0, rooms: [] };
        map[res].low += perTriple[res];
        if (map[res].rooms.indexOf(roomName) === -1)
          map[res].rooms.push(roomName);
      }
    }
  }

  global._labRequiredReagents = { tick: Game.time, map };
  return map;
}

module.exports = {
  SLOT_KEYS,
  IDLE_RESUME_TICKS,
  sync,
  selectRecipe,
  stockOf,
  planUpToDate,
  labById,
  ensureBoostLab,
  ensureTriples,
  reactionReady,
  reactionAmount,
  isFinalHub,
  priorityLevel,
  priorityCompounds,
  consumerRooms,
  requiredReagents,
};
