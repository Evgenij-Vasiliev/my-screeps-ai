/**
 * РЕЕСТР СПЕЦИАЛИЗАЦИЙ КОМНАТ (Room Roles Registry)
 *
 * ЕДИНСТВЕННОЕ место в кодовой базе, где определяются строковые литералы
 * специализаций. Все остальные модули импортируют константы отсюда —
 * прямое использование строк ("core", "support" и т.д.) за пределами
 * этого файла запрещено архитектурным правилом.
 *
 * Назначение специализации через консоль Screeps:
 *   Game.rooms["W1N1"].memory.role = "core";
 *   Game.rooms["W2N1"].memory.role = "support";
 */

const ROOM_ROLES = {
  /** Главная комната империи: спавн, хранилище, основная экономика */
  CORE: "core",

  /** Вспомогательная комната: добыча, поддержка core */
  SUPPORT: "support",

  /** Удалённая комната для добычи ресурсов без постоянного контроллера */
  REMOTE: "remote",

  /** Недавно захваченная комната, находящаяся в процессе развития */
  EXPANSION: "expansion",

  /** Специализация не назначена (значение по умолчанию) */
  UNDEFINED: "undefined",
};

/**
 * Множество допустимых значений для быстрой валидации.
 * @type {Set<string>}
 */
const VALID_ROLES = new Set(Object.values(ROOM_ROLES));

/**
 * Возвращает специализацию комнаты из её памяти.
 * Если значение отсутствует или не входит в реестр — возвращает UNDEFINED.
 *
 * @param {Room} room
 * @returns {string} одна из констант ROOM_ROLES
 */
function getRoomRole(room) {
  const stored = room.memory.role;
  if (stored && VALID_ROLES.has(stored)) {
    return stored;
  }
  return ROOM_ROLES.UNDEFINED;
}

module.exports = { ROOM_ROLES, getRoomRole };
