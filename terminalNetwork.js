/**
 * TERMINAL NETWORK (Task System v4)
 * Singleton. Уровень империи.
 *
 * Приоритет за тик (один send):
 *  1. Реагенты лаб — комната с пустым ингредиентом запрашивает,
 *     донор с запасом отправляет (если ресурс в storage — ставим
 *     terminalExports, воркеры грузят терминал на следующем тике).
 *  2. Энергия — по уровню Storage.
 *  3. Прочие ресурсы — выравнивание излишков.
 */

const {
  STORAGE,
  TERMINAL_SUPPLY,
  TERMINAL_NETWORK,
  LAB_BOOST,
  LAB_PRIORITY,
  CACHE,
} = require("./constants");
const labWorker = require("lab.worker");
// Приоритет заявок финального производства (см. prioritizeLabRequests).
const recipes = require("./lab.recipes");

/**
 * Продукт тройки — КОНЕЧНЫЙ буст (X-соединение), а не промежуточный компонент.
 * Имя движкового ресурса-буста третьего уровня начинается с катализатора X:
 * XKH2O, XZHO2, XUHO2, XLHO2, XKHO2. Тот же маркер использует lab.recipes для
 * определения комнаты финального производства (LAB_PRIORITY.PRODUCT_MARKER).
 * @param {*} product
 * @returns {boolean}
 */
function isFinalBoostProduct(product) {
  return (
    typeof product === "string" &&
    product.indexOf(LAB_PRIORITY.PRODUCT_MARKER) === 0
  );
}

// ── КЕШИ НА ТИК (heap) ──────────────────────────────────────────────────
// 1. Список своих комнат с терминалом. В Game.rooms лежат и чужие видимые
//    комнаты (разведка, оборона), а состав этого объекта меняется редко:
//    каждый тик перебирать все комнаты ради одного и того же подмножества —
//    плата ни за что. Имена кэшируются в heap и пересобираются раз в
//    CACHE.REFRESH_INTERVAL тиков (новый терминал входит в сеть с этой
//    задержкой). Объекты room/terminal/storage разрешаются заново каждый тик и
//    перепроверяются на принадлежность, поэтому устаревшая запись кэша
//    (комната потеряна, терминал снесён) просто пропускается, а не ломает run.
// 2. Конфиги троек лаб и разрешённые объекты лабораторий комнаты на текущий
//    тик. resourceInLabs/roomUsesReagent вызываются на каждый реагент и внутри
//    компараторов сортировки доноров, а Game.getObjectById и сборка массива
//    конфигов — самая дорогая их часть (замер shard3: resourceInLabs 2.03 мкс,
//    collectLabRequests 79 мкс за тик).

/**
 * Разрешённые лаборатории комнаты и её реагенты на текущий тик.
 * `labs` идут по слотам конфигов (lab1, lab2, reactor) — ровно в том порядке и
 * с той же кратностью, что и прежний обход, но каждый id разрешается один раз
 * за тик. `reagentList` — упорядоченный список реагентов (порядок первого
 * появления, как у прежнего Set), `reagents` — та же информация для O(1)
 * проверки «комната использует этот реагент».
 *
 * `reserved` — ресурсы, которые комната обязана иметь в наличии, но НЕ тратит
 * как реагент реакции: КОНЕЧНЫЕ бусты (продукты с маркером "X", см.
 * isFinalBoostProduct) и ресурсы буст-лабы (LAB_BOOST-политика). Промежуточные
 * продукты троек (KH2O/KHO2/ZHO2/UHO2/OH/UO/ZO/...) сюда НЕ попадают: они —
 * полуфабрикат, и обязаны уезжать в финальные тройки, иначе встанет цепочка.
 * Они попадают в resourceInLabs, поэтому заявка terminalNetwork «у комнаты
 * меньше LAB_REQUEST_BELOW» распространяется и на них: промежуточные компоненты
 * съезжаются в финальные комнаты, а готовые бусты — в буст-лабы обычных комнат.
 * Пороги сети (LAB_REQUEST_BELOW/LAB_KEEP/LAB_SHIP_AMOUNT) при этом не меняются.
 * @param {Room} room
 * @returns {{labs: any[], reagentList: string[], reagents: Object<string, boolean>, reserved: Object<string, boolean>, inLabs?: Object<string, number>, avail?: Object<string, number>, finalHub?: boolean}}
 */
