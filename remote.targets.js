/**
 * ===================================================
 * REMOTE.TARGETS.JS — room-зависимые цели дальних ролей
 * ===================================================
 * Дальний крип держит в памяти ID объектов, найденных в удалённой комнате:
 * источник, контейнер, площадку контейнера, выпавший ресурс. Это кэш ради CPU
 * (getObjectById ≈0.001 мс против findInRange по всей комнате).
 *
 * Проблема (живой shard3, 19.09.2026): remote.manager умеет ПЕРЕНАЗНАЧИТЬ
 * targetRoom живому крипу — так исправляется дубль, когда pre-spawn временно
 * создал третьего крипа при двух комнатах. Но ID в памяти оставались от
 * прежней комнаты, и роль уходила по ним обратно: хайлер
 * remoteHauler_E35S37_83084919, переназначенный на E35S38, держал
 * waitSourceId источника E36S37, стоял рядом с ним в E36S37 и в E35S38 не шёл
 * вовсе (восстановление только смертью крипа).
 *
 * Правило простое и обязательное для всех дальних ролей: объект из памяти
 * годится как цель, только если он СУЩЕСТВУЕТ и находится в текущей
 * targetRoom. Иначе запись удаляется, а цель ищется заново — уже в новой
 * комнате. Общий помощник держит это правило в одном месте, чтобы оно не
 * разъехалось между ролями (как разъехалось раньше: у контейнера проверка
 * комнаты была, у источника и выпавшего ресурса — нет).
 * ====================================
 */

/**
 * Объект по id, если он существует и лежит в указанной комнате.
 * @param {string} id
 * @param {string} roomName
 * @returns {any} объект или null
 */
function objectInRoom(id, roomName) {
  const object = id ? Game.getObjectById(id) : null;

  if (!object || !object.pos || object.pos.roomName !== roomName) return null;

  return object;
}

/**
 * Цель из creep.memory[key] для текущей комнаты.
 *
 * Возвращает объект, только если он существует и находится в roomName. Если
 * объект исчез или относится к покинутой комнате, запись из памяти удаляется
 * (чтобы роль не вернулась к ней на следующем тике) и возвращается null.
 *
 * @param {Object} creep
 * @param {string} key ключ в creep.memory
 * @param {string} roomName текущая targetRoom
 * @returns {any} объект или null
 */
function roomScopedTarget(creep, key, roomName) {
  const id = creep.memory[key];
  if (!id) return null;

  const object = objectInRoom(id, roomName);
  if (object) return object;

  delete creep.memory[key];
  return null;
}

module.exports = { roomScopedTarget };
