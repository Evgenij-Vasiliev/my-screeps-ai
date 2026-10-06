// ===================================================
// ECON.JS — политика постоянного роста запасов энергии
// ===================================================
// Требование владельца (05.10.2026): «никаких целей — это тренд: и хранилище,
// и терминал должны расти постоянно, то есть приход должен всегда опережать
// расход; приход фиксированный, значит контролировать можно только расход».
//
// ЧТО ЗДЕСЬ И ЧЕГО ЗДЕСЬ НЕТ.
// Здесь НЕТ целевых уровней. Цель по определению перестаёт действовать после
// достижения — именно поэтому прежняя схема (TERMINAL_SUPPLY.ENERGY_TARGET =
// 150 000 при гейте «склад выше 195 000») держала терминалы на 98-113k:
// условие наполнения было недостижимо (task/gen.terminal.js:36-40 до правки).
//
// Вместо цели — ХРАПОВИК (ratchet). Запоминается ДОСТИГНУТЫЙ максимум склада
// и терминала. Максимум может только расти, поэтому:
//   - склад не отдаёт энергию ниже «максимум минус допуск» (FLEX_STORAGE);
//   - терминал пополняется, пока его доля в общем запасе ниже TERMINAL_SHARE.
// Из этого следует рост ОБОИХ по построению, а не по достижении числа.
//
// ЖИВОЙ ЗАМЕР, НА КОТОРОМ ЭТО ПОСТРОЕНО (shard3, read-only,
// node /tmp/probe.budget.js, tick 83450886 -> 83451058, 172 тика):
//   приход источников  ~100/тик (10 источников x 3000/300)
//   storage            971 580 -> 966 144  (-5 436, -31.6/тик)
//   terminal           495 508 -> 509 367  (+13 859, +80.6/тик)
//   апгрейд            0 (задача не ставится при ticksToDowngrade > 50 000)
//   спавн 1 600, ремонт 2 254, фабрика 0, powerSpawn 0, нюкер 300 000 заморожен
// Дефект, который лечит этот модуль: суммарный рост был (~+49/тик), но он
// целиком уходил в терминал ЗА СЧЁТ склада. Причина — перенос в терминал не
// был ограничен ничем, кроме недостижимого порога, и при срабатывании
// забирал всё, что видел.
//
// ПОЧЕМУ ОБЯЗАТЕЛЬНЫЕ ПОТРЕБИТЕЛИ НЕ ТРОНУТЫ. Спавн крипов, оборона и
// аварийное удержание контроллера продолжают жить на STORAGE.ENERGY_MIN
// (150 000, constants/logistics.js:13) через energySource.withdrawFromStorage.
// Если бы храповик опустил и их порог, империя встала бы при первом же спаде
// прихода: пол склада растёт, а спавн обязан работать всегда. Поэтому
// политика ограничивает только ОПЦИОНАЛЬНЫЕ стоки — те, без которых империя
// не умирает: перенос в терминал, отправки сети, фабрика, powerSpawn,
// апгрейд сверх аварийного.
//
// ТОЧКА ОТКАТА БЕЗ ПЕРЕВЫГРУЗКИ: Memory.econOff = true. Тогда observe()
// ничего не пишет, а canFillTerminal() возвращает прежнее условие
// (склад > 195 000 и терминал < ENERGY_TARGET). Снять — delete Memory.econOff.
//
// СТОИМОСТЬ: один вызов observe() на комнату за тик из room/run.js. Внутри —
// два чтения store и сравнение с числом; запись в Memory только когда максимум
// превысил сохранённый больше чем на ECON.WRITE_QUANTUM (Memory сериализуется
// целиком каждый тик, empire.js:21-25).
//
// require("./constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource),
// потому что движок Screeps относительных путей не умеет.
// ===================================================
const { STORAGE, TERMINAL_SUPPLY, ECON } = require("./constants");