function getRoomLabInfo(room) {
  let cache = global._terminalLabs;
  if (!cache || cache.tick !== Game.time) {
    cache = global._terminalLabs = { tick: Game.time, rooms: {} };
  }

  const cached = cache.rooms[room.name];
  if (cached) return cached;

  const labs = [];
  const byId = /** @type {Object<string, any>} */ ({});
  const reagents = /** @type {Object<string, boolean>} */ ({});
  const reserved = /** @type {Object<string, boolean>} */ ({});
  const reagentList = [];

  const configs = labWorker.getConfigs(room);
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i].config;

    if (config.reagent1 && !reagents[config.reagent1]) {
      reagents[config.reagent1] = true;
      reagentList.push(config.reagent1);
    }
    if (config.reagent2 && !reagents[config.reagent2]) {
      reagents[config.reagent2] = true;
      reagentList.push(config.reagent2);
    }
    // Продукты ОБОИХ рецептов тройки — не реагенты (их не «тратят» в реакции),
    // но и не свободный излишек: это цель производства комнаты. В заявки сети
    // они не идут (иначе комната запрашивала бы свой же продукт), а в
    // resourceInLabs идут — по ним считается локальный запас.
    // Продукты троек в `reserved` попадают ТОЛЬКО если это КОНЕЧНЫЙ буст
    // (имя начинается с маркера LAB_PRIORITY.PRODUCT_MARKER = "X"). Прежде
    // резервировался ЛЮБОЙ продукт тройки, и это перестало быть верным, как
    // только финальная X-реакция появилась не только в хабе: комната с такой
    // реакцией автоматически становится «финальной» (lab.recipes.isFinalHub),
    // и её промежуточные продукты (KH2O, UHO2, ZHO2, OH) замораживались вместе с
    // бустом — цепочка вставала (завод не мог отдать реагент хабу). Теперь
    // заморожен ровно тот ресурс, ради которого резерв и существует.
    if (
      config.recipeA &&
      isFinalBoostProduct(config.recipeA.product)
    )
      reserved[config.recipeA.product] = true;
    if (
      config.recipeB &&
      isFinalBoostProduct(config.recipeB.product)
    )
      reserved[config.recipeB.product] = true;
    // Буст-лаба: её ресурсы зарезервированы под бусты (см. LAB_BOOST).
    if (config.boost) {
      for (let b = 0; b < config.boost.length; b++)
        reserved[config.boost[b]] = true;
    }

    const ids = [config.lab1, config.lab2, config.reactor];
    for (let j = 0; j < ids.length; j++) {
      const id = ids[j];
      if (!id) continue;
      let lab = byId[id];
      if (lab === undefined) {
        lab = Game.getObjectById(id) || null;
        byId[id] = lab;
      }
      if (lab) labs.push(lab);
    }
  }

  const info = { labs, reagentList, reagents, reserved };
  cache.rooms[room.name] = info;
  return info;
}

/**
 * Сбрасывает тиковый кеш лабораторий терминальной сети (getRoomLabInfo и
 * построенные на нём запасы availableToGive/resourceInLabs).
 *
 * Нужен там, где игра МЕНЯЕТ состояние внутри тика: успешная отправка
 * терминала (send) уменьшает его склад. Кеш при этом не уничтожается, а
 * опустошается: при следующем обращении getRoomLabInfo пересоберёт данные
 * комнат в том же тике. Обычный путь (без отправки) кеш не трогает.
 */
function invalidateLabCache() {
  const cache = global._terminalLabs;
  if (cache) cache.rooms = {};
}

/**
 * Комнаты с терминалом, принадлежащие игроку (имена, heap-кеш на
 * CACHE.REFRESH_INTERVAL тиков). Чужие видимые комнаты в список не попадают.
 * @returns {string[]}
 */
function getTerminalRoomNames() {
  const cached = global._terminalRoomNames;
  if (cached && Game.time - cached.tick < CACHE.REFRESH_INTERVAL) {
    return cached.names;
  }

  const names = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    if (!room.terminal) continue;
    names.push(roomName);
  }

  global._terminalRoomNames = { tick: Game.time, names };
  return names;
}

// ── ОШИБКИ Terminal.send ────────────────────────────────────────────────
// Политика отправок не меняется: неудачная отправка возвращает false, и
// вызывающая сторона продолжает обход (следующий донор/категория). Различаются
// только причины: раньше все ошибки печатались одинаково («ошибка N»), и по
// логу нельзя было понять, ждать ли перезарядки (ERR_TIRED), доливать ли
// энергию под комиссию (ERR_NOT_ENOUGH_ENERGY), чинить ли аргументы
// (ERR_INVALID_ARGS) или получатель уже полон (ERR_FULL).
// Система backoff/повторов не вводится — коды различаются только в диагностике.
/** @type {Object<number, string>} */
const SEND_ERROR_MESSAGES = {
  [ERR_FULL]: "ERR_FULL: терминал получателя полон",
  [ERR_NOT_ENOUGH_ENERGY]:
    "ERR_NOT_ENOUGH_ENERGY: не хватает энергии на комиссию",
  [ERR_INVALID_ARGS]: "ERR_INVALID_ARGS: неверный ресурс/объём/комната",
  [ERR_TIRED]: "ERR_TIRED: терминал на перезарядке (cooldown)",
};

class TerminalNetwork {
  run() {
    const states = this.collectRoomStates();
    if (states.length < 2) {
      this.logStatus(states, [], "мало комнат с терминалом (нужно ≥ 2)");
      return;
    }

    const labRequests = this.collectLabRequests(states);

    // Заявки на локальный резерв бустов идут в ТОТ ЖЕ разбор (одна успешная
    // отправка за тик, приоритеты 3/2/1/0 — см. prioritizeLabRequests).
    const boostRequests = this.collectBoostRequests(states);
    for (let i = 0; i < boostRequests.length; i++) {
      labRequests.push(boostRequests[i]);
    }

    this.resetExports(states);

    // Приоритет: заявки комнаты финального производства (E35S37 по данным
    // LAB_PLAN) идут первыми. Список тот же, меняется только порядок.
    //
    // СКОЛЬКО ОТПРАВОК ЗА ТИК (ТЗ владельца «ЗАПУСТИТЬ ЛАБЫ — ВСЕ»). Раньше
    // инвариант был «одна успешная отправка за тик» (return по первому OK), и на
    // пять комнат с пятнадцатью тройками этого не хватало: у большинства
    // паузных троек не хватало ИМЕННО привоза сырья из другой комнаты. Теперь
    // лаб-заявки (и только они) разбираются до LAB_SENDS_PER_TICK отправок за
    // тик. Повторный вызов fulfillLabRequests вернёт true лишь тогда, когда
    // нашёлся СЛЕДУЮЩИЙ донор: терминал предыдущего уже на cooldown, а пол
    // энергии PRIORITY_ENERGY_FLOOR проверяется внутри на каждую отправку.
    // Обычная балансировка (энергия, ресурсы) по-прежнему делает одну отправку.
    const prioritized = this.prioritizeLabRequests(labRequests);
    const labSendLimit = TERMINAL_NETWORK.LAB_SENDS_PER_TICK || 1;
    // fedRooms — комнаты, получившие поставку в ЭТОМ тике: донорами они больше
    // не становятся, поэтому несколько отправок за тик не превращаются в
    // «перекати-поле» одного и того же ресурса.
    const fedRooms = new Set();
    let labSends = 0;
    while (
      labSends < labSendLimit &&
      this.fulfillLabRequests(states, prioritized, fedRooms)
    ) {
      labSends++;
    }
    if (labSends > 0) return;
    if (this.balanceEnergy(states)) return;

    const resourceTypes = this.collectResourceTypes(states);
    for (const resourceType of resourceTypes) {
      if (resourceType === RESOURCE_ENERGY) continue;
      if (resourceType === RESOURCE_POWER) continue;
      if (this.balanceResource(resourceType, states)) return;
    }

    this.logStatus(states, labRequests, "нет готовой отправки");
  }

