const creepFactory = require("creep.factory");
const {
  SPAWN_QUOTA,
  ROOM_SPAWN_QUOTA_OVERRIDES,
  MINERAL_MIN_AMOUNT_TO_SPAWN,
  PRESPAWN_THRESHOLD,
  WORKER,
} = require("./constants");

function countRole(creeps, role, roomName) {
  return creeps.filter(c => {
    if (c.memory.role !== role) return false;

    // Для reserver/remoteMiner считаем по "родной" комнате,
    // а не по физическому нахождению — крип может быть далеко.
    if (
      role === "reserver" ||
      role === "remoteMiner" ||
      role === "remoteHauler"
    ) {
      return c.memory.homeRoom === roomName;
    }

    const threshold = PRESPAWN_THRESHOLD[role];
    if (
      role !== "reserver" &&
      threshold !== undefined &&
      c.ticksToLive !== undefined &&
      c.ticksToLive < threshold
    ) {
      return false;
    }
    return true;
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
    if (role === "reserver" && roomState.roomName !== "E35S37") continue;
    if (role === "remoteMiner" && roomState.roomName !== "E35S37") continue;
    if (role === "remoteHauler" && roomState.roomName !== "E35S37") continue;
    if (role === "attacker" && roomState.roomName === "E35S37") continue;

    if (role === "mineralMiner") {
      if (!roomState.mineral || !roomState.mineral.extractorId) continue;
      const mineralObj = Game.getObjectById(roomState.mineral.id);
      if (!mineralObj || mineralObj.mineralAmount < MINERAL_MIN_AMOUNT_TO_SPAWN)
        continue;
    }

    const override = ROOM_SPAWN_QUOTA_OVERRIDES[roomState.roomName];
    const quota =
      override && override[role] !== undefined
        ? override[role]
        : SPAWN_QUOTA[role];

    if (countRole(creeps, role, roomState.roomName) < quota) {
      const result = creepFactory.run(
        spawn,
        role,
        roomState.roomName,
        PRESPAWN_THRESHOLD[role],
      );
      if (result === OK) return;
    }
  }
}

module.exports.run = run;