/**
 * Включена ли политика. Две независимые точки отката:
 *   ECON.ENABLED = false      — в constants/econ.js (нужна перевыгрузка);
 *   Memory.econOff = true     — из консоли, без перевыгрузки.
 */
function enabled() {
  if (ECON.ENABLED === false) return false;
  if (Memory.econOff === true) return false;
  return true;
}

/**
 * Хранилище максимумов. Создаётся один раз за всю жизнь империи (и после
 * каждого рестарта Memory оно уже есть), дальше только мутируется.
 */
function store() {
  const e = Memory.econ;
  if (e && e.s && e.t) return e;

  if (!Memory.econ) Memory.econ = {};
  if (!Memory.econ.s) Memory.econ.s = {};
  if (!Memory.econ.t) Memory.econ.t = {};

  return Memory.econ;
}

/** Максимум склада, зафиксированный в Memory (0 — комната ещё не наблюдалась). */
function storageHighWater(roomName) {
  const e = Memory.econ;
  return (e && e.s && e.s[roomName]) || 0;
}

/** Максимум терминала, зафиксированный в Memory. */
function terminalHighWater(roomName) {
  const e = Memory.econ;
  return (e && e.t && e.t[roomName]) || 0;
}

/** Энергия склада комнаты (0, если склада нет — до RCL 4 его не существует). */
function storageEnergy(roomState) {
  const s = roomState.storage;
  return s ? s.store[RESOURCE_ENERGY] || 0 : 0;
}

/**
 * Пол склада: ниже этого уровня опциональные потребители энергию не получают.
 *
 *   пол = max(STORAGE.ENERGY_MIN, максимум - FLEX_STORAGE)
 *
 * STORAGE.ENERGY_MIN (150 000) стоит первым слагаемым НАМЕРЕННО: пока
 * храповик не набрал высоту, поведение остаётся прежним, и правка не может
 * сделать политику строже той, что уже проверена в бою.
 *
 * @param {string} roomName
 * @returns {number}
 */
function storageFloor(roomName) {
  const ratchet = storageHighWater(roomName) - ECON.FLEX_STORAGE;
  return ratchet > STORAGE.ENERGY_MIN ? ratchet : STORAGE.ENERGY_MIN;
}

/**
 * Свободные средства склада — то, что можно отдать опциональным потребителям,
 * не откатывая запас ниже пола. Никогда не отрицательно.
 *
 * @param {Object} roomState
 * @returns {number}
 */
function freeStorage(roomState) {
  const free = storageEnergy(roomState) - storageFloor(roomState.roomName);
  return free > 0 ? free : 0;
}

/**
 * Доля терминала: до какого уровня его наполнять.
 *
 *   доля = (склад + терминал) * TERMINAL_SHARE
 *
 * Смысл пропорции: рост распределяется между двумя хранилищами, поэтому
 * растут оба. До правки весь рост уходил в терминал (замер: terminal
 * +80.6/тик при storage -31.6/тик).
 *
 * @param {StructureStorage|null} storage
 * @param {StructureTerminal|null} terminal
 * @returns {number}
 */
function shareTargetOf(storage, terminal) {
  const se = storage ? storage.store[RESOURCE_ENERGY] || 0 : 0;
  const te = terminal ? terminal.store[RESOURCE_ENERGY] || 0 : 0;
  const share = Math.floor((se + te) * ECON.TERMINAL_SHARE);
  if (!terminal) return share;

  // Потолок — защита места под ресурсы, а не цель роста: энергия может
  // подняться лишь настолько, чтобы в терминале остался
  // TERMINAL_FREE_RESERVE свободного места под довоз реагентов и закупки
  // (живой замер: терминалы заняты на ~250k из 300k ещё до правки).
  const cap =
    te + terminal.store.getFreeCapacity() - ECON.TERMINAL_FREE_RESERVE;

  if (cap < share) return cap > 0 ? cap : 0;
  return share;
}

/**
 * То же по roomState — для генератора задач и консольной диагностики.
 *
 * @param {Object} roomState
 * @returns {number}
 */
