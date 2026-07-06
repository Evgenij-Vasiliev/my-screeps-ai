const factory = require("creep.factory");
const empire = require("empire");

// Квоты крипов на комнату
const QUOTA = {
  worker: 2,
  linkWorker: 1,
  miner: 2,
  towerSupplier: 1,
  terminalUnloader: 1,
  attacker: 1,
  mineralMiner: 1,
  factoryWorker: 1,
  labWorker: 1,

  // harvester: 1,
  // upgrader: 0,
  builder: 0,
  // repairer: 1,
  // transporter: 2,
};

// ТЗ №33, Блок 1/3: пороги Pre-Spawn (ticksToLive, ниже которого текущий
// крип роли перестаёт учитываться в счёте quota — это и запускает
// досрочный заказ замены, пока старый ещё жив и работает).
// miner берёт уже существующее значение из Memory.rooms[x].earlySpawnThresholds.miner
// (было заведено ранее, но реально нигде не подключалось к решению о спавне —
// использовалось только для проверки занятости точки в creep.factory.js).
// remoteMiner и linkWorker — новые константы, введены этим ТЗ.
//   remoteMiner: тело work5/carry1/move6 = 12 частей → спавн 36 тиков.
//     Точное время в пути до remoteRoom не измерялось (нет доступа к
//     room.remote.js/фактическим путям на момент правки) — 130 тиков
//     заложено с запасом (спавн + оценка пути в соседнюю комнату).
//     ЗНАЧЕНИЕ ТРЕБУЕТ ПРОВЕРКИ Архитектором по факту в игре.
//   linkWorker: тело carry8/move2 = 10 частей → спавн 30 тиков.
//     Позиции/пути у роли нет (подтверждено: memory: {} в creep.factory.js),
//     50 тиков — запас на спавн + минимальное перемещение к линку.
const PRESPAWN_THRESHOLD = {
  remoteMiner: 130,
  linkWorker: 50,
};

function getPrespawnThreshold(room, role) {
  if (role === "miner") {
    const roomMemory = Memory.rooms[room.name] || {};
    return (roomMemory.earlySpawnThresholds || {}).miner || 43;
  }
  return PRESPAWN_THRESHOLD[role] || null;
}

// Крип, чей ticksToLive <= threshold, больше не учитывается в счёте
// quota — это и есть Pre-Spawn: замена заказывается ДО смерти старого,
// не после. Крип в процессе спавна (ticksToLive === undefined) всегда
// учитывается как "живой" для quota.
function countForQuota(creeps, role, threshold) {
  return _.filter(creeps, c => {
    if (c.memory.role !== role) return false;
    if (threshold === null) return true;
    return c.ticksToLive === undefined || c.ticksToLive > threshold;
  }).length;
}

module.exports = {
  run: function (room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn || spawn.spawning) return;

    const creeps = _.filter(Game.creeps, c => c.memory.room === room.name);

    if (creeps.length === 0) {
      factory.run(spawn, "harvester", room.name);
      return;
    }

    for (const [role, quota] of Object.entries(QUOTA)) {
      const threshold = getPrespawnThreshold(room, role);
      const count = countForQuota(creeps, role, threshold);
      if (count < quota) {
        // Не спавним mineralMiner если минерал пуст
        if (role === "mineralMiner") {
          const mineral = room.find(FIND_MINERALS)[0];
          if (!mineral || mineral.mineralAmount === 0) continue;
        }

        factory.run(spawn, role, room.name);
        return;
      }
    }

    // ИСПРАВЛЕНИЕ (ТЗ №26, Блок 4): empire.remoteMining.enabled и
    // .reserveEnabled были декоративными. Значения по умолчанию (true)
    // сохраняют прежнее поведение без изменений.
    if (room.name === "E35S37" && empire.remoteMining.enabled) {
      const remoteRooms = ["E35S38", "E36S37"];
      const globalRoles = [
        {
          role: "reserver",
          count: 2,
          enabled: empire.remoteMining.reserveEnabled,
        },
        {
          role: "remoteMiner",
          count: 2,
          enabled: true,
          // ТЗ №33, Блок 2: pre-spawn по ticksToLive, см. PRESPAWN_THRESHOLD выше.
          prespawnThreshold: PRESPAWN_THRESHOLD.remoteMiner,
        },
        { role: "remoteHauler", count: 2, enabled: true },
      ];
      for (const { role, count, enabled, prespawnThreshold } of globalRoles) {
        if (!enabled) continue;
        const current = _.filter(Game.creeps, c => {
          if (c.memory.role !== role) return false;
          if (!prespawnThreshold) return true;
          return (
            c.ticksToLive === undefined || c.ticksToLive > prespawnThreshold
          );
        }).length;
        if (current < count) {
          const targetRoom =
            remoteRooms.find(
              r =>
                !_.some(
                  Game.creeps,
                  c =>
                    c.memory.role === role &&
                    (c.memory.targetRoom === r || c.memory.target === r),
                ),
            ) || remoteRooms[0];
          factory.run(spawn, role, room.name, { targetRoom });
          return;
        }
      }
    }
  },
};