  collectRoomStates() {
    const names = getTerminalRoomNames();
    const states = [];
    for (let i = 0; i < names.length; i++) {
      const room = Game.rooms[names[i]];
      // Кеш имён пересобирается раз в CACHE.REFRESH_INTERVAL тиков, поэтому
      // запись может устареть: комнату могли потерять, терминал — снести.
      if (!room) continue;
      if (!room.controller || !room.controller.my) continue;
      if (!room.terminal) continue;

      const storage = room.storage;
      states.push({
        room,
        terminal: room.terminal,
        storage,
        storageEnergy: storage ? storage.store[RESOURCE_ENERGY] || 0 : 0,
        terminalEnergy: room.terminal.store[RESOURCE_ENERGY] || 0,
      });
    }
    return states;
  }

  collectResourceTypes(states) {
    const types = new Set();
    for (const state of states) {
      for (const resourceType in state.terminal.store) {
        types.add(resourceType);
      }
      if (state.storage) {
        for (const resourceType in state.storage.store) {
          types.add(resourceType);
        }
      }
    }
    return types;
  }

  totalResource(state, resourceType) {
    const inTerminal = state.terminal.store[resourceType] || 0;
    const inStorage = state.storage
      ? state.storage.store[resourceType] || 0
      : 0;
    return inTerminal + inStorage;
  }

  /**
   * Суммарный запас ресурса в лабораториях комнаты.
   * Сюда входят и «зарезервированные» ресурсы (продукты обоих рецептов тройки
   * и бусты буст-лабы): по ним считается локальный запас комнаты, поэтому
   * заявка сети видит именно то, что уже лежит в лабораториях.
   * Лаборатории разрешаются один раз за тик (см. getRoomLabInfo) — прежний код
   * вызывал Game.getObjectById на каждый слот каждой тройки при каждом
   * обращении, а обращений на тик много: по одному на реагент комнаты плюс
   * компараторы сортировки доноров.
   * @param {Room} room
   * @param {string} resourceType
   * @returns {number}
   */
  resourceInLabs(room, resourceType) {
    // МЕМОИЗАЦИЯ НА ТИК. Запас лабораторий по одному ресурсу запрашивается за
    // тик десятки раз: живой замер shard3 — 223 вызова resourceInLabs, тогда как
    // уникальных пар «комната + ресурс» всего 5 × ~12. Внутри тика склады
    // лабораторий меняет только игра (реакции и действия крипов идут в
    // roomManager раньше сети), а успешная отправка сети завершает run()
    // (terminalNetwork.js:214/215/221) и лабораторий не касается, поэтому
    // значение стабильно до конца тика. Кеш живёт в том же per-tick объекте
    // global._terminalLabs, что и разрешение лабораторий (getRoomLabInfo):
    // отдельного кеша не заводим, инвалидация — та же (смена Game.time).
    const info = getRoomLabInfo(room);
    let cache = info.inLabs;
    if (!cache) cache = info.inLabs = {};
    const hit = cache[resourceType];
    if (hit !== undefined) return hit;

    const labs = info.labs;
    let total = 0;
    for (let i = 0; i < labs.length; i++) {
      total += labs[i].store[resourceType] || 0;
    }
    cache[resourceType] = total;
    return total;
  }

  roomUsesReagent(room, resourceType) {
    return getRoomLabInfo(room).reagents[resourceType] === true;
  }

