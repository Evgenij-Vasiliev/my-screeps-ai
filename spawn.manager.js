const creepFactory = require("creep.factory");
const {
  isPreSpawnCandidate,
  preSpawnCandidates,
  bindHandoff,
  cleanupStaleHandoff,
} = require("remote.handoff");
const {
  SPAWN_QUOTA,
  ROOM_SPAWN_QUOTA_OVERRIDES,
  MINERAL_MIN_AMOUNT_TO_SPAWN,
  PRESPAWN_THRESHOLD,
  WORKER,
} = require("./constants");

// Дальние роли (remote.reserver / remote.miner / remote.hauler): их крипы
// работают в удалённой комнате, поэтому квота считается не по физическому
// нахождению, а по «родной» комнате (REMOTE.HOME_ROOM = E35S37).
// Их пре-спавн — не просто «поставить замену заранее», а replacement handoff:
// замену связывают с уходящим крипом (remote.handoff), чтобы она сразу
// получила его удалённую комнату и пошла в неё, пока он ещё жив.
const REMOTE_ROLES = {
  reserver: true,
  remoteMiner: true,
  remoteHauler: true,
};

/**
 * Сколько крипов роли «держат» квоту в комнате.
 *
 * Крип на пороге пре-спавна квоту НЕ держит — на его место разрешён пре-спавн
 * замены. Раньше для reserver/remoteMiner/remoteHauler функция выходила
 * раньше и порог не применяла вовсе: умирающий дальний крип держал квоту до
 * самого исчезновения из Game.creeps, поэтому замена стартовала только после
 * его смерти — и удалённая комната гарантированно простаивала столько, сколько
 * идёт спавн плюс дорога до неё (для remoteMiner это 150–200 тиков).
 *
 * Превышение штатной квоты ограничено и всегда связано с конкретным уходящим
 * крипом: пока «держащих» меньше квоты, ставится ровно одна замена (run()
 * ставит не больше одного крипа за тик и выходит), поэтому одновременно живых
 * крипов не больше «квота + число уходящих», а после смерти старого счёт
 * возвращается к квоте.
 *
 * @param {Object[]} creeps
 * @param {string} role
 * @param {string} roomName
 * @returns {number}
 */
function countRole(creeps, role, roomName) {
  const threshold = PRESPAWN_THRESHOLD[role];
  const isRemote = REMOTE_ROLES[role] === true;

  return creeps.filter(c => {
    if (c.memory.role !== role) return false;

    // Дальние роли считаем по «родной» комнате, а не по физическому
    // нахождению — крип может быть далеко (в удалённой комнате или в пути).
    if (isRemote && c.memory.homeRoom !== roomName) return false;

    return !isPreSpawnCandidate(c, threshold);
  }).length;
}

/**
 * Есть ли в комнате воркер, который может (или вот-вот сможет) доливать
 * спавны/расширения энергией. Спавнящийся воркер тоже считается: комната
 * уже вложила в его тело 2500 и получит подвоз через ≤120 тиков — аварийный
 * дубль ей в этом случае не нужен.
 * @param {Object[]} creeps
 * @returns {boolean}
 */
function hasWorker(creeps) {
  for (let i = 0; i < creeps.length; i++) {
    if (creeps[i].memory.role === "worker") return true;
  }
  return false;
}

