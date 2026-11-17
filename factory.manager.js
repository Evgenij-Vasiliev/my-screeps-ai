const { FACTORY } = require("./constants");

function run(roomState) {
  const { factory } = roomState;

  if (!factory) return;

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

  factory.produce(RESOURCE_BATTERY);
}

module.exports = { run };