  /**
   * Ресурс — ЗАРЕЗЕРВИРОВАННЫЙ РЕЗЕРВ финального хаба (E35S37 по данным
   * LAB_PLAN: комната, у которой продукт тройки начинается с маркера "X").
   *
   * Зачем. В хабе копятся конечные бусты для будущей экспансии, и по ТЗ
   * обычные рабочие комнаты не должны расходовать этот резерв. До этой правки
   * карта `reserved` (getRoomLabInfo) только заполнялась и нигде не читалась, а
   * `availableToGive` считал продукты хаба обычным излишком: при запасе выше
   * RESOURCE_SURPLUS_ABOVE (10000) и энергии донора ≥ 100000 балансировка могла
   * увезти XZHO2/XKH2O в любую комнату с нулём этого ресурса.
   *
   * Защита применяется ТОЛЬКО к финальному хабу: в комнатах-заводах продукты
   * (KH2O/KHO2/ZHO2/LHO2/UHO2) — не резерв, а полуфабрикат, и обязаны уезжать в
   * хаб, иначе встанет вся цепочка. Промежуточные компоненты хаба в `reserved`
   * не попадают (там только продукты его троек), поэтому их хаб отдаёт как
   * раньше.
   * @param {Room} room
   * @param {string} resourceType
   * @returns {boolean}
   */
  isHubReserve(room, resourceType) {
    // info берётся один раз: раньше getRoomLabInfo вызывался здесь и повторно в
    // reserved-выражении. isFinalHub считается по LAB_PLAN (строковые операции)
    // и в живом shard3 вызывался 187 раз за тик по одним и тем же пяти
    // комнатам — результат на тик неизменен, поэтому кешируется рядом с
    // остальными данными комнаты.
    const info = getRoomLabInfo(room);
    let finalHub = info.finalHub;
    if (finalHub === undefined) {
      finalHub = info.finalHub = recipes.isFinalHub(room.name);
    }
    if (!finalHub) return false;
    return info.reserved[resourceType] === true;
  }

  /**
   * Сколько единиц ресурса комната обязана ОСТАВИТЬ у себя (не отдавать никому).
   *
   * Разница с isHubReserve: там — жёсткий запрет (отдаём 0), здесь — ПОРОГ.
   * Появился он потому, что жёсткий запрет полностью блокировал экспорт бустов
   * из хаба: бусты для обычных рабочих комнат производит хаб (единственные
   * финальные тройки), а уходило из него ровно ноль — резерв экспансии защищён,
   * но Worker/Miner не получали ничего (живой shard3: буст-лабы всех пяти
   * комнат пусты, Memory.__boostMetric = "no stock").
   *
   * Правила:
   *   - это конечный буст (X-соединение) — порог = LAB_BOOST.HUB_RESERVE для
   *     хаба и LAB_BOOST.ROOM_RESERVE для рабочей комнаты; ресурса нет в
   *     таблице → возвращаем null, и дальше работает прежний жёсткий запрет
   *     (fail-closed: XKHO2/XLHO2 остаются замороженными целиком);
   *   - всё остальное (реагенты, полуфабрикаты) — null, поведение прежнее.
   * @param {Room} room
   * @param {string} resourceType
   * @returns {number|null} порог резерва либо null — «правило не задано»
   */
  roomReserve(room, resourceType) {
    if (!isFinalBoostProduct(resourceType)) return null;

    if (recipes.isFinalHub(room.name)) {
      const hubReserve = LAB_BOOST.HUB_RESERVE[resourceType];
      return typeof hubReserve === "number" ? hubReserve : null;
    }

    const roomReserve = LAB_BOOST.ROOM_RESERVE[resourceType];
    return typeof roomReserve === "number" ? roomReserve : null;
  }

  availableToGive(state, resourceType) {
    // МЕМОИЗАЦИЯ НА ТИК (наибольший одиночный вклад в бакет terminalNetwork).
    // Живой замер shard3: 222 вызова availableToGive за тик при 5 комнатах и
    // 24 типах ресурсов — одна и та же пара «комната + ресурс» считается
    // десятки раз (findDonor зовёт его в фильтре И в компараторе сортировки,
    // balanceResource — в фильтре и сортировке, collectBoostRequests — во
    // вложенном цикле 5 × 3 × 4). Внутри вычисления — totalResource (терминал +
    // склад), resourceInLabs (обход до 9 лабораторий), isHubReserve и
    // roomReserve, поэтому повторный расчёт — чистая трата CPU.
    //
    // Почему значение стабильно до конца тика: склады терминалов и лабораторий
    // меняет либо игра (действия крипов и реакции — они идут в roomManager
    // раньше сети), либо сама сеть, но ЛЮБАЯ успешная отправка немедленно
    // завершает run() (terminalNetwork.js:214/215/221). На случай будущей правки
    // порядка вызовов кеш сбрасывается прямо в send() по коду OK
    // (invalidateLabCache) — полагаться на «дальше всё равно return» нельзя.
    const info = getRoomLabInfo(state.room);
    let cache = info.avail;
    if (!cache) cache = info.avail = {};
    const hit = cache[resourceType];
    if (hit !== undefined) return hit;

    const value = this.computeAvailableToGive(state, resourceType);
    cache[resourceType] = value;
    return value;
  }

  /**
   * Расчёт «сколько комната может отдать» без мемоизации. Отделён от
   * availableToGive только ради кеша на тик: логика не менялась.
   * @param {Object} state
   * @param {string} resourceType
   * @returns {number}
   */
  computeAvailableToGive(state, resourceType) {
    // Порог резерва бустов: отдаём только то, что ВЫШЕ него.
    const reserve = this.roomReserve(state.room, resourceType);
    if (reserve !== null) {
      return Math.max(0, this.totalResource(state, resourceType) - reserve);
    }

    // Ресурса нет в таблице резервов — прежний жёсткий запрет (см. isHubReserve).
    if (this.isHubReserve(state.room, resourceType)) return 0;

    const keep = this.roomUsesReagent(state.room, resourceType)
      ? TERMINAL_NETWORK.LAB_KEEP
      : 0;
    // ЗАПАС ДОНОРА СЧИТАЕТСЯ ВМЕСТЕ С ЛАБОРАТОРИЯМИ — ровно так же, как его
    // считает заявка (collectLabRequests: totalResource + resourceInLabs).
    // Асимметрия была дефектом и полностью останавливала производство бустов:
    // у единственного производителя KH2O (E35S39) реагент лежит и в терминале
    // (1500), и в лабе его же активной тройки (2750), но сеть видела только
    // терминал и вычитала LAB_KEEP 3000 → availableToGive = 0, findDonor
    // отбрасывал донора (нужно ≥ MIN_SEND_AMOUNT), и KH2O не уезжал НИКОГДА.
    // Итог живого замера: работала ровно одна реакция из пятнадцати, буст-лабы
    // стояли пустыми, бустов не было ни у одного крипа.
    //
    // Почему это не создаёт отправок «из воздуха»: send()/fitSendAmount берёт
    // объём из ТЕРМИНАЛА (amount = min(desired, terminal.store[resource])), а
    // лабораторный запас лишь перестаёт скрывать излишек от сети. Донор, у
    // которого реагент только в лабе, отправить не сможет — но он и не будет
    // выбран первым: findDonor сортирует «готовых» (ресурс в терминале) вперёд.
    const stock =
      this.totalResource(state, resourceType) +
      this.resourceInLabs(state.room, resourceType);
    return Math.max(0, stock - keep);
  }

