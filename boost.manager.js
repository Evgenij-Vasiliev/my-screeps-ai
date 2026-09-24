/**
 * ===================================================
 * BOOST.MANAGER.JS — бустирование крипов в boost-lab комнаты
 * ===================================================
 * Реализация docs/LAB_BOOST_PRODUCTION_PLAN.md, разделы 12–14.
 *
 * МЕСТО В АРХИТЕКТУРЕ. Отдельного планировщика нет: менеджер вызывается из уже
 * существующего цикла по крипам комнаты (room.manager.runCreepLogic) сразу
 * после роли крипа. Если крипу нужен буст, действия роли на этот тик
 * подавляются — ровно на время процедуры, чтобы worker.runner не увёл крипа в
 * Task посреди бустирования.
 *
 * МЕХАНИКА. Крип сам приезжает к буст-лабе и вызывает lab.boostCreep(creep, N) —
 * так же, как labWorker приезжает за реагентом. Тип буста движок берёт ИЗ
 * ЛАБЫ (lab.mineralType), поэтому одного вызова на много частей не бывает:
 * лаборатория держит один минерал за раз. Буст-лаба НЕ производит реагенты:
 * готовый буст лежит в ней или в storage/terminal комнаты (доставку обеспечивает
 * существующий terminalNetwork — boostLab включён в labWorker.getConfigs, поэтому
 * его ресурсы попадают в заявки сети и защищены от продажи рынком).
 *
 * ПРОВЕРЕНО НА ЖИВОМ ДВИЖКЕ (shard3), на что опирается код ниже:
 *   - метода creep.boost НЕТ, есть только lab.boostCreep(creep, bodyPartsCount);
 *   - свойства creep.boosts НЕТ (typeof === "undefined" даже у бустнутого крипа) —
 *     уже выданные бусты считаются по creep.body[].boost (см. rowSatisfied);
 *   - withdraw(…, amount) отвечает ERR_NOT_ENOUGH_RESOURCES и НЕ выдаёт частично,
 *     если amount больше ЗАПАСА источника (клампить и по store, и по free);
 *   - Lab_LAB_BOOST_MINERAL = 30 на часть тела, LAB_BOOST_ENERGY = 20 из лабы.
 *
 * ДВЕ ФАЗЫ (протокол в памяти крипа, без новых задач в Task System):
 *   1. creep.memory.boostLab = {labId, resource, parts, sourceId} — «обеспечить
 *      запас в лабе»: при необходимости крип сам везёт буст из storage/terminal.
 *   2. creep.memory.boostTask = {labId, resource, parts} — «бустить»: крип идёт
 *      к лабе и вызывает lab.boostCreep(). Кончился ресурс — снова фаза 1.
 *
 * ПОЛИТИКА (LAB_BOOST.BOOST_POLICY в constants.js): XKH2O → CARRY первым,
 * XZHO2 → MOVE вторым для обычных комнат; XUHO2 (harvest 7, НЕ XUH2O — тот даёт
 * attack 4) + XZHO2 для remote-майнеров; XKH2O + XZHO2 для remote-хайлеров.
 * Боевые бусты (XKHO2/XLHO2) мирным крипам не выдаются вовсе.
 *
 * CPU: один проход по политике роли (2–3 записи) и одно чтение store буст-лабы
 * на крипа с бустом. Крип без политики выходит на первой проверке. Новых циклов
 * по комнатам/империи, room.find и россыпи getObjectById нет: объект буст-лабы
 * берётся из уже собранного roomState.labs (scanner-кэш структур комнаты).
 * ===================================================
 */

const { LAB_BOOST } = require("./constants");

// Индекс буст-лабы в roomState.labs: scanner собирает labIds через
// room.find(FIND_MY_STRUCTURES) в стабильном порядке неподвижных структур,
// поэтому один и тот же индекс указывает на ту же лабу. Кэшируется в heap и
// пересобирается, только если по индексу оказалась другая лаба.
const LAB_INDEX_MISS = -1;

// СКОЛЬКО БУСТА УХОДИТ НА ОДНУ ЧАСТЬ ТЕЛА — движковая величина
// LAB_BOOST_MINERAL = 30 (проверено на живом shard3: LAB_BOOST_MINERAL = 30,
// LAB_BOOST_ENERGY = 20, LAB_REACTION_AMOUNT = 5).
//
// В ПРЕЖНЕЙ РЕДАКЦИИ ЗДЕСЬ СТОЯЛО 100 с обоснованием «STORE_CAPACITY(3000) /
// LAB_BOOST_AMOUNT(30) = 100 единиц буста на одну часть тела». Это смешение двух
// разных величин: 3000/30 = 100 ЧАСТЕЙ можно бустить из полной лаборатории, а
// буста на одну часть уходит 30. Из-за этого оценка расхода резерва, объём
// списания из storage/терминала в буст-лабу (runDelivery) и порог выдачи
// (runBoost: `amount < cap * BOOST_PER_PART`) были завышены в 3.33 раза.
const BOOST_PER_PART = 30;

