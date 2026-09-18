/**
 * FACTORY MANAGER
 * Запускает производство базового товара фабрики: 600 энергии → 50 battery
 * (COMMODITIES.RESOURCE_BATTERY в движке, cooldown 10).
 *
 * Задача 16 «Экономика»: подсистема выключена флагом TASK_CONFIG.factory.
 * Причина — экономика шарда: на shard3 энергия торгуется по ~65 кр/ед,
 * а battery по ~430 кр/ед, то есть 600 энергии (≈39 000 кр) превращаются
 * в 50 battery (≈21 500 кр) — производство ради продажи убыточно. Снабжение
 * фабрики тоже выключено (TASK_CONFIG.fillFactoryEnergy/collectFactoryBattery =
 * false), поэтому раньше подсистема была «мёртвой»: вызов каждый тик без
 * результата. Код оставлен под флагом для будущих задач (сжатие энергии,
 * переработка battery → energy).
 *
 * Пороги проверяются ДО produce(): без сырья движок просто возвращает
 * ERR_NOT_ENOUGH_RESOURCES, и это чистый расход CPU без результата.
 */
const { FACTORY, STORAGE } = require("./constants");

/**
 * @param {Object} roomState
 */
function run(roomState) {
  const { factory, storage, roomName } = roomState;

  if (!factory) return;

  // Сырьё: рецепт battery. Дешевле порога — produce() нечего делать.
  if (factory.store[RESOURCE_ENERGY] < FACTORY.BATTERY_ENERGY_COST) return;

  if (factory.cooldown > 0) return;

  // Место под продукт: у фабрики общий store, поэтому «нет места» — это
  // полностью заполненный store (метод без ресурса возвращает ту же величину).
  if (factory.store.getFreeCapacity() <= 0) return;

  // Энергию фабрика имеет право брать только из излишка storage — тот же
  // порог, что у генератора задач fillFactoryEnergy (FACTORY.ENERGY_RESERVE_
  // MULTIPLIER), иначе она съест резерв комнаты.
  if (storage) {
    const reserve = STORAGE.ENERGY_MIN * FACTORY.ENERGY_RESERVE_MULTIPLIER;
    if (storage.store[RESOURCE_ENERGY] <= reserve) return;
  }

  const result = factory.produce(RESOURCE_BATTERY);
  if (result !== OK) {
    console.log(`[Factory] ${roomName} : produce() вернул ошибку ${result}`);
  }
}

module.exports = { run };
