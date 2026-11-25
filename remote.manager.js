/**
 * ===================================================
 * REMOTE.MANAGER.JS — назначение удалённой комнаты дальним ролям
 * ===================================================
 * Резервер, дальний майнер и дальний хайлер работают в УДАЛЁННОЙ комнате, и
 * выбирать её сами они не имеют права. Этот менеджер — единственное место, где
 * пишется creep.memory.targetRoom.
 *
 * ЧЕГО ЗДЕСЬ НЕТ (сознательно, отличие от origin/Новая-Империя:remote.manager.js):
 *   - РОЛИ НЕ ЗАПУСКАЮТСЯ. В старой ветке remote.manager вызывал
 *     roleReserver.run/roleRemoteMiner.run/roleRemoteHauler.run сам, то есть был
 *     вторым диспетчером рядом с room.manager. Здесь роли запускает только
 *     room.manager (карта ROLES + systems[role]), а менеджер занимается ровно
 *     одной задачей — раздать targetRoom. Иначе один и тот же крип исполнялся бы
 *     дважды за тик (ровно тот дефект, что был у room.manager с группировкой по
 *     homeRoom, room.manager.js:729-733).
 *   - Memory.empire (shard.state.js) и кэш имён ролей в heap. Список комнат —
 *     REMOTE.ROOMS (constants.js); кэш не нужен, потому что проход по Game.creeps
 *     всё равно один и дешёвый, а инвалидация по количеству крипов могла
 *     «протухнуть» на десятки тиков (старая ветка: REMOTE_CACHE_MAX_AGE = 50).
 *
 * ── ЕДИНСТВЕННАЯ ТОЧКА ПОЛИТИКИ ──────────────────────────────────────────
 * Ни одна дальняя роль не выбирает targetRoom сама (никакого хэша по имени,
 * никакого выбора комнаты в роли). Политика ровно из трёх правил:
 *
 *   обычный новый creep:  есть свободный слот remote-комнаты → назначить его;
 *   replacement creep:    уходящий creep той же роли связан с ним
 *                         (remote.handoff) → унаследовать его targetRoom, даже
 *                         если комната ещё занята уходящим;
 *   ни того, ни другого:  targetRoom остаётся null — крип ждёт.
 *
 * Двое одной роли на одной комнате допустимы ТОЛЬКО как подтверждённая пара
 * «уходящий + его замена». Всё остальное — дубль, и он лечится: лишнего
 * переводим в свободную комнату, а если свободной нет — он ждёт.
 *
 * ── ЧТО БЫЛО СЛОМАНО (история правки, старая ветка) ──────────────────────
 * Пре-спавн ставил замену за 166-196 тиков до смерти предшественника, но
 * свободных комнат не было (квота = число комнат × слоты), поэтому замена
 * получала targetRoom = null и ждала смерти старого крипа. Для remoteMiner это
 * означало простой источника: спавн 54 тика + дорога 82 тика ПОСЛЕ смерти, то
 * есть ~136 тиков без добычи. Теперь комната передаётся по связке сразу после
 * выхода замены из спавна, и замена идёт в неё, пока предшественник ещё жив.
 * ===================================
 */

const { activePairs, cleanupStaleHandoff } = require("remote.handoff");
const { REMOTE } = require("./constants");

/**
 * Приоритет крипа на комнату: меньшее значение — больше прав её держать.
 * Уходящий крип передаёт комнату замене, поэтому он неприкосновенен; для
 * остальных выигрывает тот, кому раньше умирать (после его смерти комната всё
 * равно освободится), затем — стабильный порядок по имени (иначе «кто первый в
 * Game.creeps» решал бы судьбу комнаты).
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

/**
 * Сколько слотов комнаты роли занято списком крипов. Подтверждённая пара
 * «уходящий + замена» занимает ОДИН слот, сколько бы из её двоих ни попало в
 * список.
 * @param {Object[]} list
 * @param {Object} inPair имя крипа → true
 * @returns {number}
 */