  /**
   * Заявки на ЛОКАЛЬНЫЙ РЕЗЕРВ БУСТОВ (LAB_BOOST.ROOM_RESERVE).
   *
   * Раньше заявок на бусты не было вовсе: collectLabRequests собирает список
   * только из реагентов тройки (config.reagent1/reagent2), а буст — не реагент,
   * а продукт. Поэтому даже после снятия запрета на экспорт хаба буст не уехал
   * бы: сеть просто не знала, что комната в нём нуждается.
   *
   * Заявка создаётся, только если:
   *   1) локальный запас (Storage + Terminal + лаборатории) ниже ROOM_RESERVE;
   *   2) у ДРУГОЙ комнаты есть что отдать ВЫШЕ её собственного резерва (иначе
   *      заявка висела бы вечно и засоряла разбор — одна отправка за тик).
   *
   * Донором может быть любая комната, а не только хаб: финальные X-тройки стоят
   * во всех рабочих комнатах (LAB_PLAN), и каждая держит свой пол. Гейт по
   * донору делает механизм безопасным: заявка появляется только тогда, когда
   * поставка физически возможна.
   *
   * Приоритет 1 — как у реагентов комнат-заводов: заявка обязана идти с
   * энергополом PRIORITY_ENERGY_FLOOR (20000), иначе она не отправится никогда
   * (терминалы живут на 44–75k при обычном пороге 100000). При этом она НЕ
   * поднимается выше заявок хаба (2 и 3) — производство бустов первично,
   * доставка вторична.
   * @param {Array} states
   * @returns {Array}
   */
  collectBoostRequests(states) {
    const requests = [];
    const reserveMap = LAB_BOOST.ROOM_RESERVE;

    for (let i = 0; i < states.length; i++) {
      const state = states[i];

      for (const resourceType in reserveMap) {
        const reserve = reserveMap[resourceType];
        const have =
          this.totalResource(state, resourceType) +
          this.resourceInLabs(state.room, resourceType);
        if (have >= reserve) continue;

        // Донором может быть ЛЮБАЯ другая комната, у которой есть излишек выше
        // её собственного резерва (бусты производят все рабочие комнаты, и
        // каждая держит свой пол). Себя в доноры не берём: иначе комната
        // «съезжала» бы на собственный резерв и запрашивала бы его снова.
        let canGive = 0;
        for (let j = 0; j < states.length; j++) {
          const other = states[j];
          if (other.room.name === state.room.name) continue;
          const can = this.availableToGive(other, resourceType);
          if (can > canGive) canGive = can;
        }
        if (canGive < TERMINAL_NETWORK.MIN_SEND_AMOUNT) continue;

        requests.push({
          state,
          resourceType,
          have,
          // Объём — ВСЯ поставка, а не «недостача до резерва»: send() отказывает
          // при amount < MIN_SEND_AMOUNT (1000), поэтому «добор 200 единиц»
          // не отправился бы НИКОГДА, а заявка висела бы в разборе каждый тик.
          // Перебор выше резерва безопасен: резерв — это пол, а не потолок.
          needed: Math.min(LAB_BOOST.BOOST_SHIP_AMOUNT, canGive),
          priority: 1,
        });
      }
    }

    return requests;
  }