// СКОЛЬКО ЭНЕРГИИ ЛАБА ПЛАТИТ ЗА ОДНУ ЧАСТЬ — движковая величина
// LAB_BOOST_ENERGY = 20 (та же, что в lab.worker.js рядом с ENERGY_TARGET).
// Нужна здесь потому, что оплатить часть можно ТОЛЬКО парой «минерал + энергия»:
// лаборатория с полным минералом и нулевой энергией не бустит НИЧЕГО, и раньше
// именно этот случай замораживал роль крипа (см. runBoost).
const BOOST_ENERGY_PER_PART = 20;

/**
 * Таблица «ресурс буста → тип части тела», собранная из движковой BOOSTS
 * (BOOSTS[partType][resource]). Нужна, чтобы посчитать, сколько частей типа
 * вообще есть у крипа, не заводя второй список соответствий в конфиге.
 * @returns {Object<string, string>}
 */
function resourceToPart() {
  const cached = global._boostPartOf;
  if (cached) return cached;

  const map = /** @type {Object<string, string>} */ ({});
  for (const partType in BOOSTS) {
    const resources = BOOSTS[partType];
    for (const resource in resources) map[resource] = partType;
  }
  global._boostPartOf = map;
  return map;
}

/**
 * Heap-состояние: индекс буст-лабы в labs комнаты. Объекты лаб не храним —
 * они пересобираются scanner'ом каждый тик.
 * @returns {Object}
 */
function heap() {
  if (!global._boostManager) {
    global._boostManager = { labIdx: {} };
  }
  return global._boostManager;
}

/**
 * Метка для контроля результата на живом шарде: Memory.__boostMetric[room].
 * Объект создаётся при первой же записи (иначе диагностика была бы «немой» на
 * свежем шарде), а значение переписывается только при смене — поэтому Memory
 * не «пачкается» каждый тик.
 * @param {string} roomName
 * @param {string} tag
 */
function mark(roomName, tag) {
  const metric = Memory.__boostMetric || (Memory.__boostMetric = {});
  if (metric[roomName] === tag) return;
  metric[roomName] = tag;
}

/**
 * Список буст-ресурсов, которые империя вообще выдаёт, — производная
 * LAB_BOOST.BOOST_POLICY (порядок первого появления). Считается на месте:
 * политика — это 7 ролей по 1–2 строки, дешевле, чем держать вторую копию.
 * @returns {string[]}
 */
function policyBoostResources() {
  const list = [];
  const seen = /** @type {Object<string, boolean>} */ ({});
  const policy = LAB_BOOST.BOOST_POLICY || {};
  for (const role in policy) {
    const rows = policy[role];
    for (let i = 0; i < rows.length; i++) {
      const resource = rows[i].resource;
      if (resource && !seen[resource]) {
        seen[resource] = true;
        list.push(resource);
      }
    }
  }
  return list;
}

/**
 * Совпадают ли два списка ресурсов (по составу и порядку).
 * @param {*} a
 * @param {string[]} b
 * @returns {boolean}
 */
