/**
 * ===================================================
 * MANAGER.REMOTE.JS — Менеджер дальней добычи
 * ===================================================
 * Резервер, дальний майнер и дальний хайлер распределяются по комнатам и
 * запускают свою ролевую логику.
 *
 * Список удалённых комнат — constants.REMOTE.ROOMS (одна точка правды).
 *
 * ── ЕДИНСТВЕННАЯ ТОЧКА ПОЛИТИКИ ──────────────────────────────────────────
 * Ни одна дальняя роль не выбирает targetRoom сама (никакого хэша по имени,
 * никакого выбора комнаты в роли). Политика ровно из трёх правил:
 *
 *   обычный новый creep:  есть свободная remote-комната → назначить её;
 *   replacement creep:    уходящий creep той же роли связан с ним
 *                         (remote.handoff) → унаследовать его targetRoom,
 *                         даже если комната ещё занята уходящим;
 *   ни того, ни другого:  targetRoom остаётся null — крип ждёт.
 *
 * Двое одной роли на одной комнате допустимы ТОЛЬКО как подтверждённая пара
 * «уходящий + его замена». Всё остальное — дубль, и он лечится: лишнего
 * переводим в свободную комнату, а если свободной нет — он ждёт.
 *
 * ── ЧТО БЫЛО СЛОМАНО ─────────────────────────────────────────────────────
 * Пре-спавн ставил замену за 150–220 тиков до смерти предшественника, но
 * свободных комнат не было (квота 2 = комнат 2), поэтому замена получала
 * targetRoom = null и ждала смерти старого крипа. Для remoteMiner это
 * означало простой источника: спавн 54 тика + дорога 82 тика ПОСЛЕ смерти
 * (замер пути — tests/live.dump.geometry.js), ~136 тиков без добычи. Теперь
 * комната передаётся по связке сразу после выхода замены из спавна, и замена
 * идёт в неё, пока предшественник ещё жив.
 *
 * Кэш имён ролей: пересобирается, когда изменилось число крипов в империи
 * или прошло REMOTE_CACHE_MAX_AGE тиков. Дешёвая проверка по количеству
 * сознательно оставлена как есть (разбор — docs/REMOTE-CPU-OPTIMIZATION.md,
 * раздел 6: у блока remoteManager на менеджер приходится меньше 3 % CPU,
 * а корректная инвалидация «по набору имён» стоит дороже — это отдельная
 * задача 10 в docs/PROJECT_AUDIT_AND_ROADMAP.md).
 * ===================================================
 */

const roleReserver = require("remote.reserver");
const roleRemoteMiner = require("remote.miner");
const roleRemoteHauler = require("remote.hauler");
const { activePairs, cleanupStaleHandoff } = require("remote.handoff");
const { REMOTE } = require("./constants");

/**
 * Раздаёт targetRoom всем крипам роли — единственное место, где эта память
 * пишется для дальних ролей.
 *
 * Правила (в этом порядке):
 *  1. Битая память (комната не из REMOTE.ROOMS) — снимается.
 *  2. Валидная пара замены (уходящий + его замена) держит ОДНУ комнату на
 *     двоих: замена наследует targetRoom уходящего и идёт в путь, пока он ещё
 *     жив. Двое на комнате здесь — не дубль, а передача смены. Наследование
 *     идёт ДО подсчёта хозяев, поэтому прежняя комната замены (если она была)
 *     освобождается сама.
 *  3. Комнату, за которую держатся несколько крипов, держит один — уходящий
 *     (он передаёт её замене) либо тот, кому раньше умирать. Так же лечится и
 *     уже испорченное распределение.
 *  4. Всем, у кого комнаты нет (замена без пары, обычный новый крип,
 *     вытесненный дубль), достаются свободные комнаты — по одной на комнату.
 *     Кому не хватило, targetRoom остаётся null: крип ждёт освобождения.
 *
 * Инвариант: одну комнату держат не больше слотов роли (REMOTE.HAULERS_PER_ROOM
 * для хаулера, 1 для остальных), где подтверждённая пара «уходящий + замена»
 * занимает ОДИН слот. Живых крипов в роли не больше, чем «число комнат × слоты
 * + число пар»; лишние ждут без комнаты.
 *
 * @param {string} role
 * @param {Object[]} creeps живые крипы роли
 */
