/**
 * ===================================================
 * REMOTE.HANDOFF.JS — связка «уходящий крип → его замена»
 * ===================================================
 * ЗАДАЧА
 * Раньше пре-спавн ставил замену ДО смерти предшественника, но замене не
 * доставалось удалённой комнаты: обе комнаты ещё были заняты (квота 2 = число
 * комнат 2), assignTargetRoom не находил свободной и оставлял targetRoom
 * пустым. Замена ждала смерти предшественника — и только потом начинала путь.
 * Для remoteMiner это окно простоя источника: спавн 54 тика + дорога 82 тика
 * ПОСЛЕ смерти (замер пути — tests/live.dump.geometry.js), то есть ~136 тиков
 * без добычи; у remoteHauler — 120 тиков у спавна в ожидании комнаты.
 *
 * РЕШЕНИЕ — replacement handoff
 * Замена и предшественник связываются ЯВНО, по именам, в момент запуска
 * спавна (эту связку ставит spawn.manager, когда решает поставить замену):
 *
 *   уходящий creep: memory.handoffTo   = имя замены
 *   замена:         memory.handoffFrom = имя уходящего
 *
 * Связка даёт три вещи:
 *   1) замена наследует targetRoom уходящего СРАЗУ после выхода из спавна (в
 *      тот же тик, рукой remote.manager) и идёт в удалённую комнату, пока
 *      предшественник ещё жив;
 *   2) временные «двое одной роли в одной комнате» перестают считаться
 *      дублем — но только для подтверждённой пары;
 *   3) выбора комнаты в роли по-прежнему нет: комнату раздаёт только
 *      remote.manager, а связка лишь сообщает ему, чью комнату наследовать.
 *
 * ИНВАРИАНТЫ (и что их защищает)
 *  - у одного уходящего не больше одной замены: предSpawnCandidates пропускает
 *    всех, у кого уже есть незавершённая связка (handoffTo на живого крипа);
 *  - связка ставится только крипу, дожившему до порога пре-спавна: иначе это
 *    не «уходящий», а полноценный работник;
 *  - пара подтверждается С ДВУХ СТОРОН (обе записи указывают друг на друга),
 *    поэтому третья роль не может «унаследовать» чужую замену;
 *  - замена остаётся заменой: она ПОЛУЧАЕТ комнату уходящего, но сама никому
 *    её не передаёт, пока не станет обычным работником (handoffFrom снимается,
 *    когда предшественник умер);
 *  - висящая связка (спавн замены не удался) распускается по таймауту
 *    (cleanupStaleHandoff): иначе уходящий остался бы без замены навсегда;
 *  - нет связки — нет наследования: замена получает свободную комнату как
 *    любой новый крип, а если свободных нет — ждёт с targetRoom = null.
 * ===================================
 */

const { REMOTE } = require("./constants");
const shardState = require("./shard.state");

/**
 * Порог пре-спавна роли. Для дальних ролей он считается от НАСТРОЙКИ в Memory
 * (shard.state.preSpawnThreshold: список комнат + маршруты + запас), для
 * остальных — плоская константа PRESPAWN_THRESHOLD. Раньше здесь стоял
 * constants.PRESPAWN_THRESHOLD[role], и правка списка комнат в Memory не
 * меняла порог.
 * @param {string} role
 * @returns {number|undefined}
 */
function thresholdOf(role) {
  return shardState.preSpawnThreshold(role);
}

/**
 * Сколько тиков запись handoffTo может указывать на крипа, которого ещё нет
 * в Game.creeps: столько идёт самый долгий спавн роли плюс запас (100 %) —
 * заведомо больше, чем спавн любого дальнего крипа (максимум 120 тиков).
 * @param {string} role
 * @returns {number}
 */
function pendingTtl(role) {
  const threshold = thresholdOf(role) || 0;
  return threshold * 2;
}

/**
 * Крип дожил до порога пре-спавна: он ещё жив, но его место уже можно
 * открывать под замену (spawn.manager, countRole).
 *
 * Спавнящийся крип (ticksToLive === undefined) кандидатом НЕ считается: он и
 * есть та самая замена — иначе спавнер ставил бы по дублю на каждом тике
 * спавна.
 *
 * @param {Object} creep
 * @param {number|undefined} threshold порог роли
 * @returns {boolean}
 */
function isPreSpawnCandidate(creep, threshold) {
  return (
    threshold !== undefined &&
    creep.ticksToLive !== undefined &&
    creep.ticksToLive <= threshold
  );
}

/**
 * Запись `handoffTo` ещё «в силе»: замена либо уже живёт в игре (спавн
 * удался), либо спавнится прямо сейчас (имя станет живым в пределах
 * pendingTtl). Иначе запись висячая — спавн не удался, замены не будет.
 *
 * @param {Object} creep уходящий крип
 * @param {number} maxPendingAge
 * @returns {boolean}
 */
function hasPendingSuccessor(creep, maxPendingAge) {
  const boundName = creep.memory[REMOTE.HANDOFF_TO];
  if (!boundName) return false;
  if (Game.creeps[boundName]) return true;

  const boundAt = creep.memory[REMOTE.HANDOFF_AT];
  // Запись без тика (память прошлой версии) считаем в силе: распустит её
  // только явная проверка пары в activePairs.
  if (typeof boundAt !== "number") return true;

  return Game.time - boundAt <= maxPendingAge;
}

/**
 * Крипы роли из домашней комнаты, чью замену ещё не поставили: дожили до
 * порога пре-спавна и не участвуют в незавершённой связке. Сортировка — по
 * возрастанию ticksToLive: первым заменяется тот, кто умрёт раньше всех.
 *
 * @param {Object[]} creeps
 * @param {string} role
 * @returns {Object[]}
 */
