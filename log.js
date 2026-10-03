/**
 * ===================================================
 * LOG.JS — логи горячих путей: без спама и без цены в обычном тике
 * ===================================================
 * Задача 10 оценки 25.09.2026: прибрать console.log из горячих путей ролей.
 * В Screeps тарифицируется САМ вывод, поэтому лог, который печатается на
 * каждом тике (или на каждом крипе), — это прямой расход CPU. Удалить совсем
 * можно не всё: исключение в роли или нештатный ответ API полезно видеть.
 * Для таких мест здесь два режима:
 *
 *   warnOnce(key, message)      — одна строка на ключ за сессию. Кэш в heap
 *                                 (`global`), а не в Memory: запись в Memory
 *                                 каждый тик держала бы её «грязной», а после
 *                                 global reset предупреждение повторится —
 *                                 это ожидаемо.
 *   warnThrottled(key, message) — не чаще одного раза в THROTTLE_INTERVAL
 *                                 тиков на ключ. Для состояния, которое живёт
 *                                 долго (сломанная подсистема), лучше редкая
 *                                 строка, чем молчание warnOnce.
 *
 * КЛЮЧ ОБЯЗАН БЫТЬ ОГРАНИЧЕННЫМ: комната, подсистема, роль. Имя крипа как
 * ключ запрещено — имена живут в куче до global reset, и уникальный ключ на
 * каждого крипа превратил бы защиту от спама в утечку heap.
 *
 * `message` — строка ИЛИ функция. Функцию helper вызывает ТОЛЬКО когда лог
 * действительно печатается, поэтому шаблонная строка (и, например, `e.stack`)
 * не строится в подавленном тике.
 *
 * Цена в обычном тике — одно обращение к `global` и сравнение `Game.time`;
 * сам `console.log` не вызывается. Модуль не тянет constants и не имеет
 * побочных эффектов при загрузке.
 * ===================================================
 */

/** Раз в сколько тиков максимум печатает warnThrottled по одному ключу. */
const THROTTLE_INTERVAL = 100;

/**
 * Ленивая инициализация heap-состояния: после global reset оно пусто, и
 * первый же вызов собирает его заново.
 * @returns {{once: Object<string, boolean>, throttled: Object<string, number>}}
 */
function state() {
  let s = global._logLimiter;
  if (!s) {
    s = global._logLimiter = { once: {}, throttled: {} };
  }
  return s;
}

/**
 * @param {string|Function} message
 * @returns {string}
 */
function resolve(message) {
  return typeof message === "function" ? message() : message;
}

/**
 * Печатает сообщение не более одного раза за сессию.
 * @param {string} key ограниченный ключ (комната/подсистема/роль)
 * @param {string|Function} message
 * @returns {boolean} печатали ли строку
 */
function warnOnce(key, message) {
  const s = state();
  if (s.once[key]) return false;
  s.once[key] = true;
  console.log(resolve(message));
  return true;
}

/**
 * Печатает сообщение не чаще одного раза в `interval` тиков на ключ.
 * @param {string} key ограниченный ключ (комната/подсистема/роль)
 * @param {string|Function} message
 * @param {number} [interval] по умолчанию THROTTLE_INTERVAL
 * @returns {boolean} печатали ли строку
 */
function warnThrottled(key, message, interval) {
  const s = state();
  const every = interval === undefined ? THROTTLE_INTERVAL : interval;
  const last = s.throttled[key];
  if (last !== undefined && Game.time - last < every) return false;
  s.throttled[key] = Game.time;
  console.log(resolve(message));
  return true;
}

module.exports = { warnOnce, warnThrottled, THROTTLE_INTERVAL };