  collectLabRequests(states) {
    const requests = [];
    for (const state of states) {
      // Реагенты берутся из того же тикового кеша, что и лаборатории: порядок
      // первого появления сохранён, поэтому порядок заявок (и их сортировка по
      // запасу) не изменился, а getConfigs не собирается повторно.
      const reagents = getRoomLabInfo(state.room).reagentList;

      for (let i = 0; i < reagents.length; i++) {
        const resourceType = reagents[i];
        const have =
          this.totalResource(state, resourceType) +
          this.resourceInLabs(state.room, resourceType);
        if (have >= TERMINAL_NETWORK.LAB_REQUEST_BELOW) continue;

        // ДЕФИЦИТ МЕНЬШЕ МИНИМАЛЬНОЙ ОТПРАВКИ — ЗАЯВКИ НЕТ (корень пинг-понга).
        //
        // `have` считает терминал + склад + ЛАБОРАТОРИИ, а уехать может только
        // содержимое ТЕРМИНАЛА (fitSendAmount берёт объём из него). Поэтому
        // комната с запасом реагента в лабораториях (живой shard3: 2815 Z при
        // пороге 3000) формально «дефицитна» и запрашивала поставку, хотя добор
        // ей не нужен: 3000 − 2815 = 185, а минимальная отправка — 1000. Получив
        // 1000 в терминал, она сама становилась донором для отправителя, чей
        // запас от этой отправки просел, и тот отдавал те же 1000 обратно:
        // E37S38 ↔ E36S38 гоняли 1000 Z строго попеременно, возвращая состояние
        // в исходное. Цикл съедал комиссию и ЕДИНСТВЕННЫЙ слот отправки сети в
        // тик (run() выходит по первой успешной отправке), из-за чего
        // приоритетные заявки буст-цепочек ждали.
        //
        // Проверка ничего не блокирует: она лишь не создаёт заявку, которую сеть
        // физически не может закрыть (поставка меньше MIN_SEND_AMOUNT не
        // отправится — send() откажет). Настоящий дефицит (реагента нет вовсе)
        // даёт 3000 ≥ 1000 и проходит как раньше.
        if (
          TERMINAL_NETWORK.LAB_REQUEST_BELOW - have <
          TERMINAL_NETWORK.MIN_SEND_AMOUNT
        )
          continue;

        requests.push({
          state,
          resourceType,
          have,
          needed: TERMINAL_NETWORK.LAB_SHIP_AMOUNT,
          // Уровень приоритета считает lab.recipes по данным LAB_PLAN:
          // 3 — хаб, реагент ниже своего LOW (финальная реакция уже встала),
          // 2 — хаб, компонент финального производства (буфер цел),
          // 1 — комната-завод, её собственный реагент ниже порога сети,
          // 0 — обычная заявка сети. Чем БОЛЬШЕ уровень, тем раньше заявка
          // (prioritizeLabRequests сортирует по убыванию). Заявка с уровнем > 0
          // отправляется с энергополом PRIORITY_ENERGY_FLOOR вместо
          // TERMINAL_SUPPLY.ENERGY_MIN — без этого сырьё к заводам не доезжает
          // (в живом shard3 энергия терминалов 48–77k при пороге 100k).
          // Порог заявки (LAB_REQUEST_BELOW) при этом не меняется.
          priority: recipes.priorityLevel(state.room.name, resourceType, have),
        });
      }
    }
    return requests.sort((a, b) => a.have - b.have);
  }

  /**
   * Порядок заявок: сначала комната финального производства, внутри — по
   * фактическому дефициту.
   *
   * Зачем. terminalNetwork делает одну успешную отправку за тик, а заявок
   * (базовые минералы, излишек которых лежит без дела, плюс шесть
   * промежуточных компонентов) всегда больше. Сортировка «у кого меньше
   * запас» отдаёт тик произвольному голодному потребителю, и финальные тройки
   * E35S37 стоят без реагента: конечные X-бусты не варятся, хотя сырьё лежит в
   * терминалах соседних комнат (замер 25.09.2026 на shard3: KH2O = 0 в
   * E35S37 при 7400 KH2O в E35S39; LHO2 = 0 при 7390 в E37S37).
   *
   * Как. Заявки с priority > 0 поднимаются вперёд, внутри приоритетной группы
   * сохраняется сортировка по дефициту (и дефицит здесь, а не «кто раньше в
   * списке»): сначала реагент, которого нет вообще, затем остальные
   * компоненты. Первыми идут заявки хаба с уровнем 3 (реагент ниже своего LOW
   * из LAB_PLAN — реакция уже встала), затем уровень 2 (компоненты хаба), затем
   * уровень 1 (реагенты комнат-заводов, без которых не производится
   * промежуточный компонент).
   *
   * Что НЕ меняется:
   *   - пороги сети (LAB_REQUEST_BELOW/LAB_KEEP/LAB_SHIP_AMOUNT) и общий
   *     surplus/deficit-балансир;
   *   - одна успешная отправка за тик (run по-прежнему выходит по первому OK);
   *   - резерв энергии терминала-донора (fitSendAmount);
   *   - заявка остаётся заявкой: приоритет меняет только порядок разбора.
   *
   * Нового планировщика нет — это сортировка уже собранного списка заявок.
   * @param {Array} requests
   * @returns {Array}
   */
  prioritizeLabRequests(requests) {
    if (requests.length < 2) return requests;

    let hasPriority = false;
    for (let i = 0; i < requests.length; i++) {
      if (requests[i].priority > 0) {
        hasPriority = true;
        break;
      }
    }
    if (!hasPriority) return requests;

    return requests.sort((a, b) => {
      const byPriority = (b.priority || 0) - (a.priority || 0);
      if (byPriority !== 0) return byPriority;
      return a.have - b.have;
    });
  }

  /**
   * Снимает заявки прошлого тика перед новым разбором (заявки текущего тика
   * дописывает addExport — поведение не изменилось).
   *
   * Прежний код безусловно писал Memory.rooms[*].terminalExports = {} для каждой
   * комнаты с терминалом КАЖДЫЙ тик. Запись в Memory помечает её «грязной», и
   * движок сериализует её целиком (36 КБ на живом shard3) — в том числе в тики,
   * когда заявок не было вовсе (замер: terminalExports пуст во всех 5 комнатах).
   * Теперь объект трогается, только если в нём что-то есть; если заявок не было,
   * Memory остаётся нетронутой.
   */
  resetExports(states) {
    for (let i = 0; i < states.length; i++) {
      const roomMemory = Memory.rooms && Memory.rooms[states[i].room.name];
      const exports = roomMemory && roomMemory.terminalExports;
      if (!exports) continue;
      for (const resourceType in exports) delete exports[resourceType];
    }
  }

