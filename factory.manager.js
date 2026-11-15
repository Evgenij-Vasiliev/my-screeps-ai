const { FACTORY } = require("./constants");
const energyPolicy = require("./energy.policy");

function run(roomState) {
  const { factory, roomName } = roomState;

  if (!factory) return;

  const room =
    roomState.room || (Game.rooms && Game.rooms[roomName]);
  if (!room) return;

  // Политика: сток батареек, минимальный склад, свободный бюджет, интервал.
  if (!energyPolicy.factoryAllowed(room)) return;

  if (factory.cooldown > 0) return;

  // Полная партия: 600 энергии и место под 50 батарей.
  if ((factory.store[RESOURCE_ENERGY] || 0) < FACTORY.BATCH_ENERGY) return;
  if (
    factory.store &&
    typeof factory.store.getFreeCapacity === "function" &&
    factory.store.getFreeCapacity(RESOURCE_BATTERY) < FACTORY.BATCH_BATTERIES
  ) {
    return;
  }

  const result = factory.produce(RESOURCE_BATTERY);
  if (result === OK) {
    if (!Memory.rooms) Memory.rooms = {};
    const mem = Memory.rooms[roomName] || (Memory.rooms[roomName] = {});
    mem.factoryNextBatchAt = Game.time + FACTORY.INTERVAL;
  }
}

module.exports = { run };
