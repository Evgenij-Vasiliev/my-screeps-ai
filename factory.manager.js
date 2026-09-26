/**
 * FACTORY MANAGER
 * Варит активный рецепт фабрики (FACTORY.ACTIVE_RECIPE): сейчас это
 * 600 энергии → 50 battery (COMMODITIES.RESOURCE_BATTERY в движке, cooldown 10).
 *
 * Подсистема включается флагом TASK_CONFIG.factory. ФЛАГИ ВКЛЮЧЕНЫ (true), но
 * расход энергии закрыт гейтом резервов: пока империя не держит требуемые
 * резервы (терминал 100000–150000, склад ≥150000), фабрика энергии не получает
 * — иначе она выедает излишек, которым живут терминал, лаборатории и
 * PowerSpawn. Гейт — canTakeStorageEnergy (см. ниже). Снабжение
 * (TASK_CONFIG.fillFactoryEnergy) обязано оставлять в store резерв под
 * результат производства — FACTORY.PRODUCT_RESERVE, см.
 * isEnergySupplyComplete(); вывоз продукта делает collectFactoryBattery.
 * Условия, живые числа и порядок — docs/FACTORY-ENERGY-CONTRACT.md.
 *
 * ЭНЕРГЕТИЧЕСКИЙ КОНТРАКТ КОМНАТЫ (почему фабрика не «ложит» склад и терминал).
 * Фабрика — ПОСЛЕДНИЙ потребитель энергии в комнате, а не первый. Снабжение
 * имеет право брать энергию из Storage, только когда целы ОБА резерва
 * (canTakeStorageEnergy):
 *   1) Storage > STORAGE.ENERGY_MIN × FACTORY.ENERGY_RESERVE_MULTIPLIER
 *      (150 000 × 1.1 = 165 000) — резерв комнаты + рабочий буфер, из которого
 *      берут лаборатории/PowerSpawn/ремонт (они ходят в склад только выше
 *      STORAGE.ENERGY_MIN, см. lab.worker.js);
 *   2) Terminal >= TERMINAL_SUPPLY.ENERGY_TARGET (100 000) — оплата рынка и
 *      терминал-сети (лимит владельца: в терминале всегда 100 000–150 000).
 *
 * Прежний гейт был только по складу (150 000) — и этого мало: терминал
 * пополнялся ИЗ ИЗЛИШКА СКЛАДА ВЫШЕ 195 000 (прежний гейт подвоза), поэтому
 * фабрика, выедающая всё выше 150 000, НАВСЕГДА запирала терминал ниже его цели.
 * Живой замер 25.09.2026 (тик 83221605): склад 191–195k, терминал 39–71k.
 * Прямого withdraw из терминала у фабрики нет и не было
 * (energySource.withdrawFromStorage берёт только Storage) — «фабрика ложит
 * терминал» означало именно это голодание, а не отдельный сток.
 *
 * Гейт подвоза терминала теперь 150 000 (TERMINAL_SUPPLY.FILL_STORAGE_MULTIPLIER),
 * то есть терминал может дойти до 100 000 из излишка склада над резервом; а
 * фабрика включается только после этого и берёт лишь то, что выше 165 000.
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
const { FACTORY, STORAGE, TERMINAL_SUPPLY } = require("./constants");

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
 * Имеет ли снабжение фабрики право брать энергию из Storage ПРЯМО СЕЙЧАС.
 *
 * Единое условие для генератора задач (task.generators.generateFillFactoryEnergy)
 * и исполнителя (task.executors.executeFillFactoryEnergy). Оба резерва комнаты
 * обязаны быть целы:
 *   - Storage выше STORAGE.ENERGY_MIN × FACTORY.ENERGY_RESERVE_MULTIPLIER
 *     (150 000 × 1.1 = 165 000) — резерв комнаты и рабочий буфер критических
 *     систем (лаборатории/PowerSpawn/ремонт берут из склада только выше
 *     STORAGE.ENERGY_MIN);
 *   - Terminal держит не меньше TERMINAL_SUPPLY.ENERGY_TARGET (100 000) —
 *     иначе фабрика выедает излишек, из которого терминал пополняется, и он
 *     остаётся ниже цели (см. заголовок файла).
 *
 * Терминал обязателен: фабрика есть только на RCL8, а терминал — с RCL6,
 * поэтому «фабрика без терминала» — это разрушенная комната, и брать из неё
 * энергию нельзя. Само производство (run) этим условием не гейтится: produce()
 * расходует энергию, УЖЕ лежащую в фабрике, а не со склада.
 *
 * @param {Object|null} storage
 * @param {Object|null} terminal
 * @returns {boolean}
 */