function preSpawnCandidates(creeps, role) {
  const threshold = thresholdOf(role);
  const maxPendingAge = pendingTtl(role);
  const candidates = [];

  for (let i = 0; i < creeps.length; i++) {
    const creep = creeps[i];
    if (!creep || !creep.memory) continue;
    if (creep.memory.role !== role) continue;
    if (!isPreSpawnCandidate(creep, threshold)) continue;
    if (hasPendingSuccessor(creep, maxPendingAge)) continue;
    candidates.push(creep);
  }

  candidates.sort((a, b) => a.ticksToLive - b.ticksToLive);
  return candidates;
}

/**
 * Убирает висящие связки: уходящий ждёт замену, которой в игре нет и уже не
 * будет (спавн не удался — не хватило энергии, спавн перехватила другая роль).
 * Без этого такой крип оставался «связанным» навсегда, и пред-спавн его
 * замены больше не открывался.
 *
 * @param {string} role
 * @param {Object[]} creeps крипы роли
 * @returns {number} сколько связок распущено
 */
function cleanupStaleHandoff(role, creeps) {
  const maxPendingAge = pendingTtl(role);
  let cleaned = 0;

  for (let i = 0; i < creeps.length; i++) {
    const creep = creeps[i];
    if (!creep || !creep.memory) continue;
    if (creep.memory.role !== role) continue;
    if (!creep.memory[REMOTE.HANDOFF_TO]) continue;
    if (hasPendingSuccessor(creep, maxPendingAge)) continue;

    delete creep.memory[REMOTE.HANDOFF_TO];
    delete creep.memory[REMOTE.HANDOFF_AT];
    cleaned++;
  }

  return cleaned;
}

/**
 * Ставит связку замены: уходящий крип → его замена.
 *
 * Вызывается ровно один раз — при запуске спавна замены (spawn.manager), до
 * того как движок создаст саму замену. Имя замены известно заранее
 * (creep.factory.creepName), поэтому указатель на неё записывается в память
 * уходящего в этом же тике: даже если предшественник умрёт во время спавна
 * замены (спавн идёт 54–120 тиков), связка уцелеет в его памяти, и замена
 * всё равно узнает, чью комнату ей наследовать.
 *
 * @param {Object} leaving уходящий крип
 * @param {string} successorName имя будущей замены
 */
function bindHandoff(leaving, successorName) {
  if (!leaving || !leaving.memory || !successorName) return;

  leaving.memory[REMOTE.HANDOFF_TO] = successorName;
  leaving.memory[REMOTE.HANDOFF_AT] = Game.time;
}

/**
 * Действительные пары «уходящий → замена» для роли.
 *
 * Пара действительна, если:
 *  - обе стороны существуют и у обеих роль та, для которой зовём;
 *  - стороны указывают ДРУГ на друга: `successor.handoffFrom` — на этого
 *    предшественника, `leaving.handoffTo` — на эту замену. Односторонние
 *    записи не считаются парой (третья роль не унаследует чужую замену);
 *  - хотя бы одна сторона в окне пре-спавна: связка ставится в момент
 *    открытия окна, поэтому живая связка без окна — мусор в памяти, и такую
 *    пару распускаем, чтобы двое работников не заняли комнату навсегда.
 *
 * Замены без пары (предшественник умер до её выхода из спавна, связка
 * распущена) попадают в отдельный список и дальше распределяются как обычные
 * новые крипы: свободная комната — назначаем, свободной нет — ждут.
 *
 * @param {string} role
 * @param {Object[]} creeps все живые крипы
 * @returns {{pairs: {leaving: Object, successor: Object}[], unpaired: Object[]}}
 */
function activePairs(role, creeps) {
  const threshold = thresholdOf(role);
  const pairs = [];
  const unpaired = [];

  for (let i = 0; i < creeps.length; i++) {
    const successor = creeps[i];
    if (!successor || !successor.memory) continue;
    if (successor.memory.role !== role) continue;

    const leavingName = successor.memory[REMOTE.HANDOFF_FROM];
    if (!leavingName) continue;

    const leaving = Game.creeps[leavingName];

    const intact =
      !!leaving &&
      !!leaving.memory &&
      leaving.memory.role === role &&
      leaving.memory[REMOTE.HANDOFF_TO] === successor.name;

    if (
      !intact ||
      (!isPreSpawnCandidate(leaving, threshold) &&
        !isPreSpawnCandidate(successor, threshold))
    ) {
      // Связка мертва: замена больше никому не наследует и распределяется как
      // обычный новый крип. Память предшественника не трогаем — там связка
      // может указывать на другую (живую) замену.
      delete successor.memory[REMOTE.HANDOFF_FROM];
      unpaired.push(successor);
      continue;
    }

    pairs.push({ leaving: leaving, successor: successor });
  }

  return { pairs: pairs, unpaired: unpaired };
}

/**
 * Роль относится к дальней добыче (у неё есть порог пре-спавна и связка
 * замены). Нужна вызывающим, чтобы не разбирать список ролей в двух местах.
 * @param {string} role
 * @returns {boolean}
 */
function isRemoteRole(role) {
  return (
    role === "reserver" || role === "remoteMiner" || role === "remoteHauler"
  );
}

module.exports = {
  isPreSpawnCandidate,
  preSpawnCandidates,
  bindHandoff,
  cleanupStaleHandoff,
  activePairs,
  isRemoteRole,
};