function assignTargetRoom(role, creeps) {
  // Висящая связка (замена так и не вышла из спавна) снимается ДО разбора
  // пар: иначе крип остался бы «связанным» навсегда и без замены.
  cleanupStaleHandoff(role, creeps);

  const { pairs } = activePairs(role, creeps);

  // Кто участвует в замене: пара держит ОДНУ комнату на двоих, и это не дубль.
  const inPair = {};
  for (let i = 0; i < pairs.length; i++) {
    inPair[pairs[i].leaving.name] = true;
    inPair[pairs[i].successor.name] = true;
  }

  // Сколько крипов роли держат одну комнату. Остальные роли — по одному, как
  // раньше; у хаулера слотов REMOTE.HAULERS_PER_ROOM, потому что вывоз за рейс
  // упирается в ёмкость линка-приёмника (800) и один хаулер удалённый источник
  // (10/тик) не покрывает (расчёт — в константе).
  const maxHolders = role === "remoteHauler" ? REMOTE.HAULERS_PER_ROOM : 1;

  // Раскладка по комнатам: пока крипов не больше, чем комнат, держим по одному на
  // комнату (пустая удалённая комната без вывоза — хуже, чем недобор второго
  // слота); вторые слоты включаются только когда крипов больше, чем комнат.
  // Иначе два хаулера садились бы в одну комнату, оставляя вторую без хаулера.
  const perRoom = Math.min(
    maxHolders,
    Math.max(1, Math.ceil(creeps.length / REMOTE.ROOMS.length)),
  );

  // Слоты комнаты: обычный держатель — слот, пара «уходящий + замена» — один
  // слот на двоих (как и раньше в подсчёте хозяев).
  const slotsUsed = list => {
    let hasPair = false;
    let count = 0;
    for (let i = 0; i < list.length; i++) {
      if (inPair[list[i].name]) hasPair = true;
      else count++;
    }
    return count + (hasPair ? 1 : 0);
  };

  // 1. Битая память (комната не из REMOTE.ROOMS) — снимаем.
  for (let i = 0; i < creeps.length; i++) {
    const room = creeps[i].memory.targetRoom;
    if (room && REMOTE.ROOMS.indexOf(room) === -1) {
      creeps[i].memory.targetRoom = null;
    }
  }

  // 2. Наследование: замена получает комнату уходящего. Делается ДО подсчёта
  // претендентов, поэтому её прежняя комната (если была) освобождается сама.
  for (let i = 0; i < pairs.length; i++) {
    const leaving = pairs[i].leaving;
    const successor = pairs[i].successor;
    if (leaving.memory.targetRoom) {
      if (successor.memory.targetRoom !== leaving.memory.targetRoom) {
        // Строка в консоли — живое доказательство handoff-а: замена уходит в
        // удалённую комнату ЗАРАНЕЕ, ещё при живом предшественнике.
        console.log(
          `HANDOFF: ${successor.name} наследует ${leaving.memory.targetRoom} ` +
            `у ${leaving.name} (ttl ${leaving.ticksToLive})`,
        );
      }
      successor.memory.targetRoom = leaving.memory.targetRoom;
    }
  }

  // 3. Кто держит комнаты сейчас. Пара считается за одного: replacement
  // наследует комнату уходящего, а не занимает вторую.
  const freeRooms = [];
  const holders = {}; // комната → список крипов, которые её держат
  const unassigned = [];

  for (let i = 0; i < creeps.length; i++) {
    const creep = creeps[i];
    const room = creep.memory.targetRoom;

    if (!room) {
      unassigned.push(creep);
      continue;
    }

    if (inPair[creep.name]) {
      if (!holders[room]) holders[room] = [];
      if (holders[room].indexOf(creep) === -1) holders[room].push(creep);
      continue;
    }

    // Обычный крип: занимает слот, если он есть (у хаулера слотов больше одного).
    if (!holders[room]) holders[room] = [];
    if (slotsUsed(holders[room]) < perRoom) holders[room].push(creep);
    else unassigned.push(creep);
  }

  // 5. Свободные слоты комнат, порядок «по слотам»: сначала по одному слоту в
  // каждую комнату, затем вторые. Иначе оба свободных места достались бы первой
  // комнате (у хаулера слотов HAULERS_PER_ROOM).
  for (let slot = 0; slot < perRoom; slot++) {
    for (let i = 0; i < REMOTE.ROOMS.length; i++) {
      const room = REMOTE.ROOMS[i];
      if (slotsUsed(holders[room] || []) <= slot) freeRooms.push(room);
    }
  }

  /**
   * Отдаёт свободный слот, если он есть; иначе сбрасывает targetRoom.
   * @param {Object} creep
   * @returns {boolean}
   */
  const takeFreeRoom = creep => {
    if (freeRooms.length === 0) {
      creep.memory.targetRoom = null;
      return false;
    }

    creep.memory.targetRoom = freeRooms.shift();
    return true;
  };

  // 4. Вытеснение из общих комнат: у комнаты maxHolders слотов. Держат их
  // первыми по приоритету — уходящий (он передаёт комнату замене) либо тот,
  // кому раньше умирать; лишние освобождаются и ждут. Вытесненные сразу
  // убираются из holders, иначе шаг 6 не увидел бы освободившийся слот.
  for (let i = 0; i < REMOTE.ROOMS.length; i++) {
    const room = REMOTE.ROOMS[i];
    const list = holders[room] || [];
    if (slotsUsed(list) <= perRoom) continue;

    list.sort(byRoomOwnerPriority);
    let free = perRoom - (list.some(c => inPair[c.name]) ? 1 : 0);
    const kept = [];

    for (let k = 0; k < list.length; k++) {
      const creep = list[k];
      if (inPair[creep.name]) {
        kept.push(creep); // пара «уходящий + замена» не выселяется
        continue;
      }
      if (free > 0) {
        free--;
        kept.push(creep);
        continue;
      }
      creep.memory.targetRoom = null;
      unassigned.push(creep);
    }

    holders[room] = kept;
  }

  // 5. Раздача свободных слотов: сначала тем, кто ждал назначения, потом
  // вытесненным. Кому не хватило — targetRoom = null, крип ждёт освобождения.
  for (let i = 0; i < unassigned.length; i++) {
    takeFreeRoom(unassigned[i]);
  }
}