function sameList(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Конфиг буст-лабы комнаты: Memory.rooms[].boostLab (ID) + список бустов,
 * которые империя вообще выдаёт (LAB_BOOST.BOOST_POLICY).
 * @param {Room} room
 * @returns {{labId: string, boost: string[]}|null}
 */
function getConfig(room) {
  const mem = room.memory;
  if (!mem) return null;

  let labId = mem.boostLab || LAB_BOOST.BOOST_LAB[room.name];
  if (!labId) return null;

  let config = mem.boostConfig;
  if (!config) {
    config = { labId, boost: policyBoostResources() };
    // Единственная запись конфига: нужна, чтобы terminalNetwork/рынок видели
    // ресурсы буст-лабы (они читают Memory.rooms[].labs* через lab.worker).
    mem.boostConfig = config;
  } else if (config.labId !== labId) {
    config.labId = labId;
  }

  // СПИСОК БУСТОВ ОБЯЗАН СЛЕДОВАТЬ ЗА ПОЛИТИКОЙ. Прежняя версия строила список
  // один раз и больше его не трогала, поэтому в живом shard3 в boostConfig
  // висел УСТАРЕВШИЙ набор (XUH2O вместо XUHO2): список защищает ресурсы от
  // продажи (market.manager.protectedResources) и от вывоза сетью, и устаревшая
  // запись означала защиту «вчерашнего» ресурса и отсутствие защиты текущего.
  // Сравнение массивов дешевле записи в Memory (та помечает её «грязной» и
  // заставляет движок сериализовать её целиком), поэтому пишем только при
  // реальном изменении.
  const actual = policyBoostResources();
  if (!sameList(config.boost, actual)) {
    config.boost = actual;
  }

  return /** @type {{labId: string, boost: string[]}} */ (config);
}

/**
 * Объект буст-лабы из уже собранного roomState.labs (без Game.getObjectById).
 * @param {Object} roomState
 * @param {string} labId
 * @returns {StructureLab|null}
 */
function findBoostLab(roomState, labId) {
  const labs = roomState.labs;
  if (!labs || labs.length === 0) return null;

  const h = heap();
  const cached = h.labIdx[roomState.roomName];
  if (cached !== undefined && cached !== LAB_INDEX_MISS) {
    const lab = labs[cached];
    if (lab && lab.id === labId) return lab;
  }

  for (let i = 0; i < labs.length; i++) {
    if (labs[i] && labs[i].id === labId) {
      h.labIdx[roomState.roomName] = i;
      return labs[i];
    }
  }

  h.labIdx[roomState.roomName] = LAB_INDEX_MISS;
  return null;
}

/**
 * Сколько единиц ресурса уже лежит в буст-лабе.
 * @param {StructureLab} lab
 * @param {string} resource
 * @returns {number}
 */
function labAmount(lab, resource) {
  return lab && lab.store ? lab.store[resource] || 0 : 0;
}

/**
 * Запас ресурса, доступный для бустов: буст-лаба + storage + terminal + РЕАКТОРЫ
 * троек комнаты — СУММОЙ, а не «первым непустым источником».
 *
 * ПОЧЕМУ СУММА. Прежняя редакция возвращала запас ПЕРВОГО непустого источника
 * (лаба → storage → terminal → реакторы) и на этом останавливалась, хотя и
 * docstring, и комментарий MIN_STOCK в constants.js обещали сумму. Живой shard3:
 * в E35S37 лежало 125 XKH2O в терминале и 160 + 170 в реакторах троек (330), но
 * проверка видела только терминал — 125 < minStock(150) — и комната показывала
 * «no stock», хотя суммарно ресурса было 455. То же с XZHO2: 140 в терминале при
 * пороге 150. Раздробленный запас не складывался НИКОГДА, и буст не выдавался.
 *
 * Почему реакторы. Финальная X-тройка комнаты варит буст «для себя», и продукт
 * лежит в её реакторе до порога выгрузки (LAB_WORKER.PRODUCT_UNLOAD_AT = 250):
 * lab.worker уносит его в терминал, только когда накопится 250 единиц. При темпе
 * 5 единиц за 60 тиков это ~3000 тиков, в течение которых готовый буст лежит без
 * дела, а крипы комнаты видят «no stock». Реактор — такой же склад комнаты,
 * просто «на выходе» реакции, поэтому запас считается и по нему, а крип забирает
 * буст прямо оттуда (creep.withdraw работает с лабораторией так же, как с
 * терминалом).
 *
 * CPU. Обход складов и реакторов — плата за правильность, но она не платится в
 * обычном случае: `limit` (порог minStock) обрывает подсчёт, как только сумма его
 * достигла, поэтому «буст довезён сетью» и «ресурс уже в лабе» стоят одного
 * чтения store, как и раньше. Полный обход бывает только там, где ответ «запаса
 * нет» и раньше был неверным.
 * @param {Object} roomState
 * @param {Room} room
 * @param {StructureLab} lab буст-лаба комнаты
 * @param {string} resource
 * @param {boolean} includeStores учитывать ли склады и реакторы комнаты
 * @param {number} [limit] порог, при достижении которого обход прекращается
 *   (0/undefined — считать всё, как для диагностики)
 * @returns {number}
 */
function available(roomState, room, lab, resource, includeStores, limit) {
  let total = labAmount(lab, resource);
  if (!includeStores) return total;

  const need = typeof limit === "number" && limit > 0 ? limit : 0;
  if (need > 0 && total >= need) return total;

  const storage = room.storage;
  if (storage) {
    total += storage.store[resource] || 0;
    if (need > 0 && total >= need) return total;
  }

  const terminal = room.terminal;
  if (terminal) {
    total += terminal.store[resource] || 0;
    if (need > 0 && total >= need) return total;
  }

  return (
    total + labsHolding(roomState, lab, resource, need > 0 ? need - total : 0)
  );
}

/**
 * Сколько ресурса лежит в реакторах/лабораториях троек комнаты (кроме буст-лабы).
 * Обход идёт по уже собранному roomState.labs — новых room.find и
 * Game.getObjectById нет.
 * @param {Object} roomState
 * @param {StructureLab} boostLab
 * @param {string} resource
 * @param {number} limit прекратить обход, когда набрано столько (0 — без предела)
 * @returns {number}
 */
function labsHolding(roomState, boostLab, resource, limit) {
  const labs = roomState.labs;
  if (!labs || labs.length === 0) return 0;

  let total = 0;
  for (let i = 0; i < labs.length; i++) {
    const candidate = labs[i];
    if (!candidate || (boostLab && candidate.id === boostLab.id)) continue;
    total += candidate.store[resource] || 0;
    if (limit > 0 && total >= limit) break;
  }
  return total;
}

/**
 * Где в комнате лежит ресурс (кроме буст-лабы): storage, terminal либо реактор
 * тройки (см. комментарий к available).
 * @param {Object} roomState
 * @param {Room} room
 * @param {string} resource
 * @param {string} [skipLabId] id буст-лабы (получателя) — источником быть не может
 * @returns {StructureStorage|StructureTerminal|StructureLab|null}
 */
function storeWith(roomState, room, resource, skipLabId) {
  const storage = room.storage;
  if (storage && (storage.store[resource] || 0) > 0) return storage;
  const terminal = room.terminal;
  if (terminal && (terminal.store[resource] || 0) > 0) return terminal;

  const labs = roomState.labs;
  if (!labs || labs.length === 0) return null;
  for (let i = 0; i < labs.length; i++) {
    const candidate = labs[i];
    if (!candidate) continue;
    // Буст-лаба — ПОЛУЧАТЕЛЬ, а не источник: без этого исключения доставка
    // «везла» буст из лабы в неё же и не могла завершиться.
    if (skipLabId && candidate.id === skipLabId) continue;
    if ((candidate.store[resource] || 0) > 0) return candidate;
  }
  return null;
}

/**
 * Максимальное число частей типа, подходящего под ресурс буста.
 * @param {Object} creep
 * @param {string} resource
 * @returns {number}
 */
function partsOfType(creep, resource) {
  const partType = resourceToPart()[resource];
  if (!partType) return 0;

  let total = 0;
  for (let i = 0; i < creep.body.length; i++) {
    if (creep.body[i].type === partType) total++;
  }
  return total;
}

/**
 * Сколько частей тела уже несут этот буст.
 * @param {Object} creep
 * @param {string} resource
 * @returns {number}
 */
function boostedParts(creep, resource) {
  let total = 0;
  for (let i = 0; i < creep.body.length; i++) {
    if (creep.body[i].boost === resource) total++;
  }
  return total;
}

/**
 * Квота строки политики выполнена: бустом закрыто ровно столько частей, сколько
 * строка разрешает (row.parts), но не больше, чем частей этого типа у крипа.
 *
 * Почему не «есть хотя бы одна бустнутая часть». Выдача буста бывает ЧАСТИЧНОЙ
 * (движок отвечает ERR_NOT_ENOUGH_RESOURCES, когда в лабе кончился ресурс:
 * boost.manager.runBoost помечает это как "partial <resource>"), и Worker с 3 из
 * 10 бустнутых CARRY обязан дотянуть остаток следующей попыткой — «хотя бы одна
 * часть» навсегда оставила бы его недо-бустнутым.
 * @param {Object} creep
 * @param {Object} row
 * @returns {boolean}
 */
function rowSatisfied(creep, row) {
  if (!row || !row.resource) return true;
  const have = boostedParts(creep, row.resource);
  if (have === 0) return false;
  return have >= Math.min(row.parts, partsOfType(creep, row.resource));
}

/**
 * Первая подходящая запись политики: квота строки ещё не закрыта бустом
 * (rowSatisfied), ресурс есть в допустимом месте, и его СУММАРНЫЙ запас по
 * комнате не ниже minStock.
 * @param {Object} roomState
 * @param {Object} creep
 * @param {Array} rows
 * @param {Room} room
 * @param {StructureLab} lab
 * @param {boolean} inHome
 * @returns {Object|null}
 */
function selectBoost(roomState, creep, rows, room, lab, inHome) {
  // СНАЧАЛА — ТО, ЧТО УЖЕ ЛЕЖИТ В ЛАБЕ. Лаборатория держит энергию и ОДИН тип
  // минерала за раз, а тип буста движок берёт ИЗ НЕЁ (creep.boost(lab, n)).
  // Поэтому залитый в лабу буст обязан быть израсходован ПЕРВЫМ: иначе остаток
  // блокирует доставку другого буста (transfer → ERR_INVALID_ARGS) и процедура
  // зацикливается. Именно это и произошло на живом shard3: в буст-лабе лежал
  // XZHO2 240, а крип бесконечно возил XKH2O и не бустился ни разу.
  const labType = lab.mineralType;
  if (
    typeof labType === "string" &&
    labType &&
    labAmount(lab, labType) >= BOOST_PER_PART
  ) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.resource !== labType) continue;
      if (rowSatisfied(creep, row)) continue;
      if (row.remote && !inHome) continue;
      return row;
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.resource) continue;

    // УЖЕ БУСТНУТЫЕ ЧАСТИ СЧИТАЕМ ПО ТЕЛУ, А НЕ ПО creep.boosts.
    // На живом shard3 (проверено запросом из консоли) свойства creep.boosts в
    // движке НЕТ — typeof creep.boosts === "undefined" даже у крипа с четырьмя
    // бустнутыми частями. Прежняя проверка `creep.boosts && ...` была всегда
    // ложной, поэтому полностью бустнутый крип каждый тик заново выбирал свою же
    // строку политики, получал cap = 0 и выходил — без троттлинга boostWait, то
    // есть с полным перебором политики и чтением лабы каждый тик (живой
    // linkWorker в E35S39: boostWait = 0 при 4/4 частях XKH2O).
    if (rowSatisfied(creep, row)) continue;
    if (row.remote && !inHome) continue;

    const stock = available(
      roomState,
      room,
      lab,
      row.resource,
      row.from === "room",
      row.minStock,
    );
    if (stock < row.minStock) continue;
    return row;
  }
  return null;
}