function terminalShareTarget(roomState) {
  return shareTargetOf(roomState.storage, roomState.terminal);
}

/**
 * Сумма ФАКТИЧЕСКОГО запаса империи (склады + терминалы) за текущий тик.
 *
 * Раньше скорость роста считалась по храповику (сумме максимумов), и это
 * оказалось СЛЕПЫМ: максимум обновляется только когда запас превысил его на
 * WRITE_QUANTUM, поэтому при росте от низкой точки к прежнему максимуму
 * скорость показывала ровно 0 — и опциональные стоки выключались, хотя запас
 * рос. Живой замер tick 83462697: склады 185 011..205 703 и растут, а
 * `econ.g.rate` = 0, фабрика заблокирована.
 *
 * Аккумулятор живёт в heap: observe вызывается по разу на комнату за тик, и
 * сумма собирается за тик целиком. Полная сумма ПРЕДЫДУЩЕГО тика (её и
 * сравнивает регулятор) возвращается на первом observe нового тика.
 *
 * @param {Object} roomState
 * @returns {number} сумма прошлого тика или -1, если её ещё нет
 */
function accrue(roomState) {
  const energy = storageEnergy(roomState) + terminalEnergy(roomState);
  const h = global.__econAcc;

  if (!h || h.tick !== Game.time) {
    const prev = h ? h.sum : -1;
    global.__econAcc = { tick: Game.time, sum: energy };
    return prev;
  }

  h.sum += energy;
  return -1;
}

/** Энергия терминала комнаты (0, если терминала нет — до RCL 6). */
function terminalEnergy(roomState) {
  const t = roomState.terminal;
  return t ? t.store[RESOURCE_ENERGY] || 0 : 0;
}

/**
 * Обновление максимумов комнаты. Вызывается один раз за тик на комнату
 * (room/run.js, начало runRoom).
 *
 * Пишем в Memory ТОЛЬКО при превышении на WRITE_QUANTUM: при росте ~100/тик
 * запись иначе шла бы каждый тик, а Memory сериализуется целиком.
 *
 * @param {Object} roomState
 */
function observe(roomState) {
  if (!enabled()) return;

  const s = roomState.storage;
  const t = roomState.terminal;
  if (!s && !t) return;

  const roomName = roomState.roomName;
  const e = store();

  if (s) {
    const energy = s.store[RESOURCE_ENERGY] || 0;
    if (energy > (e.s[roomName] || 0) + ECON.WRITE_QUANTUM) {
      e.s[roomName] = energy;
    }
  }

  if (t) {
    const energy = t.store[RESOURCE_ENERGY] || 0;
    if (energy > (e.t[roomName] || 0) + ECON.WRITE_QUANTUM) {
      e.t[roomName] = energy;
    }
  }

  trackRoomGrowth(e, roomName, storageEnergy(roomState) + terminalEnergy(roomState));
  trackGrowth(e, accrue(roomState));
}

/**
 * САЛЬДО ЭНЕРГИИ КОМНАТЫ — сколько энергии (склад + терминал) прибавилось
 * или убыло за окно. Это и есть критерий постановки задач на ДОСТАВКУ
 * энергии в структуры-потребители (фабрика, powerSpawn).
 *
 * Принцип задан владельцем 05.10.2026: «есть положительное сальдо по энергии
 * (хранилище-терминал) — создаётся задача завезти энергию на фабрику, то есть
 * задача создаётся только при УВЕЛИЧЕНИИ энергии в комнате; такой же принцип
 * и наполнения powerSpawn». Смысл: структура-потребитель ничего не знает ни о
 * складе, ни о терминале — она просто работает (фабрика: получила 600 энергии
 * -> произвела 50 батарей). Регулирует расход ЗАДАЧА, и она появляется лишь
 * тогда, когда в комнате образовался излишек.
 *
 * Побочный эффект, ради которого это и делается: как только энергия комнаты
 * перестала расти (в том числе потому, что её вывезли в фабрику), новые задачи
 * не ставятся — закачка останавливается сама. Живой дефект, который это
 * закрывает: fillFactoryEnergy возил энергию, пока в фабрике есть ЛЮБОЕ
 * свободное место (до 50 000), и склады упали 190-208k -> 152-173k.
 *
 * @param {Object} e Memory.econ
 * @param {string} roomName
 * @param {number} energy энергия комнаты (склад + терминал)
 */
