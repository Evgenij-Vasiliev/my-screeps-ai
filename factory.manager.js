const CONFIG = {
  START_ENERGY: 100000,
  STOP_ENERGY: 50000,
};

function run(roomState) {
  const { storage, factory, roomName } = roomState;

  if (!storage || !factory) return;

  if (factory.memory === undefined) {
    factory.memory = {};
  }

  const producing = factory.room.memory.factoryProducing || false;

  if (factory.cooldown > 0) return;

  if (!producing && storage.store[RESOURCE_ENERGY] >= CONFIG.START_ENERGY) {
    factory.room.memory.factoryProducing = true;
    console.log(`[Factory] ${roomName} : Production started`);
  }

  if (producing && storage.store[RESOURCE_ENERGY] <= CONFIG.STOP_ENERGY) {
    factory.room.memory.factoryProducing = false;
    console.log(`[Factory] ${roomName} : Production stopped`);
  }

  if (factory.room.memory.factoryProducing) {
    factory.produce(RESOURCE_BATTERY);
  }
}

module.exports = { run };