/**
 * Все строки политики роли закрыты бустом (см. rowSatisfied). Нужно, чтобы
 * отличать «в комнате нет запаса» от «бустить больше нечего»: и то и другое
 * раньше помечалось как "no stock" и вводило в заблуждение при разборе живого
 * шарда.
 * @param {Object} creep
 * @param {Array} rows
 * @returns {boolean}
 */
function policySatisfied(creep, rows) {
  for (let i = 0; i < rows.length; i++) {
    if (!rowSatisfied(creep, rows[i])) return false;
  }
  return true;
}

/**
 * Фаза «обеспечить запас в буст-лабе»: при необходимости крип сам везёт буст
 * из склада комнаты (storage/terminal/реактор тройки).
 * @param {Object} roomState
 * @param {Object} creep
 * @param {Room} room
 * @param {StructureLab} lab
 * @param {Object} row
 * @returns {boolean} true — крип занят доставкой буста в этом тике
 */
function runDelivery(roomState, creep, room, lab, row) {
  let task = creep.memory.boostLab;
  if (task && task.resource !== row.resource) task = undefined;

  if (!task) {
    const source = storeWith(roomState, room, row.resource, lab.id);
    if (!source) return false;
    task = creep.memory.boostLab = {
      labId: lab.id,
      resource: row.resource,
      parts: row.parts,
      sourceId: source.id,
    };
  }

  if (creep.store.getUsedCapacity(row.resource) === 0) {
    const source =
      Game.getObjectById(task.sourceId) ||
      storeWith(roomState, room, row.resource, lab.id);
    if (!source) {
      delete creep.memory.boostLab;
      return false;
    }
    if (!creep.pos.isNearTo(source)) {
      creep.travelTo(source);
      return true;
    }
    // ОБЪЁМ СПИСАНИЯ ОГРАНИЧЕН СВОБОДНЫМ РЮКЗАКОМ **И** ЗАПАСОМ ИСТОЧНИКА.
    // Движок отказывает withdraw(…, amount) с ERR_FULL, если запрошено больше,
    // чем крип может унести: просьба «300 единиц» на крипа, который уже везёт
    // 300 энергии (обычное состояние Worker'а — он и живёт переноской),
    // возвращала ошибку, память процедуры стиралась, и буст не выдавался
    // НИКОГДА. Живой shard3: реактор хаба стоял с 220 единицами XKH2O,
    // Memory.__boostMetric оставался "no stock", а крип с грузом не получал ни
    // одной бустнутой части.
    //
    // Вторая граница — ЗАПАС ИСТОЧНИКА — закрыта здесь после живого дефекта:
    // в E36S38 в терминале лежало 15 XKH2O, в буст-лабе 30 (хватало на часть), и
    // крип запрашивал 120 (4 части × 30) у терминала с 15. Движок отвечает
    // ERR_NOT_ENOUGH_RESOURCES и НЕ выдаёт частично: память boostLab стиралась,
    // попытка начиналась заново, крип shuttle'ил «терминал ↔ буст-лаба», пока
    // процедуру не бросал MAX_BUSY_TICKS (в метрике — "boost abandoned"), а 30
    // единиц в самой лабе не использовались вовсе. Соседний рабочий модуль
    // lab.worker.js так и делает: Math.min(нужно, src.store[res], free).
    const free = creep.store.getFreeCapacity(row.resource);
    const stock = source.store[row.resource] || 0;
    const amount = Math.min(row.parts * BOOST_PER_PART, free, stock);
    if (amount <= 0) return false;

    const result = creep.withdraw(source, row.resource, amount);
    if (result === OK) return true;
    delete creep.memory.boostLab;
    return false;
  }

  if (!creep.pos.isNearTo(lab)) {
    creep.travelTo(lab);
    return true;
  }

  const result = creep.transfer(lab, row.resource);
  if (result === OK) {
    delete creep.memory.boostLab;
    return true;
  }

  if (result !== ERR_NOT_IN_RANGE) {
    // Лаба занята ДРУГИМ минералом (ERR_INVALID_ARGS: она держит один тип за
    // раз) или полна. Возвращать true нельзя — крип зацикливался бы, вечно
    // возя буст, который лаба не примет (живой shard3: крип с XKH2O крутился у
    // лабы с XZHO2 и не бустился). Отпускаем процедуру: следующий выбор
    // (selectBoost) пойдёт по тому бусту, который в лабе уже лежит.
    //
    // И ВЫБРАСЫВАЕМ ГРУЗ. Иначе крип остаётся с бустом в рюкзаке навсегда, а
    // рюкзак у ролей теперь маленький: у miner'а 3–4 CARRY, то есть комплект
    // XUHO2 (150) занимал ВЕСЬ объём — майнер переставал добывать, линки
    // переставали наполняться, спавны пустели (живая авария).
    dropCarriedBoost(creep, row.resource);
    delete creep.memory.boostLab;
    delete creep.memory.boostTask;
    delete creep.memory.boostSince;
    creep.memory.boostWait = Game.time + LAB_BOOST.ABANDON_RETRY;
    return false;
  }

  return true;
}