function trackRoomGrowth(e, roomName, energy) {
  if (!e.rp) e.rp = {};
  if (!e.r) e.r = {};

  const prev = e.rp[roomName];

  if (!prev) {
    e.rp[roomName] = { t: Game.time, e: energy };
    e.r[roomName] = 0;
    return;
  }

  const dt = Game.time - prev.t;
  if (dt < ECON.GROWTH_WINDOW) return;

  e.r[roomName] = (energy - prev.e) / dt;
  e.rp[roomName] = { t: Game.time, e: energy };
}

/**
 * Сальдо энергии комнаты, энергии/тик. Больше нуля — энергия в комнате росла
 * за последнее окно, значит излишек есть и задачу на доставку ставить можно.
 *
 * @param {string} roomName
 * @returns {number}
 */
function roomGrowth(roomName) {
  const e = Memory.econ;
  return (e && e.r && e.r[roomName]) || 0;
}

/**
 * Пересчёт скорости роста раз в ECON.GROWTH_WINDOW тиков.
 *
 * Считается по ФАКТИЧЕСКОМУ запасу (accrue), а не по храповику: сумма
 * максимумов не меняется, пока запас не превысил прежний максимум, и
 * регулятор слепнет (см. комментарий к accrue).
 *
 * @param {Object} e Memory.econ
 * @param {number} total полная сумма запаса прошлого тика, -1 если её нет
 */
function trackGrowth(e, total) {
  if (total < 0) return;

  const g = e.g;

  if (!g) {
    e.g = { tick: Game.time, sum: total, rate: 0 };
    return;
  }

  const dt = Game.time - g.tick;
  if (dt < ECON.GROWTH_WINDOW) return;

  e.g = { tick: Game.time, sum: total, rate: (total - g.sum) / dt };
}

/**
 * Скорость роста империи по последнему замеру, энергии/тик.
 * Может быть отрицательной, если максимумы не обновлялись (запас не рос).
 *
 * @returns {number}
 */
function growthRate() {
  const e = Memory.econ;
  return (e && e.g && e.g.rate) || 0;
}

/**
 * Разрешены ли ОПЦИОНАЛЬНЫЕ стоки (фабрика, powerSpawn).
 *
 * Условие владельца «приход должен всегда опережать расход» проверяется по
 * факту: пока империя растёт не медленнее MIN_GROWTH_RATE, стоки могут
 * работать; как только рост просел — они выключаются, и запас восстанавливает
 * рост. При выключенной политике (Memory.econOff) возвращается true: тогда
 * работают прежние пороги генераторов, как до правки.
 *
 * @returns {boolean}
 */
function optionalAllowed() {
  if (!enabled()) return true;

  const e = Memory.econ;
  if (!e || !e.g) return false;

  return e.g.rate >= ECON.MIN_GROWTH_RATE;
}

/**
 * Можно ли опциональному стоку (фабрика, powerSpawn) совершить операцию.
 *
 * ОДНА точка правды для менеджеров структур (factory.manager.js,
 * powerSpawn.manager.js) и генераторов задач (task/gen.factory.js,
 * task/gen.powerSpawn.js). Раздельные проверки уже приводили к дефекту:
 * генераторы ограничивали доставку энергии, а менеджеры жгли то, что уже
 * лежало в структуре, и склады падали (живой замер tick 83461228: 22 400
 * батарей = 268 800 сожжённой энергии, склады 950 262 -> 920 207).
 *
 * Точка отката: при выключенной политике (Memory.econOff или
 * ECON.ENABLED = false) возвращается true — то есть стоки работают по своим
 * внутренним условиям, как до правки. Это важно: иначе «откат» оставил бы
 * порог свободных средств в силе и поведение НЕ вернулось бы к прежнему.
 *
 * @param {Object} roomState
 * @param {number} minFree минимум свободных средств склада для этого стока
 * @returns {boolean}
 */
