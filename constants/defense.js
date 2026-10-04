// ===================================================
// CONSTANTS/DEFENSE.JS — башни
// ===================================================
// Часть разбиения constants.js (моно-файл 1527 строк, 04.10.2026).
// Потребители по-прежнему пишут require("./constants"): баррель собирает
// эти объекты и отдаёт ТЕ ЖЕ ссылки, а не копии.
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "constants/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const TOWER = {
  REPAIR_ENERGY_MIN: 700,
  REPAIR_INTERVAL: 15,
  // Сколько хитов восстанавливает одно действие башни на оптимальной
  // дальности (TOWER_POWER_REPAIR, @screeps/common lib/constants.js:251).
  // Нужно, чтобы не платить 10 энергии за 1 хит: цель для ремонта берётся
  // только если дефицит хитов не меньше одного действия (движок обрезает
  // хиты по hitsMax) — room.manager.js pickRepairTarget.
  REPAIR_POWER: 800,
  // Больше НЕ ИСПОЛЬЗУЮТСЯ: стены в Screeps не распадаются (движок
  // constructedWalls/tick.js не трогает hits), поэтому порог ремонта стен
  // убран вместе с самим ремонтом стен — см. room.manager.js pickRepairTarget.
  WALL_THRESHOLD_DEFAULT: 1000,
  WALL_THRESHOLD_STEP: 1000,
  SUPPLY_THRESHOLD: 750,
  HOSTILE_CHECK_INTERVAL: 100,
};


module.exports = {
  TOWER,
};