function slotsUsed(list, inPair) {
  let hasPair = false;
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    if (inPair[list[i].name]) hasPair = true;
    else count++;
  }
  return count + (hasPair ? 1 : 0);
}

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
 *  4. Всем, у кого комнаты нет (замена без пары, обычный новый крип, вытесненный
 *     дубль), достаются свободные слоты — по одному за проход по комнатам.
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
  // Висящая связка (замена так и не вышла из спавна) снимается ДО разбора пар:
  // иначе крип остался бы «связанным» навсегда и без замены.
  cleanupStaleHandoff(role, creeps);

  // Настроенный список удалённых комнат — один раз на роль.
  const remoteRooms = REMOTE.ROOMS;
  const roomCount = remoteRooms.length;

  const pairs = activePairs(role, creeps).pairs;

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

  // Раскладка по комнатам: пока крипов не больше, чем комнат, держим по одному
  // на комнату (пустая удалённая комната без вывоза хуже, чем недобор второго
  // слота); вторые слоты включаются только когда крипов больше, чем комнат.
  // Иначе два хаулера садились бы в одну комнату, оставляя вторую без хаулера.
  // Пустой список комнат (контур выключен) — слотов нет, все крипы остаются с
  // targetRoom = null и ждут. Без этой ветки деление на ноль дало бы Infinity.
  const perRoom =
    roomCount === 0
      ? 0
      : Math.min(maxHolders, Math.max(1, Math.ceil(creeps.length / roomCount)));

  // 1. Битая память (комната не из REMOTE.ROOMS) — снимаем.
  for (let i = 0; i < creeps.length; i++) {
    const room = creeps[i].memory.targetRoom;
    if (room && remoteRooms.indexOf(room) === -1) {
      creeps[i].memory.targetRoom = null;
    }
  }

  // 2. Наследование: замена получает комнату уходящего. Делается ДО подсчёта
  // претендентов, поэтому её прежняя комната (если была) освобождается сама.
  for (let i = 0; i < pairs.length; i++) {
    const leaving = pairs[i].leaving;
    const successor = pairs[i].successor;
    if (!leaving.memory.targetRoom) continue;

    if (successor.memory.targetRoom !== leaving.memory.targetRoom) {
      // Одна строка на связку (не на тик) — живое доказательство handoff-а:
      // замена уходит в удалённую комнату ЗАРАНЕЕ, ещё при живом предшественнике.
      console.log(
        `HANDOFF: ${successor.name} наследует ${leaving.memory.targetRoom} ` +
          `у ${leaving.name} (ttl ${leaving.ticksToLive})`,
      );
      successor.memory.targetRoom = leaving.memory.targetRoom;
    }
  }

  // 3. Кто держит комнаты сейчас: ВСЕ, у кого targetRoom не пуст. Пара
  // считается за одного — replacement наследует комнату уходящего, а не
  // занимает вторую.
  //
  // Отличие от старой ветки (и почему): там крип сверх лимита комнаты попадал
  // в список «без комнаты» СРАЗУ, здесь — в holders своей комнаты, а лишних
  // отсекает шаг 4. Это не косметика, а лечение найденного дефекта: в старом
  // порядке вытесняемый мог оказаться в списке ожидания вместе с
  // ПРОИГРАВШИМ, и распределение обнуляло комнату обоим — двое оставались без
  // комнаты на тик (пересчёт на следующем тике это лечил, но тик удалённая
  // комната стояла без работника).
  const holders = {}; // комната → список крипов, которые её держат
  const unassigned = [];

  for (let i = 0; i < creeps.length; i++) {
    const creep = creeps[i];
    const room = creep.memory.targetRoom;

    if (!room) {
      unassigned.push(creep);
      continue;
    }

    if (!holders[room]) holders[room] = [];
    holders[room].push(creep);
  }

  // 4. Вытеснение из общих комнат: у комнаты perRoom слотов. Держат их первыми
  // по приоритету — уходящий (он передаёт комнату замене) либо тот, кому раньше
  // умирать; лишние освобождаются и ждут свободного слота.
  for (let i = 0; i < roomCount; i++) {
    const room = remoteRooms[i];
    const list = holders[room];
    if (!list || list.length === 0) continue;
    if (slotsUsed(list, inPair) <= perRoom) continue;

    list.sort(byRoomOwnerPriority);
    // Пара не выселяется никогда и занимает один слот из perRoom.
    let free = perRoom - (list.some(c => inPair[c.name]) ? 1 : 0);

    for (let k = 0; k < list.length; k++) {
      const creep = list[k];
      if (inPair[creep.name]) continue; // пара «уходящий + замена»
      if (free > 0) {
        free--;
        continue;
      }
      if (creep.memory.targetRoom !== null) creep.memory.targetRoom = null;
      unassigned.push(creep);
    }
  }

  // 5. Свободные слоты комнат — ПОСЛЕ вытеснения (иначе список был бы посчитан
  // по переполненным комнатам). Порядок «по слотам»: сначала по одному слоту в
  // каждую комнату, затем вторые. Иначе оба свободных места достались бы первой
  // комнате (у хаулера слотов HAULERS_PER_ROOM).
  const freeSlots = [];
  for (let slot = 0; slot < perRoom; slot++) {
    for (let i = 0; i < roomCount; i++) {
      const room = remoteRooms[i];
      if (slotsUsed(holders[room] || [], inPair) <= slot) freeSlots.push(room);
    }
  }

  /**
   * Отдаёт свободный слот, если он есть; иначе сбрасывает targetRoom.
   * Запись — только при изменении значения (правило 8 tests/rules.test.js):
   * перезапись того же null — это лишняя «грязь» в Memory каждый тик.
   * @param {Object} creep
   */
  const takeFreeRoom = creep => {
    if (freeSlots.length === 0) {
      if (creep.memory.targetRoom !== null) creep.memory.targetRoom = null;
      return;
    }

    const room = freeSlots.shift();
    if (creep.memory.targetRoom !== room) creep.memory.targetRoom = room;
  };

  // 6. Раздача свободных слотов: кто остался без комнаты (новый крип, замена
  // без пары, вытесненный дубль). Кому слотов не хватило — targetRoom = null,
  // крип ждёт освобождения.
  for (let i = 0; i < unassigned.length; i++) {
    takeFreeRoom(unassigned[i]);
  }
}

module.exports = {
  assignTargetRoom,

  /**
   * Один проход по Game.creeps: три списка по memory.role, затем раздача
   * комнаты каждой роли. Запускается из empire.js ДО roomManager.run(), чтобы
   * роли в этом же тике уже видели свежий targetRoom.
   */
  run: function () {
    const reservers = [];
    const remoteMiners = [];
    const remoteHaulers = [];

    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (!creep || !creep.memory) continue;

      const role = creep.memory.role;
      if (role === "reserver") reservers.push(creep);
      else if (role === "remoteMiner") remoteMiners.push(creep);
      else if (role === "remoteHauler") remoteHaulers.push(creep);
    }

    assignTargetRoom("reserver", reservers);
    assignTargetRoom("remoteMiner", remoteMiners);
    assignTargetRoom("remoteHauler", remoteHaulers);
  },
};
