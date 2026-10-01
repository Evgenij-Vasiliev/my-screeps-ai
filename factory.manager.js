function run(roomState) {
  const { factory, roomName } = roomState;

  if (!factory) return;

  if (factory.cooldown > 0) return;

  if (factory.store[RESOURCE_ENERGY] > 0) {
    const result = factory.produce(RESOURCE_BATTERY);

    // if (result !== OK) {
    //   console.log(`[Factory] ${roomName} : produce() вернул ошибку ${result}`);
    // }
  }
}

module.exports = { run };