  addExport(roomName, resourceType, amount) {
    if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};
    const exports = Memory.rooms[roomName].terminalExports || {};
    exports[resourceType] = Math.max(exports[resourceType] || 0, amount);
    Memory.rooms[roomName].terminalExports = exports;
  }

  findDonor(states, resourceType, destRoomName, excludeRooms) {
    const minSend = TERMINAL_NETWORK.MIN_SEND_AMOUNT;
    return states
      .filter(s => s.room.name !== destRoomName)
      // Комната, которая в ЭТОМ ЖЕ тике уже получила лаб-поставку, донором быть
      // не может: иначе за несколько отправок за тик один и тот же ресурс уезжал
      // бы «туда и обратно» (живой пример из теста: KH2O E35S39→E35S37 3000,
      // затем E35S37→E37S37 3000 в том же тике) — комиссия тратится дважды, а
      // cooldown терминала-транзитёра блокирует настоящие поставки.
      .filter(s => !excludeRooms || !excludeRooms.has(s.room.name))
      .filter(s => this.availableToGive(s, resourceType) >= minSend)
      .sort((a, b) => {
        const aReady =
          a.terminal.cooldown === 0 &&
          (a.terminal.store[resourceType] || 0) >= minSend
            ? 1
            : 0;
        const bReady =
          b.terminal.cooldown === 0 &&
          (b.terminal.store[resourceType] || 0) >= minSend
            ? 1
            : 0;
        if (bReady !== aReady) return bReady - aReady;
        return (
          this.availableToGive(b, resourceType) -
          this.availableToGive(a, resourceType)
        );
      })[0];
  }

  fulfillLabRequests(states, requests, fedRooms) {
    const minSend = TERMINAL_NETWORK.MIN_SEND_AMOUNT;

    for (const req of requests) {
      const donor = this.findDonor(
        states,
        req.resourceType,
        req.state.room.name,
        fedRooms,
      );
      if (!donor) continue;

      const inTerminal = donor.terminal.store[req.resourceType] || 0;
      const canGive = this.availableToGive(donor, req.resourceType);
      const desired = Math.min(req.needed, canGive);

      if (
        donor.terminal.cooldown === 0 &&
        inTerminal >= minSend &&
        this.send(donor, req.state, req.resourceType, desired, req.priority > 0)
      ) {
        // Получателя запоминаем: в этом тике он больше не донор (см. findDonor).
        if (fedRooms) fedRooms.add(req.state.room.name);
        return true;
      }

      const loadAmount = Math.min(desired, canGive) - inTerminal;
      if (
        loadAmount > 0 &&
        donor.storage &&
        (donor.storage.store[req.resourceType] || 0) > 0
      ) {
        this.addExport(
          donor.room.name,
          req.resourceType,
          Math.max(loadAmount, minSend),
        );
      }
    }

    return false;
  }

  /**
   * Подгоняет объём отправки под комиссию и резерв энергии в терминале.
   * После send в терминале донора должно остаться >= ENERGY_MIN.
   *
   * @param {Object} terminal
   * @param {string} destRoomName
   * @param {string} resourceType
   * @param {number} desired
   * @param {boolean} [priority] приоритетная поставка реагента финального
   *   производства. Для неё допустимый остаток энергии терминала-донора —
   *   TERMINAL_NETWORK.PRIORITY_ENERGY_FLOOR, а не TERMINAL_SUPPLY.ENERGY_MIN:
   *   последний на shard3 структурно недостижим (энергия терминалов стоит на
   *   50–79k, потому что fillTerminalEnergy включается только при Storage выше
   *   195k), поэтому с ним отправка не проходила ВООБЩЕ и финальные тройки
   *   стояли без реагентов. Резерв не отменяется: комиссия по-прежнему
   *   считается и проверяется, обычные отправки (энергия, балансировка
   *   ресурсов) используют прежний порог, а энергия как ресурс всегда
   *   отправляется с прежним полом.
   * @returns {number}
   */
  fitSendAmount(terminal, destRoomName, resourceType, desired, priority) {
    const minSend = TERMINAL_NETWORK.MIN_SEND_AMOUNT;
    // Для энергии пол не понижается: amount и комиссия списываются из одного
    // запаса, и «отдать энергию почти до нуля» недопустимо ни при каком
    // приоритете ресурса.
    const keepEnergy =
      priority && resourceType !== RESOURCE_ENERGY
        ? TERMINAL_NETWORK.PRIORITY_ENERGY_FLOOR
        : TERMINAL_SUPPLY.ENERGY_MIN;
    const energy = terminal.store[RESOURCE_ENERGY] || 0;
    const available =
      resourceType === RESOURCE_ENERGY
        ? energy
        : terminal.store[resourceType] || 0;

    let amount = Math.min(desired, available);
    if (amount < minSend) return 0;

    for (let i = 0; i < 8; i++) {
      const cost = Game.market.calcTransactionCost(
        amount,
        terminal.room.name,
        destRoomName,
      );
      const energyAfter =
        resourceType === RESOURCE_ENERGY
          ? energy - amount - cost
          : energy - cost;

      if (energyAfter >= keepEnergy && amount >= minSend) {
        return amount;
      }

      if (resourceType === RESOURCE_ENERGY) {
        amount = energy - keepEnergy - cost;
      } else {
        amount = Math.floor(amount * 0.7);
      }
      amount = Math.min(amount, available);
      if (amount < minSend) return 0;
    }

    return 0;
  }

  send(fromState, toState, resourceType, desired, priority) {
    const free = toState.terminal.store.getFreeCapacity(resourceType);
    const amount = this.fitSendAmount(
      fromState.terminal,
      toState.room.name,
      resourceType,
      Math.min(desired, free),
      priority,
    );
    if (amount < TERMINAL_NETWORK.MIN_SEND_AMOUNT) return false;

    const result = fromState.terminal.send(
      resourceType,
      amount,
      toState.room.name,
      "TerminalNetwork balance",
    );

    if (result === OK) {
      // Отправка изменила склад терминала, а запасы на тик мемоизированы
      // (availableToGive/resourceInLabs). Сейчас run() после OK всё равно
      // выходит (terminalNetwork.js:214/215/221), поэтому устаревшие значения
      // никто не прочитает, — но полагаться на порядок вызовов нельзя: правка
      // цепочки не должна тихо превратиться в работу по устаревшим данным.
      invalidateLabCache();
      console.log(
        `[TerminalNetwork] ${fromState.room.name} → ${toState.room.name}: ` +
          `${amount} ${resourceType}`,
      );
      return true;
    }

    // Политика та же (false — вызывающая сторона продолжает обход), различается
    // только причина отказа.
    const reason =
      SEND_ERROR_MESSAGES[result] || `неизвестная ошибка ${result}`;
    console.log(
      `[TerminalNetwork] send ${resourceType} ${amount} ` +
        `${fromState.room.name} → ${toState.room.name}: ${reason}`,
    );
    return false;
  }

  balanceEnergy(states) {
    const surplusMin =
      STORAGE.ENERGY_MIN * TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER;

    const deficits = states
      .filter(s => s.storageEnergy < STORAGE.ENERGY_MIN)
      .sort((a, b) => a.storageEnergy - b.storageEnergy);

    if (deficits.length === 0) return false;

    const surpluses = states
      .filter(s => s.terminal.cooldown === 0)
      .filter(s => s.storageEnergy > surplusMin)
      .filter(
        s =>
          s.terminalEnergy >
          TERMINAL_SUPPLY.ENERGY_MIN + TERMINAL_NETWORK.MIN_SEND_AMOUNT,
      )
      .sort((a, b) => b.storageEnergy - a.storageEnergy);

    for (const from of surpluses) {
      const to = deficits.find(d => d.room.name !== from.room.name);
      if (!to) return false;

      const needed = STORAGE.ENERGY_MIN - to.storageEnergy;
      if (this.send(from, to, RESOURCE_ENERGY, needed)) return true;
    }

    return false;
  }

  balanceResource(resourceType, states) {
    // ДЕШЁВАЯ ПРОВЕРКА ДЕФИЦИТА ИДЁТ ПЕРВОЙ — до поиска излишка.
    // Дорогая часть функции — именно поиск излишка: availableToGive внутри
    // filter и sort, а внутри него totalResource, resourceInLabs и
    // isHubReserve. Живой замер shard3: цикл по 24 типам ресурсов давал 78 µs в
    // мок-прогоне (≈0.3 мс на живом бакете 852 µs), причём у подавляющего
    // большинства типов дефицита нет вовсе — и вся дорогая часть считается
    // впустую. Здесь 5 чтений totalResource (терминал + склад).
    //
    // Поведение не меняется: без дефицитной комнаты прежний код всё равно
    // возвращал false — deficitState получался undefined, потому что список
    // дефицитов строился по тому же условию.
    let hasDeficit = false;
    for (let i = 0; i < states.length; i++) {
      if (
        this.totalResource(states[i], resourceType) <
        TERMINAL_NETWORK.RESOURCE_DEFICIT_BELOW
      ) {
        hasDeficit = true;
        break;
      }
    }
    if (!hasDeficit) return false;

    const surplusState = states
      .filter(s => s.terminal.cooldown === 0)
      .filter(
        s =>
          this.availableToGive(s, resourceType) >
          TERMINAL_NETWORK.RESOURCE_SURPLUS_ABOVE,
      )
      .filter(
        s =>
          (s.terminal.store[resourceType] || 0) >=
          TERMINAL_NETWORK.MIN_SEND_AMOUNT,
      )
      .sort(
        (a, b) =>
          this.availableToGive(b, resourceType) -
          this.availableToGive(a, resourceType),
      )[0];

    if (!surplusState) return false;

    const deficitState = states
      .filter(s => s.room.name !== surplusState.room.name)
      .filter(
        s =>
          this.totalResource(s, resourceType) <
          TERMINAL_NETWORK.RESOURCE_DEFICIT_BELOW,
      )
      .sort(
        (a, b) =>
          this.totalResource(a, resourceType) -
          this.totalResource(b, resourceType),
      )[0];

    if (!deficitState) return false;

    const needed =
      TERMINAL_NETWORK.RESOURCE_TARGET -
      this.totalResource(deficitState, resourceType);

    return this.send(surplusState, deficitState, resourceType, needed);
  }

  logStatus(states, labRequests, reason) {
    if (Game.time % TERMINAL_NETWORK.STATUS_INTERVAL !== 0) return;

    console.log(`[TerminalNetwork] ${reason}`);
    if (labRequests && labRequests.length) {
      for (const req of labRequests) {
        console.log(
          `  запрос ${req.state.room.name}: ${req.resourceType} (есть ${req.have})`,
        );
      }
    }
    for (const s of states) {
      const exports = (Memory.rooms[s.room.name] || {}).terminalExports || {};
      const exportKeys = Object.keys(exports);
      const extra = exportKeys.length
        ? ` export=${exportKeys.join(",")}`
        : "";
      console.log(
        `  ${s.room.name}: storageE=${s.storageEnergy} terminalE=${s.terminalEnergy}` +
          (s.terminal.cooldown ? ` cd=${s.terminal.cooldown}` : "") +
          extra,
      );
    }
  }
}

module.exports = new TerminalNetwork();
