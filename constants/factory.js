// ===================================================
// CONSTANTS/FACTORY.JS — FACTORY — рецепты и пороги фабрики
// ===================================================
// Рецепты (FACTORY_RECIPES) и пороги производства (FACTORY).
// Выделено из constants.js; потребители берут значения через barrel
// constants.js, чтобы объекты конфига оставались одним экземпляром.
// ===================================================
// ── FACTORY ──────────────────────────────────────────────────────────────
// Рецепты фабрики: components — расход сырья за один produce(), amount — выход
// продукта одним вызовом (значения COMMODITIES[*] движка). Таблицей, а не
// набором констант «под battery»: и factory.manager, и снабжение читают
// RECIPES[ACTIVE_RECIPE], поэтому новый рецепт не требует правок их логики.
// Ключи components — имена ресурсов движка (energy === RESOURCE_ENERGY).
const FACTORY_RECIPES = {
  battery: { components: { energy: 600 }, amount: 50 },
};

// Порог, ниже которого фабрика не имеет права забирать энергию из Storage.
const FACTORY = {
  // Множитель к STORAGE.ENERGY_MIN: нижняя граница склада для снабжения
  // фабрики (150 000 × 1.1 = 165 000). Это не «жадность», а рабочий буфер:
  // лаборатории, PowerSpawn и ремонт берут энергию ТОЛЬКО из остатка склада
  // выше STORAGE.ENERGY_MIN (lab.worker.js), поэтому фабрика, выедающая всё
  // выше 150 000, останавливает буст-конвейер — ровно то, что означает «империя
  // с включёнными фабриками не функционирует». 165k = резерв 150k + буфер 15k.
  // Второй, не менее важный резерв — терминал (TERMINAL_SUPPLY.ENERGY_TARGET,
  // 100 000): фабрика обязана видеть целыми ОБА. Единое условие —
  // factory.manager.canTakeStorageEnergy. Почему так — docs/FACTORY-ENERGY-CONTRACT.md.
  ENERGY_RESERVE_MULTIPLIER: 1.0, // множитель к STORAGE.ENERGY_MIN (150000 → 165000)

  // Стоимость рецепта battery (COMMODITIES.RESOURCE_BATTERY в движке:
  // 600 энергии → 50 battery, cooldown 10). Меньше сырья — produce() вернёт
  // ERR_NOT_ENOUGH_RESOURCES каждый тик, то есть «мёртвый» CPU без результата,
  // поэтому manager проверяет рецепт ДО вызова.
  BATTERY_ENERGY_COST: FACTORY_RECIPES.battery.components.energy,

  RECIPES: FACTORY_RECIPES,

  // Что фабрика варит сейчас (ключ в RECIPES). Активный рецепт один: фабрика
  // производит один товар, и снабжение считает пороги по этому же рецепту.
  ACTIVE_RECIPE: "battery", // RESOURCE_BATTERY

  // Сколько свободного места в store снабжение обязано оставлять под результат
  // производства. Без этого резерва fillFactoryEnergy заливает фабрику под
  // 100 %, и продукту некуда лечь. Берётся максимальный выход среди рецептов:
  // рецепт с большим выходом поднимает резерв автоматически.
  PRODUCT_RESERVE: Math.max(
    ...Object.values(FACTORY_RECIPES).map(recipe => recipe.amount),
  ),
};

module.exports = {
  FACTORY,
};
