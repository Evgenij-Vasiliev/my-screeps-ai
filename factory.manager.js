/**
 * FACTORY MANAGER
 * Варит активный рецепт фабрики (FACTORY.ACTIVE_RECIPE): сейчас это
 * 600 энергии → 50 battery (COMMODITIES.RESOURCE_BATTERY в движке, cooldown 10).
 *
 * Подсистема включена флагом TASK_CONFIG.factory. Снабжение включено
 * (TASK_CONFIG.fillFactoryEnergy) и обязано оставлять в store резерв под
 * результат производства — FACTORY.PRODUCT_RESERVE, см. isEnergySupplyComplete();
 * вывоз продукта делает collectFactoryBattery.
 *
 * Пороги проверяются ДО produce(): без сырья движок возвращает
 * ERR_NOT_ENOUGH_RESOURCES, и это чистый расход CPU без результата.
 *
 * МЕСТО В STORE. Движок проверяет его как
 * `used − components + amount > capacity` (screeps/engine,
 * StructureFactory.prototype.produce), то есть расход сырья сам освобождает
 * место под продукт. Поэтому фабрика, залитая сырьём под завязку
 * (energy 50 000/50 000), варить МОЖЕТ — проверка места ниже повторяет правило
 * движка. Прежняя проверка (`store.getFreeCapacity() <= 0`) была строже движка
 * и вместе со снабжением «залить до 100 %» навсегда блокировала produce().
 *
 * ИСТОРИЯ. В задаче 16 подсистема была выключена: на shard3 600 энергии
 * (≈39 000 кр) превращались в 50 battery (≈21 500 кр), то есть производство
 * ради продажи убыточно. Сейчас включена по запросу владельца; экономику
 * продаж решает market.manager (battery входит в MARKET.SELL_RESOURCES), а не
 * эта подсистема.
 */
const { FACTORY, STORAGE } = require("./constants");

/**
 * Рецепт, который фабрика варит сейчас.
 * @returns {{components: Object<string, number>, amount: number}|null}
 */
function getActiveRecipe() {
  return FACTORY.RECIPES[FACTORY.ACTIVE_RECIPE] || null;
}

/**
 * Суммарный объём сырья, которое съедает один produce().
 * @param {{components: Object<string, number>}} recipe
 * @returns {number}
 */
function componentsVolume(recipe) {
  let total = 0;
  for (const resourceType in recipe.components) {
    total += recipe.components[resourceType];
  }
  return total;
}

/**
 * Снабжение энергией больше не нужно: сырья активного рецепта хватает И в store
 * остался резерв под результат производства.
 *
 * Единое условие для генератора задач (task.generators.generateFillFactoryEnergy)
 * и исполнителя (task.executors.executeFillFactoryEnergy): снабжение обязано
 * остановиться ДО того, как store заполнится под 100 %, иначе продукту некуда
 * лечь. Порог — FACTORY.PRODUCT_RESERVE (максимальный выход среди рецептов).
 * Рецепт не настроен (ACTIVE_RECIPE не найден в RECIPES) — варить нечего,
 * поэтому снабжение тоже не нужно: возвращаем true.
 * @param {Object} factory
 * @returns {boolean}
 */
function isEnergySupplyComplete(factory) {
  const recipe = getActiveRecipe();
  if (!recipe) return true;

  const energyNeed = recipe.components[RESOURCE_ENERGY] || 0;
  if ((factory.store[RESOURCE_ENERGY] || 0) < energyNeed) return false;

  return factory.store.getFreeCapacity() <= FACTORY.PRODUCT_RESERVE;
}

/**
 * @param {Object} roomState
 */
function run(roomState) {
  const { factory, storage, roomName } = roomState;

  if (!factory) return;

  const recipe = getActiveRecipe();
  if (!recipe) return;

  // Сырьё: все компоненты активного рецепта. Чего-то не хватает — produce()
  // нечего делать.
  for (const resourceType in recipe.components) {
    if ((factory.store[resourceType] || 0) < recipe.components[resourceType]) {
      return;
    }
  }

  if (factory.cooldown > 0) return;

  // Место под продукт — по правилу движка: `used − components + amount` против
  // capacity. Свободного места должно хватать на выход ЗА ВЫЧЕТОМ расхода
  // сырья; для battery это 50 − 600, то есть места не требуется вовсе.
  if (factory.store.getFreeCapacity() + componentsVolume(recipe) < recipe.amount) {
    return;
  }

  // Энергию фабрика имеет право брать только из излишка storage — тот же
  // порог, что у генератора задач fillFactoryEnergy (FACTORY.ENERGY_RESERVE_
  // MULTIPLIER), иначе она съест резерв комнаты.
  if (storage) {
    const reserve = STORAGE.ENERGY_MIN * FACTORY.ENERGY_RESERVE_MULTIPLIER;
    if (storage.store[RESOURCE_ENERGY] <= reserve) return;
  }

  const result = factory.produce(FACTORY.ACTIVE_RECIPE);
  if (result !== OK) {
    console.log(
      `[Factory] ${roomName} : produce(${FACTORY.ACTIVE_RECIPE}) вернул ошибку ${result}`,
    );
  }
}

module.exports = { run, isEnergySupplyComplete };
