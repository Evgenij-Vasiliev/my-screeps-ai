/**
 * ===================================================
 * ROLE.LINKWORKER.JS — Рабочий линка
 * ===================================================
 * VERSION: 1.2
 *
 * Одна задача: линк у storage → storage.
 * Тело роли — в конфиге: CREEP_BODIES.linkWorker = {carry:4, move:1} (250).
 *
 * ── V1.1 (CPU, накладные расходы) ────────────────────────────────────────
 * Замер Memory.cpuStats.profile (1503 сэмпла, tick ~83172186; сейчас ролевые
 * замеры лежат в Memory.cpuStats.roles и включаются Memory.cpuMonitorRoles):
 * блок linkWorker
 * = 0.367 мс/тик, при том что работы почти нет (в линках 0–150 энергии при
 * LINK_CAPACITY 800). Цепочка `Memory.rooms[name].links.storage` читалась НА
 * КАЖДОМ тике, хотя id линка неизменен всю жизнь крипа. Теперь id кэшируется в
 * памяти крипа (как sourceId/linkId у майнера), конфиг комнаты перечитывается
 * только при промахе кэша (линк снесли/перестроили).
 *
 * ── V1.2 (CPU, движение) ─────────────────────────────────────────────────
 * Оставалась вторая статья расходов — движение. Роль стоит между линком и
 * storage, и если она оказывается на клетке, соседней только с одной из двух
 * целей, то каждый цикл ездит между ними: withdraw → ERR_NOT_IN_RANGE →
 * travelTo(storage) → transfer → ERR_NOT_IN_RANGE → travelTo(link) и так далее,
 * а каждый travelTo — это проход Traveler (ключ кэша, поиск пути).
 * Линк стоит ВПЛОТНУЮ к storage во всех пяти комнатах (живой замер: расстояние
 * 1 клетка), значит существует клетка, соседняя с ОБОИМИ. Роль её находит один
 * раз и закрепляется на ней (creep.memory.post); с неё withdraw и transfer
 * выполняются без движения вообще.
 *
 * Порядок действий намеренно такой: СНАЧАЛА попытка действия с текущей клетки, и
 * только если не достаём — идём на рабочую клетку. Иначе роль могла бы застрять:
 * рабочая клетка бывает занята другим крипом (через storage ходят все), а полный
 * линк блокирует добычу майнера.
 * ===================================================
 */

/**
 * Занята ли клетка непроходимой структурой. Дорога, контейнер и свой рампорт
 * проходимы, остальные постройки — нет.
 * @param {Room} room
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function blockedByStructure(room, x, y) {
  const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
  for (let i = 0; i < structures.length; i++) {
    const type = structures[i].structureType;
    if (
      type !== STRUCTURE_ROAD &&
      type !== STRUCTURE_CONTAINER &&
      type !== STRUCTURE_RAMPART
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Рабочая клетка: соседняя И с линком, И со storage. Перебираем 8 соседей линка —
 * этого достаточно, потому что линк стоит вплотную к storage, и общая клетка
 * всегда лежит среди соседей линка.
 * @param {Room} room
 * @param {Object} link
 * @param {Object} storage
 * @returns {{x: number, y: number}|null}
 */
function findPost(room, link, storage) {
  const terrain = room.getTerrain();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = link.pos.x + dx;
      const y = link.pos.y + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (
        Math.max(Math.abs(x - storage.pos.x), Math.abs(y - storage.pos.y)) > 1
      ) {
        continue;
      }
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (blockedByStructure(room, x, y)) continue;
      return { x: x, y: y };
    }
  }
  return null;
}

/**
 * Кэш рабочей клетки ещё годится? Линк могли снести и построить в другом месте.
 * @param {{x: number, y: number}} post
 * @param {Object} link
 * @param {Object} storage
 * @returns {boolean}
 */
function postFits(post, link, storage) {
  return (
    Math.max(Math.abs(post.x - link.pos.x), Math.abs(post.y - link.pos.y)) <= 1 &&
    Math.max(
      Math.abs(post.x - storage.pos.x),
      Math.abs(post.y - storage.pos.y),
    ) <= 1
  );
}

module.exports = {
  run: function (creep) {
    const room = creep.room;
    const storage = room.storage;
    if (!storage) return;

    // ── Линк: из кэша крипа, конфиг комнаты — только при промахе кэша ──────
    let storageLink = creep.memory.linkId
      ? Game.getObjectById(creep.memory.linkId)
      : null;

    if (!storageLink) {
      const roomMemory = (Memory.rooms && Memory.rooms[room.name]) || {};
      const config = roomMemory.links;
      const linkId =
        config && typeof config.storage === "string" ? config.storage : null;
      if (!linkId) return;
      creep.memory.linkId = linkId;
      storageLink = Game.getObjectById(linkId);
      if (!storageLink) return;
    }

    const empty = creep.store[RESOURCE_ENERGY] === 0;
    const linkEnergy = storageLink.store[RESOURCE_ENERGY] || 0;

    // Делать нечего: ни груза, ни энергии в линке — не двигаемся и не тратим интенты.
    if (empty && linkEnergy === 0) return;

    // 1) Действие доступно с текущей клетки — делаем сразу, без походов.
    const acted = empty
      ? creep.withdraw(storageLink, RESOURCE_ENERGY)
      : creep.transfer(storage, RESOURCE_ENERGY);

    if (acted === OK) return;
    // Не OK и не «далеко» (чужой ресурс в линке, полный storage) — штатное
    // состояние: роль просто ждёт следующего тика. Лог в горячем пути не нужен.
    if (acted !== ERR_NOT_IN_RANGE) return;

    // 2) Не достаём — становимся на рабочую клетку, откуда достают обе операции.
    let post = creep.memory.post;
    if (post && !postFits(post, storageLink, storage)) {
      delete creep.memory.post; // линк перестроили — кэш протух
      post = null;
    }
    if (!post) {
      post = findPost(room, storageLink, storage);
      if (post) creep.memory.post = post;
    }
    if (post) {
      creep.travelTo(new RoomPosition(post.x, post.y, room.name));
      return;
    }

    // 3) Рабочей клетки нет (нестандартная раскладка комнаты) — прежний путь.
    creep.travelTo(empty ? storageLink : storage);
  },
};