/**
 * Сбросить из рюкзака буст, который лаба принять не может.
 *
 * ЗАЧЕМ. Лаборатория держит один минерал за раз. Если крип уже взял буст, а в
 * лабе лежит ДРУГОЙ минерал (обычная картина: worker'ы держат в лабе XKH2O, а
 * miner'у нужен XUHO2), движок отклоняет transfer (ERR_INVALID_ARGS). Раньше
 * крип терял память процедуры и оставался С ЭТИМ ГРУЗОМ В РЮКЗАКЕ навсегда:
 * рюкзак больше ничего не принимал, роль вставала целиком (авария: майнеры не
 * добывали, linkWorker'ы не разгружали линки, спавны и расширения пустели).
 * Потеря 150 единиц минерала дешевле полностью выключенной роли.
 * @param {Object} creep
 * @param {string} resource
 * @returns {boolean} был ли сброс
 */
function dropCarriedBoost(creep, resource) {
  if (!resource || !creep.store || typeof creep.drop !== "function") return false;
  if (creep.store.getUsedCapacity(resource) <= 0) return false;
  creep.drop(resource);
  return true;
}

/**
 * Фаза «бустить»: крип у буст-лабы вызывает creep.boost().
 * @param {Object} creep
 * @param {Room} room
 * @param {StructureLab} lab
 * @param {Object} row запись политики
 * @param {number} cap сколько частей разрешено бустить
 * @returns {boolean} true — действия крипа подавлены этим тиком
 */