function maySpendOptional(roomState, minFree) {
  if (!enabled()) return true;
  if (!optionalAllowed()) return false;
  return freeStorage(roomState) >= minFree;
}

/**
 * Терминал догнал свою долю (или в нём больше нет места под энергию).
 *
 * Разделение с hasFreeForTransfer нужно исполнителю задачи: «терминал уже
 * полон» — это ИСЧЕРПАНИЕ задачи (DONE), а «склад пока не может дать» —
 * это ПАУЗА (SKIP). С одним общим условием задача-зомби висела бы в очереди.
 *
 * @param {StructureStorage|null} storage
 * @param {StructureTerminal|null} terminal
 * @returns {boolean}
 */
function terminalReachedShare(storage, terminal) {
  if (!terminal) return true;
  if (terminal.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return true;
  return (terminal.store[RESOURCE_ENERGY] || 0) >= shareTargetOf(storage, terminal);
}

/**
 * Хватает ли свободных средств склада на полный рейс воркера.
 *
 * @param {StructureStorage|null} storage
 * @param {string} roomName
 * @returns {boolean}
 */
function hasFreeForTransfer(storage, roomName) {
  if (!storage) return false;
  return (
    (storage.store[RESOURCE_ENERGY] || 0) - storageFloor(roomName) >=
    ECON.MIN_TRANSFER_FREE
  );
}

/**
 * Можно ли ставить/исполнять перенос энергии из склада в терминал.
 *
 * Работает и в генераторе задачи (task/gen.terminal.js), и в её исполнителе
 * (task/exec.terminal.js) — по одной и той же функции, чтобы генератор и
 * исполнитель не разошлись в условиях (иначе задача либо ставится и
 * отбрасывается, либо не ставится никогда).
 *
 * Аргументы — объекты структур, а не roomState: у исполнителя roomState нет,
 * там есть только резолвнутые источник и цель.
 *
 * @param {StructureStorage|null} storage
 * @param {StructureTerminal|null} terminal
 * @param {string} roomName
 * @returns {boolean}
 */
function canFillTerminal(storage, terminal, roomName) {
  if (!storage || !terminal) return false;

  // ── ПРЕЖНЕЕ ПОВЕДЕНИЕ (точка отката) ───────────────────────────────────
  // Ровно те условия, что стояли в task/gen.terminal.js:32-40 и
  // task/exec.terminal.js:37-41 до правки.
  if (!enabled()) {
    if ((terminal.store[RESOURCE_ENERGY] || 0) >= TERMINAL_SUPPLY.ENERGY_TARGET) {
      return false;
    }
    return (
      (storage.store[RESOURCE_ENERGY] || 0) >
      STORAGE.ENERGY_MIN * TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER
    );
  }

  // ── ПОЛИТИКА РОСТА ─────────────────────────────────────────────────────
  // 1) доля: терминал растёт, пока не догнал свою долю общего запаса;
  // 2) источник: переносим только из СВОБОДНЫХ средств склада, и только
  //    если их хватает на полный рейс воркера (MIN_TRANSFER_FREE).
  if (terminalReachedShare(storage, terminal)) return false;

  return hasFreeForTransfer(storage, roomName);
}

module.exports = {
  enabled,
  observe,
  storageHighWater,
  terminalHighWater,
  storageFloor,
  freeStorage,
  terminalShareTarget,
  terminalReachedShare,
  hasFreeForTransfer,
  canFillTerminal,
  roomGrowth,
  growthRate,
  optionalAllowed,
  maySpendOptional,
};