/**
 * Приоритет крипа на комнату: меньшее значение — больше прав её держать.
 * Уходящий крип передаёт комнату замене, поэтому он неприкосновенен; для
 * остальных выигрывает тот, кому раньше умирать (после его смерти комната всё
 * равно освободится), затем — стабильный порядок по имени (иначе «кто первый
 * в Game.creeps» решал бы судьбу комнаты).
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
function byRoomOwnerPriority(a, b) {
  const pa = roomOwnerPriority(a);
  const pb = roomOwnerPriority(b);
  if (pa !== pb) return pa - pb;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * @param {Object} creep
 * @returns {number}
 */
function roomOwnerPriority(creep) {
  if (creep.memory[REMOTE.HANDOFF_TO]) return -1;
  const ttl = creep.ticksToLive;
  if (typeof ttl !== "number") return 1e6;
  return ttl;
}

module.exports = {
  run: function () {
    const REMOTE_CACHE_MAX_AGE = 50; // тиков — максимум устаревания кэша

    // Инициализация глобального кэша (самопосборка после Global Reset)
    if (!global._remoteRoleCache) {
      global._remoteRoleCache = { reservers: [], remoteMiners: [], remoteHaulers: [] };
      global._remoteRoleCacheCount = 0;
      global._remoteRoleCacheUpdatedAt = 0;
    }

    const creepNames = Object.keys(Game.creeps);

    if (
      !global._remoteRoleCache ||
      global._remoteRoleCacheCount !== creepNames.length ||
      Game.time - (global._remoteRoleCacheUpdatedAt || 0) > REMOTE_CACHE_MAX_AGE
    ) {
      const reservers = [];
      const remoteMiners = [];
      const remoteHaulers = [];

      for (const name of creepNames) {
        const role = Game.creeps[name].memory.role;
        if (role === "reserver") reservers.push(name);
        else if (role === "remoteMiner") remoteMiners.push(name);
        else if (role === "remoteHauler") remoteHaulers.push(name);
      }

      global._remoteRoleCache = { reservers, remoteMiners, remoteHaulers };
      global._remoteRoleCacheCount = creepNames.length;
      global._remoteRoleCacheUpdatedAt = Game.time;
    }
    const cache = global._remoteRoleCache;

    const reservers = cache.reservers
      .map(name => Game.creeps[name])
      .filter(Boolean);
    const remoteMiners = cache.remoteMiners
      .map(name => Game.creeps[name])
      .filter(Boolean);
    const remoteHaulers = cache.remoteHaulers
      .map(name => Game.creeps[name])
      .filter(Boolean);

    assignTargetRoom("reserver", reservers);
    for (const creep of reservers) roleReserver.run(creep);

    assignTargetRoom("remoteMiner", remoteMiners);
    for (const creep of remoteMiners) roleRemoteMiner.run(creep);

    assignTargetRoom("remoteHauler", remoteHaulers);
    for (const creep of remoteHaulers) roleRemoteHauler.run(creep);
  },
};