function runBoost(roomState, creep, room, lab, row, cap) {
  const task = creep.memory.boostTask;
  if (task && (task.resource !== row.resource || task.labId !== lab.id)) {
    delete creep.memory.boostTask;
    return true;
  }

  if (!creep.memory.boostTask) {
    creep.memory.boostTask = {
      labId: lab.id,
      resource: row.resource,
      parts: row.parts,
    };
  }

  const amount = labAmount(lab, row.resource);
  if (amount < cap * BOOST_PER_PART) {
    // ЛАБА ЗАНЯТА ДРУГИМ МИНЕРАЛОМ — НЕ НАЧИНАЕМ РЕЙС ВООБЩЕ.
    // Это и была причина живой аварии: miner с политикой XUHO2 видел, что в
    // лабе лежит XKH2O (worker'ы бустятся первыми), но всё равно ехал за своим
    // бустом, привозил его и получал ERR_INVALID_ARGS — а груз оставался в
    // рюкзаке. Отдавать его было некуда: трансфер отклонён, память процедуры
    // стёрта, и роль (добыча у miner'а, разгрузка линков у linkWorker'а)
    // вставала целиком.
    const labType = lab.mineralType;
    if (
      typeof labType === "string" &&
      labType &&
      labType !== row.resource &&
      labAmount(lab, labType) > 0
    ) {
      dropCarriedBoost(creep, row.resource);
      delete creep.memory.boostTask;
      delete creep.memory.boostLab;
      delete creep.memory.boostSince;
      // Короткая пауза, а не ABANDON_RETRY: лаба освободится, как только
      // worker'ы выберут свой XKH2O, и ждать 150 тиков незачем.
      creep.memory.boostWait = Game.time + LAB_BOOST.RETRY_INTERVAL;
      mark(room.name, "лаба занята " + labType);
      return false;
    }

    // Ресурса в лабе не хватает: пробуем обеспечить его сами (роли с
    // from:"room"), иначе отпускаем крипа — сеть/лабораторный воркер довезут.
    if (row.from === "room" && runDelivery(roomState, creep, room, lab, row))
      return true;
    if (amount === 0) {
      delete creep.memory.boostTask;
      return false;
    }
  }

  if (!creep.pos.isNearTo(lab)) {
    creep.travelTo(lab);
    return true;
  }

  // ВЫЗОВ ДВИЖКА: lab.boostCreep(creep, bodyPartsCount).
  // Тип буста движок берёт ИЗ ЛАБЫ (StructureLab.mineralType; лаборатория держит
  // энергию и ОДИН тип минерала за раз), ресурс в вызов не передаётся вовсе.
  // Проверено на живом shard3: метода creep.boost в движке НЕТ
  // («creep.boost is not a function»), а прежний вызов
  // creep.boost(lab, row.resource, cap) не мог работать в принципе — на месте
  // количества частей оказывалась строка "XKH2O". Итог: ветка default ниже молча
  // стирала boostTask, и НИ ОДИН крип за всю историю шарда не получил ни одной
  // бустнутой части (живой shard3: буст-лаба с XZHO2 240 и энергией 1000, у
  // крипов boostTask = XZHO2, Memory.__boostMetric = "no stock").
  //
  // Перед вызовом обязательна проверка типа: если в лабе лежит ДРУГОЙ буст
  // (остаток прошлой выдачи), boostCreep применяет ИМЕННО ЕГО — поэтому политика
  // согласуется с содержимым лабы (selectBoost отдаёт первым тот ресурс, который
  // уже залит), а остаток меньше 30 единиц убирает labWorker.
  const result = lab.boostCreep(creep, cap);
  switch (result) {
    case OK:
      delete creep.memory.boostTask;
      delete creep.memory.boostLab;
      delete creep.memory.boostSince;
      mark(room.name, "boosted " + row.resource);
      return true;
    case ERR_NOT_ENOUGH_RESOURCES:
      // Ресурса хватило на часть частей — буст уже применён, крип может
      // работать; остаток добустится, когда запас вернётся в лабу.
      delete creep.memory.boostTask;
      delete creep.memory.boostSince;
      mark(room.name, "partial " + row.resource);
      return true;
    case ERR_TIRED:
      // Кулдаун буст-лабы (10 тиков) — просто ждём у лабы.
      return true;
    case ERR_NOT_IN_RANGE:
      creep.travelTo(lab);
      return true;
    case ERR_INVALID_ARGS:
      // Либо на крипе нет частей под этот буст (например, смена тела), либо в
      // лабе лежит минерал другого типа: тогда процедуру НЕ стираем — остаток
      // уберёт labWorker, и следующая попытка пройдёт.
      if (lab.mineralType && lab.mineralType !== row.resource) {
        mark(room.name, "ждём очистки лабы");
        return true;
      }
      delete creep.memory.boostTask;
      delete creep.memory.boostLab;
      return true;
    case ERR_FULL: // все части этого типа уже бустнуты
    case ERR_NOT_OWNER:
    default:
      delete creep.memory.boostTask;
      return true;
  }
}

