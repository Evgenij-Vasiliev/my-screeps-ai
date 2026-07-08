const factory = require("creep.factory");
const empire = require("empire");

// Квоты крипов на комнату
const QUOTA = {
  worker: 1,
  miner: 2,
  towerSupplier: 1,
  linkWorker: 1,
  terminalUnloader: 1,
  attacker: 1,
  mineralMiner: 1,
  factoryWorker: 1,
  labWorker: 1,

  // harvester: 1,
  // upgrader: 0,
  builder: 1,
  // repairer: 1,
  // transporter: 2,
};

// ТЗ №33: пороги Pre-Spawn (ticksToLive, ниже которого текущий крип роли
// перестаёт учитываться в счёте quota — досрочный заказ замены).
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

// pending — сколько уже "заказано" другими спавнами В ЭТОМ ЖЕ тике,
// но ещё не попало в Game.creeps (используется, чтобы два спавна в
// одной комнате не заказали одну и ту же роль дважды за тик).
function countForQuota(creeps, role, threshold, pending) {
  const base = _.filter(creeps, c => {
    if (c.memory.role !== role) return false;
    if (threshold === null) return true;
    return c.ticksToLive === undefined || c.ticksToLive > threshold;
  }).length;
  return base + (pending[role] || 0);
}

// ТЗ №35 (несколько спавнов, общая очередь): выбор роли вынесен в
// отдельную функцию, чтобы её можно было вызвать по разу для КАЖДОГО
// свободного спавна в комнате — свободный спавн берёт следующую
// недостающую роль по той же самой очереди приоритетов QUOTA, что и
// раньше. Порядок ролей и пороги Pre-Spawn не изменились.
function findNextOrder(room, creeps, pending) {
  for (const [role, quota] of Object.entries(QUOTA)) {
    const threshold = getPrespawnThreshold(room, role);
    const count = countForQuota(creeps, role, threshold, pending);
    if (count < quota) {
      // Не спавним mineralMiner если минерал пуст
      if (role === "mineralMiner") {
        const mineral = room.find(FIND_MINERALS)[0];
        if (!mineral || mineral.mineralAmount === 0) continue;
      }
      return { role, roleData: {} };
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
        prespawnThreshold: PRESPAWN_THRESHOLD.remoteMiner,
      },
      { role: "remoteHauler", count: 2, enabled: true },
    ];
    for (const { role, count, enabled, prespawnThreshold } of globalRoles) {
      if (!enabled) continue;
      const current =
        _.filter(Game.creeps, c => {
          if (c.memory.role !== role) return false;
          if (!prespawnThreshold) return true;
          return (
            c.ticksToLive === undefined || c.ticksToLive > prespawnThreshold
          );
        }).length + (pending[role] || 0);
      if (current < count) {
        const takenRooms = pending[`${role}:rooms`] || [];
        const targetRoom =
          remoteRooms.find(
            r =>
              !takenRooms.includes(r) &&
              !_.some(
                Game.creeps,
                c =>
                  c.memory.role === role &&
                  (c.memory.targetRoom === r || c.memory.target === r),
              ),
          ) || remoteRooms[0];
        return { role, roleData: { targetRoom } };
      }
    }
  }

  return null;
}

module.exports = {
  run: function (room) {
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0) return;

    const creeps = _.filter(Game.creeps, c => c.memory.room === room.name);

    if (creeps.length === 0) {
      factory.run(spawns[0], "harvester", room.name);
      return;
    }

    const pending = {};

    for (const spawn of spawns) {
      const order = findNextOrder(room, creeps, pending);
      if (!order) break; // всё укомплектовано — остальным спавнам нечего заказывать

      const result = factory.run(spawn, order.role, room.name, order.roleData);

      if (result === OK) {
        pending[order.role] = (pending[order.role] || 0) + 1;
        if (order.roleData && order.roleData.targetRoom) {
          const key = `${order.role}:rooms`;
          pending[key] = (pending[key] || []).concat(order.roleData.targetRoom);
        }
      }
      // Если result !== OK (например ERR_NOT_ENOUGH_ENERGY) — pending не
      // увеличиваем, следующий спавн тоже попробует эту роль.
    }
  },
};