function run(roomState) {
  const spawn = roomState.spawns.find(s => !s.spawning);
  if (!spawn) return;
  const creeps = roomState.creeps;

  // ── АВАРИЙНЫЙ ПОДЪЁМ КОМНАТЫ ───────────────────────────────────────────
  // Воркер — единственный, кто доливает спавны/расширения энергией из
  // storage (Task fillSpawnsExtensions, первые шаги снова дают income через
  // miner/linkWorker). Поэтому воркер спавнится ПЕРВЫМ, до остальных ролей
  // SPAWN_QUOTA: следующий по порядку linkWorker стоит 300 и при пустых
  // спавнах съел бы последние деньги, оставив комнату без подвоза.
  // Именно так 18.09.2026 «погасла» E35S37: энергии в спавнах/расширениях
  // осталось ~210, штатный воркер (2500) поднять было нечем, а дешёвого
  // рабочего тела у воркера не существовало — поднимать пришлось
  // харвестерами (резервной ролью).
  // countRole НЕ используется: порог пре-спавна 150 исключил бы воркера,
  // который ещё жив и способен подвозить энергию, и комната зря получила бы
  // слабого «спасателя» вместо штатного пре-спавна (штатный путь ниже сам
  // ставит полноценную замену, когда воркер пересекает порог).
  if (!hasWorker(creeps)) {
    const emergency = spawn.room.energyAvailable < WORKER.NORMAL_BODY_ENERGY;
    if (
      creepFactory.run(
        spawn,
        "worker",
        roomState.roomName,
        PRESPAWN_THRESHOLD.worker,
        emergency,
      ) === OK
    ) {
      return;
    }
  }

  for (const role in SPAWN_QUOTA) {
    // Висящие связки (спавн замены не удался) снимаем до выбора кандидата:
    // иначе уходящий остался бы «связанным» навсегда и без замены.
    if (REMOTE_ROLES[role] === true) cleanupStaleHandoff(role, creeps);

    if (role === "reserver" && roomState.roomName !== "E35S37") continue;
    if (role === "remoteMiner" && roomState.roomName !== "E35S37") continue;
    if (role === "remoteHauler" && roomState.roomName !== "E35S37") continue;
    if (role === "attacker" && roomState.roomName === "E35S37") continue;

    if (role === "mineralMiner") {
      if (!roomState.mineral || !roomState.mineral.extractorId) continue;
      // Объект минерала уже разрешён для roomState на этот тик (mineral.manager
      // кеширует его в heap) — повторный Game.getObjectById на каждую комнату и
      // каждую проверку квоты не нужен.
      const mineralObj =
        roomState.mineral.mineral || Game.getObjectById(roomState.mineral.id);
      if (!mineralObj || mineralObj.mineralAmount < MINERAL_MIN_AMOUNT_TO_SPAWN)
        continue;
    }

    const override = ROOM_SPAWN_QUOTA_OVERRIDES[roomState.roomName];
    const quota =
      override && override[role] !== undefined
        ? override[role]
        : SPAWN_QUOTA[role];

    if (countRole(creeps, role, roomState.roomName) < quota) {
      // Пре-спавн дальней роли — это замена конкретному уходящему крипу.
      // Уходящего выбираем ДО запуска спавна: он может умереть, пока замена
      // спавнится (54–120 тиков), и тогда связка должна быть уже записана в
      // его памяти — иначе замена не узнает, чью комнату наследовать.
      let leaving = null;

      if (REMOTE_ROLES[role] === true) {
        const candidates = preSpawnCandidates(creeps, role);
        leaving = candidates.length > 0 ? candidates[0] : null;

        // Квота открыта, а заменять некого: у роли уже есть незавершённые
        // связки (замена спавнится или вот-вот выйдет) либо кандидат из чужой
        // комнаты. Крип без связки здесь был бы лишним работником без комнаты,
        // который через пару тиков стал бы дублем, — ждём разрешения связки.
        if (!leaving || leaving.memory.homeRoom !== roomState.roomName) continue;
      }

      const name = creepFactory.creepName(role, roomState.roomName);
      const result = creepFactory.run(
        spawn,
        role,
        roomState.roomName,
        PRESPAWN_THRESHOLD[role],
        undefined,
        leaving ? leaving.name : null,
      );

      if (result === OK) {
        // Замена поставлена — фиксируем связку у обеих сторон (у замены
        // handoffFrom уже записан в память при спавне). Пока связка жива,
        // remote.manager держит за парой одну комнату вместо двух, а не
        // считает это дублем. Связку пишем ТОЛЬКО при OK: неудачный спавн
        // (не хватило энергии) не должен «бронировать» имя замены.
        if (leaving) {
          bindHandoff(leaving, name);
          console.log(
            `PRE-SPAWN: ${name} — замена ${leaving.name} ` +
              `(${role}, ttl ${leaving.ticksToLive}, порог ${PRESPAWN_THRESHOLD[role]})`,
          );
        }
        return;
      }
    }
  }
}

module.exports.run = run;