/**
 * Точка входа: вызывается на каждого крипа комнаты ПОСЛЕ его роли.
 * @param {Object} roomState
 * @param {Creep} creep
 * @returns {boolean} true — действия крипа в этом тике уже выполнены (бустинг)
 */
function run(roomState, creep) {
  if (!LAB_BOOST.ENABLED) return false;
  if (!creep || !creep.my || creep.spawning) return false;
  if (Memory[LAB_BOOST.OFF_FLAG]) return false;

  const creepMemory = creep.memory;
  const policy = LAB_BOOST.BOOST_POLICY[creepMemory.role];
  if (!policy || policy.length === 0) return false;

  const room = roomState.room;
  if (!room) return false;

  // ЭНЕРГИЯ КОМНАТЫ ВАЖНЕЕ БУСТА. Пока спавны/расширения не набраны хотя бы
  // наполовину, бусты в комнате не начинаются вовсе: Worker обязан долить
  // спавны, а не «ждать XKH2O» (живой shard3: E35S37 осталась без энергии именно
  // так — роль Worker'а подавлялась процедурой буста, и fillSpawnsExtensions не
  // выполнялся). Проверка стоит ДО любой работы с бустом и стоит одного чтения
  // кэшированного движком поля комнаты.
  if (
    typeof room.energyAvailable === "number" &&
    typeof room.energyCapacityAvailable === "number" &&
    room.energyCapacityAvailable > 0 &&
    room.energyAvailable <
      room.energyCapacityAvailable * LAB_BOOST.ENERGY_PAUSE_RATIO
  ) {
    // Заодно снимаем «зависшую» процедуру: в комнате без энергии она всё равно
    // не может быть доведена, а её память (boostTask/boostLab) заставляла бы
    // считать крипа занятым бустом. Запись делается один раз на процедуру.
    if (
      creepMemory.boostTask ||
      creepMemory.boostLab ||
      typeof creepMemory.boostSince === "number"
    ) {
      // В комнате без энергии процедура не доводится — груз буста из рюкзака
      // тоже снимаем, иначе крип останется с ним и роль не восстановится.
      dropCarriedBoost(
        creep,
        (creepMemory.boostLab && creepMemory.boostLab.resource) ||
          (creepMemory.boostTask && creepMemory.boostTask.resource),
      );
      delete creepMemory.boostTask;
      delete creepMemory.boostLab;
      delete creepMemory.boostSince;
    }
    return false;
  }

  // Незавершённая процедура буста: держим управление до конца, чтобы
  // worker.runner не увёл крипа в Task посреди бустирования.
  const pending =
    creepMemory.boostTask ||
    (creepMemory.boostLab && creepMemory.boostLab.labId);

  if (pending) {
    // ЖЁСТКИЙ ЛИМИТ ВРЕМЕНИ НА ПРОЦЕДРУ. Буст оппортунистический: даже начатая
    // доставка обязана закончиться (успехом, частичной выдачей или отказом)
    // внутри MAX_BUSY_TICKS тиков, иначе роль возвращается к работе, а буст
    // откладывается на ABANDON_RETRY. Без этого лимита цикл «реактор → лаба»
    // мог ходить по кругу бесконечно, и Worker не доливал спавны вообще.
    const since = creepMemory.boostSince;
    if (typeof since !== "number") {
      creepMemory.boostSince = Game.time;
    } else if (Game.time - since > LAB_BOOST.MAX_BUSY_TICKS) {
      // ПРОЦЕДУРА БРОШЕНА ПО ЛИМИТУ ВРЕМЕНИ — ЭТО ГЛАВНЫЙ ИСТОЧНИК «БУСТА В
      // РЮКЗАКЕ»: крип успел забрать минерал, но не успел довезти его до лабы
      // (или лаба его не приняла), память стиралась, а ГРУЗ ОСТАВАЛСЯ. У miner'а
      // рюкзак 3 CARRY = 150, комплект XUHO2 на 5 частей — те же 150: груз
      // занимал 100 % объёма, добыча вставала, линки не наполнялись, спавны
      // пустели. Теперь груз сбрасывается.
      dropCarriedBoost(
        creep,
        (creepMemory.boostLab && creepMemory.boostLab.resource) ||
          (creepMemory.boostTask && creepMemory.boostTask.resource),
      );
      delete creepMemory.boostTask;
      delete creepMemory.boostLab;
      delete creepMemory.boostSince;
      creepMemory.boostWait = Game.time + LAB_BOOST.ABANDON_RETRY;
      mark(room.name, "boost abandoned");
      return false;
    }

    const config = getConfig(room);
    if (!config) return false;
    const lab = findBoostLab(roomState, config.labId);
    if (!lab) return false;

    // ЛАБА ЗАНЯТА ДРУГИМ БУСТОМ — снимаем процедуру сразу, не крутя крипа.
    // Лаборатория держит энергию и ОДИН тип минерала за раз, поэтому
    // незавершённая процедура другого ресурса не может быть доведена: transfer
    // вернёт ERR_INVALID_ARGS, withdraw нужного ресурса из реактора повторится, и
    // крип зациклится (живой shard3: Worker вечно возил XKH2O к лабе с XZHO2 и не
    // получил ни одной бустнутой части). Сняв процедуру, мы отдаём крипа роли, а
    // на следующей попытке selectBoost выберет буст, который в лабе УЖЕ лежит.
    const labType = lab.mineralType;
    const pendingResource =
      (creepMemory.boostTask && creepMemory.boostTask.resource) ||
      (creepMemory.boostLab && creepMemory.boostLab.resource);
    if (
      typeof labType === "string" &&
      labType &&
      pendingResource &&
      pendingResource !== labType &&
      labAmount(lab, labType) > 0
    ) {
      // Груз, который лаба не примет, тоже сбрасываем — иначе крип остаётся с
      // ним в рюкзаке и роль встаёт целиком (см. dropCarriedBoost).
      dropCarriedBoost(creep, pendingResource);
      delete creepMemory.boostTask;
      delete creepMemory.boostLab;
      delete creepMemory.boostSince;
      creepMemory.boostWait = Game.time + LAB_BOOST.ABANDON_RETRY;
      mark(room.name, "лаба занята " + labType);
      return false;
    }

    const inHome = creep.room.name === room.name;
    let row = selectBoost(roomState, creep, policy, room, lab, inHome);

    // Ресурс могли израсходовать, пока крип ехал. Если он уже везёт буст —
    // довозим его в лабу (иначе груз остался бы в рюкзаке навсегда).
    if (!row) {
      const carried = creepMemory.boostLab && creepMemory.boostLab.resource;
      // Типы Screeps: ресурс из памяти крипа — строка, getUsedCapacity ждёт
      // ResourceConstant.
      if (carried && creep.store.getUsedCapacity(/** @type {any} */ (carried)) > 0) {
        row = {
          resource: carried,
          parts: creepMemory.boostLab.parts,
          from: "room",
        };
      }
    }

    if (!row) {
      // Строки политики больше нет (буст израсходован/сменился) — груз из
      // рюкзака снимаем, чтобы роль не осталась заблокированной.
      dropCarriedBoost(
        creep,
        (creepMemory.boostLab && creepMemory.boostLab.resource) ||
          (creepMemory.boostTask && creepMemory.boostTask.resource),
      );
      delete creepMemory.boostTask;
      delete creepMemory.boostLab;
      delete creepMemory.boostSince;
      return false;
    }

    const cap = Math.min(
      row.parts,
      partsOfType(creep, row.resource) - boostedParts(creep, row.resource),
    );
    if (cap <= 0) {
      dropCarriedBoost(
        creep,
        (creepMemory.boostLab && creepMemory.boostLab.resource) ||
          (creepMemory.boostTask && creepMemory.boostTask.resource),
      );
      delete creepMemory.boostTask;
      delete creepMemory.boostLab;
      delete creepMemory.boostSince;
      return false;
    }
    return runBoost(roomState, creep, room, lab, row, cap);
  }

  // Буст запускается только в своей комнате: в удалённой нет доступа к складам
  // и буст-лабе комнаты.
  if (creep.room.name !== room.name) return false;

  // Буста сейчас нет — не перебираем политику каждый тик: троттлинг попыток
  // RETRY_INTERVAL тиков, отметка в памяти САМОГО крипа (одна запись на
  // неудачную попытку, а не на тик).
  const waitUntil = creepMemory.boostWait;
  if (waitUntil && Game.time < waitUntil) return false;

  const config = getConfig(room);
  if (!config) return false;

  const lab = findBoostLab(roomState, config.labId);
  if (!lab) return false;

  const row = selectBoost(roomState, creep, policy, room, lab, true);
  if (!row) {
    creepMemory.boostWait = Game.time + LAB_BOOST.RETRY_INTERVAL;
    // МЕТКА ОБЯЗАНА РАЗЛИЧАТЬ ДВА РАЗНЫХ состояния. «no stock» пишется, только
    // когда строка политики реально упёрлась в нехватку запаса; если же все
    // бусты роли уже выданы, это не дефицит, а норма. Раньше и то и другое
    // помечалось «no stock», и на живом shard3 метрика читалась как «бустов нет
    // вовсе», хотя, например, linkWorker в E35S39 был бустнут полностью (4/4).
    mark(
      room.name,
      policySatisfied(creep, policy) ? "бусты выданы" : "no stock",
    );
    return false;
  }

  const cap = Math.min(
    row.parts,
    partsOfType(creep, row.resource) - boostedParts(creep, row.resource),
  );
  if (cap <= 0) return false;

  delete creepMemory.boostWait;
  // Отметка старта процедуры: по ней жёсткий лимит MAX_BUSY_TICKS отдаёт
  // управление роли, даже если доставка буста не заладилась.
  creepMemory.boostSince = Game.time;
  mark(room.name, "need " + row.resource);
  return runBoost(roomState, creep, room, lab, row, cap);
}

module.exports = {
  run,
  getConfig,
  findBoostLab,
  partsOfType,
  boostedParts,
  rowSatisfied,
  available,
  BOOST_PER_PART,
};