function canTakeStorageEnergy(storage, terminal) {
  if (!storage) return false;

  const storageFloor = STORAGE.ENERGY_MIN * FACTORY.ENERGY_RESERVE_MULTIPLIER;
  if ((storage.store[RESOURCE_ENERGY] || 0) <= storageFloor) return false;

  if (!terminal) return false;
  return (
    (terminal.store[RESOURCE_ENERGY] || 0) >= TERMINAL_SUPPLY.ENERGY_TARGET
  );
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
  const { factory } = roomState;

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

  // ГЕЙТА СКЛАДА ЗДЕСЬ НЕТ НАМЕРЕННО. produce() расходует энергию, УЖЕ лежащую
  // в store фабрики, а не со склада, поэтому проверка `storage > reserve` ничего
  // не защищала: она лишь запирала доставленную энергию, пока склад не поднимется
  // выше порога. Живой случай (24.09.2026, docs/INCOME-AND-PREEMPTION-CHECK.md):
  // E37S38 держала 40 731 энергии и не варила 956 тиков, потому что склад стоял
  // на 164 361–164 898 ≤ 165 000. Резервы склада и терминала защищают ДРУГИЕ
  // места: генератор generateFillFactoryEnergy не создаёт задачу без
  // canTakeStorageEnergy, исполнитель повторяет то же условие перед withdraw, а
  // energySource.withdrawFromStorage физически не даёт опустить склад ниже
  // STORAGE.ENERGY_MIN (обрезает amount по остатку сверх резерва).
  // Сырьё, cooldown и место проверены выше, поэтому ненулевой код возврата —
  // редкая гонка состояния. Раньше он печатался каждый тик: строка в консоли в
  // горячем пути стоит CPU, а действия всё равно нет.
  factory.produce(FACTORY.ACTIVE_RECIPE);
}

/**
 * Ресурсы, которые фабрика обязана отдать в storage: продукт активного рецепта
 * (battery) и «чужие» ресурсы — всё, что не компонент рецепта и не продукт.
 *
 * Зачем чужие. Живой случай (24.09.2026): в фабрике E35S39 лежало 8850 H. Они
 * занимают место, производству не нужны, а для H это ещё и замороженные
 * кредиты — рынок покупал H, пока свой стоял мёртвым грузом. Вывозит их та же
 * задача `collectFactoryBattery`, что и продукт: identity Task включает
 * resourceType, поэтому задачи на battery и на H не конфликтуют.
 * @param {Object} factory
 * @returns {string[]}
 */
function collectableResources(factory) {
  const recipe = getActiveRecipe();
  if (!recipe) return [];

  const product = FACTORY.ACTIVE_RECIPE;
  const out = [];
  if ((factory.store[product] || 0) > 0) out.push(product);

  for (const resourceType in factory.store) {
    if ((factory.store[resourceType] || 0) <= 0) continue;
    if (resourceType === product) continue;
    if (recipe.components[resourceType]) continue;
    out.push(resourceType);
  }
  return out;
}

module.exports = {
  run,
  isEnergySupplyComplete,
  canTakeStorageEnergy,
  collectableResources,
};
