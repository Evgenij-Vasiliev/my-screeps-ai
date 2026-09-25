const energySource = require("energySource");
const scanner = require("scanner");
const factoryManager = require("factory.manager");
const powerSpawnManager = require("powerSpawn.manager");
const {
  STORAGE,
  TERMINAL_SUPPLY,
  CONTROLLER,
  BOOTSTRAP,
  FACTORY,
  TASK_CONFIG,
} = require("./constants");

function withdrawPower(creep) {
  const storage = creep.room.storage;
  const terminal = creep.room.terminal;

  if (storage && storage.store[RESOURCE_POWER] > 0) {
    const result = creep.withdraw(storage, RESOURCE_POWER);
    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(storage);
    }
    return result === OK || result === ERR_NOT_IN_RANGE;
  }

  if (terminal && terminal.store[RESOURCE_POWER] > 0) {
    const result = creep.withdraw(terminal, RESOURCE_POWER);
    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(terminal);
    }
    return result === OK || result === ERR_NOT_IN_RANGE;
  }

  return false;
}

function isValidPowerSpawnTask(task, resourceType) {
  return (
    !!task &&
    task.type === "transfer" &&
    !!task.targetId &&
    task.resourceType === resourceType
  );
}

function isValidTask(task) {
  return (
    !!task &&
    task.type === "transfer" &&
    !!task.sourceId &&
    !!task.targetId &&
    task.resourceType === RESOURCE_ENERGY
  );
}

function isTargetFull(target) {
  if (
    target &&
    target.store &&
    typeof target.store.getFreeCapacity === "function"
  ) {
    return target.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  }
  return false;
}

function executeFillSpawnsExtensions(creep, task) {
  if (!isValidTask(task)) {
    return "SKIP";
  }

  const source = Game.getObjectById(task.sourceId);
  const target = Game.getObjectById(task.targetId);

  if (!source || !target) {
    return "SKIP";
  }

  // Полноту цели проверяем ДО снятия энергии: иначе воркер снимает полный груз
  // под цель, которую уже успели заполнить (например, role.harvester), а затем
  // «осиротевшую» энергию приходится скидывать обратно в storage.
  if (isTargetFull(target)) {
    return "DONE";
  }

  if (creep.store[RESOURCE_ENERGY] === 0) {
    // «Погасшая» комната (спавны/расширения почти пусты) — резерв storage
    // больше не защищаем: иначе аварийному воркеру нечем долить спавны, и
    // комната не поднимается. В обычном режиме резерв работает как раньше.
    const critical =
      creep.room.energyAvailable < BOOTSTRAP.CRITICAL_ROOM_ENERGY;
    const withdrawn = energySource.withdrawFromStorage(creep, critical);

    if (!withdrawn) {
      return "SKIP";
    }

    return "CONTINUE";
  }

  const result = creep.transfer(target, RESOURCE_ENERGY);

  switch (result) {
    case OK:
      return isTargetFull(target) ? "DONE" : "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_FULL:
      return "DONE";

    case ERR_INVALID_TARGET:
      return "SKIP";

    case ERR_NOT_ENOUGH_RESOURCES:
      return "SKIP";

    default:
      return "SKIP";
  }
}

function executeFillFactoryEnergy(creep, task) {
  // Флаг подсистемы авторитетен и для ИСПОЛНИТЕЛЯ, а не только для генератора:
  // очередь Memory чистится лишь по DONE/SKIP, поэтому уже стоящие в ней задачи
  // фабрики продолжали бы возить энергию после выключения генератора. SKIP
  // снимает такую задачу (worker.runner.js:213-221).
  if (!TASK_CONFIG.fillFactoryEnergy) return "SKIP";

  if (!isValidTask(task)) {
    return "SKIP";
  }

  const source = Game.getObjectById(task.sourceId);
  const target = Game.getObjectById(task.targetId);

  if (!source || !target) {
    return "SKIP";
  }

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  // Переключение фазы — читаем store только в начале тика,
  // опираясь на состояние, зафиксированное к концу ПРЕДЫДУЩЕГО тика.
  if (!creep.memory.working && creep.store[RESOURCE_ENERGY] > 0) {
    creep.memory.working = true; // энергию набрали в прошлом тике — едем выгружать
  } else if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    // Выгрузили в прошлом тике, рюкзак пуст — условие 3: задача закончена
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    // Фаза сбора энергии
    if (isTargetFull(target)) {
      delete creep.memory.working;
      return "DONE"; // условие 1: фабрика уже полна
    }

    // Снабжение закончено: сырьё набрано, а в store оставлен резерв под
    // результат производства (см. factory.manager.isEnergySupplyComplete).
    // Досыпать энергию «до 100 %» нельзя — продукту будет некуда лечь.
    if (factoryManager.isEnergySupplyComplete(target)) {
      delete creep.memory.working;
      return "DONE";
    }

    const withdrawn = energySource.withdrawFromStorage(creep);
    if (!withdrawn) {
      delete creep.memory.working;
      return "SKIP"; // условие 2: невыполнима — нет энергии/резерв не позволяет
    }

    return "CONTINUE";
  }

  // Фаза доставки в фабрику
  if (isTargetFull(target)) {
    delete creep.memory.working;
    return "DONE";
  }

  // Тот же резерв, что и в фазе сбора: остаток груза остаётся у крипа и уедет
  // со следующей задачей, а фабрика сохраняет место под продукт.
  if (factoryManager.isEnergySupplyComplete(target)) {
    delete creep.memory.working;
    return "DONE";
  }

  // Партия ограничивается резервом под продукт: за один рейс воркер привозит
  // больше, чем «до резерва», и свободное место под результат съедалось бы
  // целиком (у воркера carry до нескольких сотен). Третий аргумент transfer —
  // amount — поддерживается движком (screeps/engine, Creep.prototype.transfer).
  // Если резерв уже съеден, а сырья не хватает (store забит другим ресурсом),
  // amount не задаём: фабрике важнее получить сырьё, а движок всё равно
  // ограничит перенос свободным местом.
  const reserveRoom =
    target.store.getFreeCapacity(RESOURCE_ENERGY) - FACTORY.PRODUCT_RESERVE;
  const transferAmount =
    reserveRoom > 0
      ? Math.min(creep.store[RESOURCE_ENERGY], reserveRoom)
      : undefined;

  const result = creep.transfer(target, RESOURCE_ENERGY, transferAmount);

  switch (result) {
    case OK:
      return "CONTINUE"; // завершение определится в начале следующего тика по working+store===0

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_FULL:
      delete creep.memory.working;
      return "DONE";

    case ERR_INVALID_TARGET:
      delete creep.memory.working;
      return "SKIP";

    case ERR_NOT_ENOUGH_RESOURCES:
      delete creep.memory.working;
      return "SKIP";

    default:
      delete creep.memory.working;
      return "SKIP";
  }
}
/**
 * Задача вывоза из фабрики: продукт (battery) или «чужой» ресурс. Ресурс
 * конкретной задачи лежит в `task.resourceType`, поэтому валидатор не привязан
 * к battery — иначе посторонний ресурс (живой случай: 8850 H в E35S39) было бы
 * нечем вывезти.
 * @param {Object} task
 * @returns {boolean}
 */
function isValidFactoryCollectTask(task) {
  return (
    !!task &&
    task.type === "transfer" &&
    !!task.sourceId &&
    !!task.targetId &&
    typeof task.resourceType === "string" &&
    task.resourceType.length > 0
  );
}

function executeCollectFactoryBattery(creep, task) {
  // См. комментарий в executeFillFactoryEnergy: флаг авторитетен и для
  // исполнителя, иначе вывоз продолжится из уже стоящих задач.
  if (!TASK_CONFIG.collectFactoryBattery) return "SKIP";

  if (!isValidFactoryCollectTask(task)) {
    return "SKIP";
  }

  // Ресурс рейса: battery (продукт) либо чужой ресурс фабрики.
  const resourceType = task.resourceType;

  const source = Game.getObjectById(task.sourceId);
  const target = Game.getObjectById(task.targetId);

  if (!source || !target) {
    return "SKIP";
  }

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  // Переключение фазы — читаем store в начале тика, до собственных действий
  if (!creep.memory.working && creep.store[resourceType] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[resourceType] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    // Фаза сбора ресурса с фабрики
    if ((source.store[resourceType] || 0) === 0) {
      delete creep.memory.working;
      return "DONE"; // условие 1: ресурса на фабрике больше нет
    }

    if (creep.store.getFreeCapacity() === 0) {
      delete creep.memory.working;
      return "DONE"; // условие 3: рюкзак уже полон (защитный случай)
    }

    const result = creep.withdraw(source, resourceType);

    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(source);
      return "CONTINUE";
    }

    if (result === OK) {
      return "CONTINUE";
    }

    delete creep.memory.working;
    return "SKIP"; // условие 2: невыполнима
  }

  // Фаза доставки в storage
  const result = creep.transfer(target, resourceType);

  switch (result) {
    case OK:
      return "CONTINUE"; // завершение определится на входе следующего тика

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_FULL:
      delete creep.memory.working;
      return "SKIP"; // storage переполнен — невыполнима на этот раз

    case ERR_INVALID_TARGET:
      delete creep.memory.working;
      return "SKIP";

    default:
      delete creep.memory.working;
      return "SKIP";
  }
}

function executeFillTowers(creep, task) {
  if (!isValidTask(task)) {
    return "SKIP";
  }

  const source = Game.getObjectById(task.sourceId);
  const target = Game.getObjectById(task.targetId);

  if (!source || !target) {
    return "SKIP";
  }

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store[RESOURCE_ENERGY] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    if (isTargetFull(target)) {
      delete creep.memory.working;
      return "DONE";
    }

    const withdrawn = energySource.withdrawFromStorage(creep);
    if (!withdrawn) {
      delete creep.memory.working;
      return "SKIP";
    }

    return "CONTINUE";
  }

  if (isTargetFull(target)) {
    delete creep.memory.working;
    return "DONE";
  }

  const result = creep.transfer(target, RESOURCE_ENERGY);

  switch (result) {
    case OK:
      return "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_FULL:
      delete creep.memory.working;
      return "DONE";

    case ERR_INVALID_TARGET:
      delete creep.memory.working;
      return "SKIP";

    case ERR_NOT_ENOUGH_RESOURCES:
      delete creep.memory.working;
      return "SKIP";

    default:
      delete creep.memory.working;
      return "SKIP";
  }
}

function executeFillTerminalEnergy(creep, task) {
  if (!isValidTask(task) || task.resourceType !== RESOURCE_ENERGY) {
    return "SKIP";
  }

  const source = Game.getObjectById(task.sourceId);
  const target = Game.getObjectById(task.targetId);

  if (!source || !target) {
    return "SKIP";
  }

  // ЦЕЛЬ, А НЕ ЁМКОСТЬ (правка по разбору приоритетов).
  // Раньше здесь была только проверка полноты (isTargetFull): задача,
  // сгенерированная генератором ради разницы до TERMINAL_SUPPLY.ENERGY_TARGET
  // (task.generators.js: если энергия терминала < ENERGY_TARGET и storage выше
  // 195000), уходила «в работу» и лила терминал ДО ПОЛНОЙ ЁМКОСТИ 300k.
  // Пока storage держится выше 195000 — а он держится ровно настолько, насколько
  // его отпускает резерв, — воркеры вычерпывали из storage сотни тысяч энергии
  // в терминал, вытесняя снабжение фабрики (600 энергии → 50 battery по 650).
  // Теперь обе стороны согласованы: генератор считает дефицит до ENERGY_TARGET,
  // исполнитель останавливается ровно на нём.
  if (isTargetFull(target)) {
    return "DONE";
  }
  const energyTarget = TERMINAL_SUPPLY.ENERGY_TARGET;
  if ((target.store[RESOURCE_ENERGY] || 0) >= energyTarget) {
    return "DONE";
  }

  if (creep.store[RESOURCE_ENERGY] === 0) {
    // Тот же порог, что в генераторе: склад отдаёт энергию терминалу только из
    // излишка выше 195000 (STORAGE.ENERGY_MIN × STORAGE_RESERVE_MULTIPLIER).
    const reserveThreshold =
      STORAGE.ENERGY_MIN * TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER;
    if (source.store[RESOURCE_ENERGY] <= reserveThreshold) {
      return "SKIP";
    }

    const withdrawn = energySource.withdrawFromStorage(creep);

    if (!withdrawn) {
      return "SKIP";
    }

    return "CONTINUE";
  }

  const result = creep.transfer(target, RESOURCE_ENERGY);

  switch (result) {
    case OK:
      // Тот же критерий цели, что и до переноса: иначе воркер с полным
      // рюкзаком «продолжает» заливать терминал выше ENERGY_TARGET.
      return isTargetFull(target) ||
        (target.store[RESOURCE_ENERGY] || 0) >= energyTarget
        ? "DONE"
        : "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_FULL:
      return "DONE";

    case ERR_INVALID_TARGET:
      return "SKIP";

    case ERR_NOT_ENOUGH_RESOURCES:
      return "SKIP";

    default:
      return "SKIP";
  }
}

function executeFillTerminalResources(creep, task) {
  if (
    !task ||
    task.type !== "transfer" ||
    !task.sourceId ||
    !task.targetId ||
    !task.resourceType
  ) {
    return "SKIP";
  }

  const source = Game.getObjectById(task.sourceId);
  const target = Game.getObjectById(task.targetId);

  if (!source || !target) {
    return "SKIP";
  }

  const resourceType = task.resourceType;

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store[resourceType] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[resourceType] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    if (target.store.getFreeCapacity(resourceType) === 0) {
      delete creep.memory.working;
      return "DONE";
    }

    const result = creep.withdraw(source, resourceType);

    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(source);
      return "CONTINUE";
    }

    if (result === OK) {
      return "CONTINUE";
    }

    delete creep.memory.working;
    return "SKIP";
  }

  if (target.store.getFreeCapacity(resourceType) === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  const result = creep.transfer(target, resourceType);

  if (result === ERR_NOT_IN_RANGE) {
    creep.travelTo(target);
    return "CONTINUE";
  }

  if (result === OK) {
    return "CONTINUE";
  }

  if (result === ERR_FULL) {
    delete creep.memory.working;
    return "DONE";
  }

  delete creep.memory.working;
  return "SKIP";
}

function executeFillPowerSpawnPower(creep, task) {
  if (!isValidPowerSpawnTask(task, RESOURCE_POWER)) {
    return "SKIP";
  }

  const target = Game.getObjectById(task.targetId);
  if (!target) {
    return "SKIP";
  }

  const storage = creep.room.storage;

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store[RESOURCE_POWER] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[RESOURCE_POWER] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  const targetFull = target.store.getFreeCapacity(RESOURCE_POWER) === 0;

  if (!creep.memory.working) {
    if (targetFull) {
      delete creep.memory.working;
      return "DONE";
    }

    return withdrawPower(creep) ? "CONTINUE" : "SKIP";
  }

  if (!targetFull) {
    const result = creep.transfer(target, RESOURCE_POWER);

    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(target);
      return "CONTINUE";
    }

    if (result === OK || result === ERR_FULL) {
      return "CONTINUE";
    }

    delete creep.memory.working;
    return "SKIP";
  }

  // Target полон, но рюкзак ещё не пуст — сбрасываем обратно в storage
  if (!storage) {
    delete creep.memory.working;
    return "SKIP";
  }

  const dropResult = creep.transfer(storage, RESOURCE_POWER);

  if (dropResult === ERR_NOT_IN_RANGE) {
    creep.travelTo(storage);
    return "CONTINUE";
  }

  if (dropResult === OK) {
    return "CONTINUE";
  }

  delete creep.memory.working;
  return "SKIP";
}

function executeFillPowerSpawnEnergy(creep, task) {
  if (!isValidPowerSpawnTask(task, RESOURCE_ENERGY) || !task.sourceId) {
    return "SKIP";
  }

  const target = Game.getObjectById(task.targetId);
  const source = Game.getObjectById(task.sourceId);

  if (!target || !source) {
    return "SKIP";
  }

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store[RESOURCE_ENERGY] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  const targetFull = target.store.getFreeCapacity(RESOURCE_ENERGY) === 0;

  if (!creep.memory.working) {
    if (targetFull) {
      delete creep.memory.working;
      return "DONE";
    }

    // Энергии в комнате больше нет (storage на резерве, терминал ниже своего
    // порога) — рейс за энергией бессмыслен: крип вернулся бы с пустым
    // рюкзаком, а PowerSpawn всё равно нечего обрабатывать. Та же проверка,
    // что у генератора задачи, — один источник правды на всю цепочку.
    if (!powerSpawnManager.hasEnergySupply(creep.room)) {
      delete creep.memory.working;
      return "DONE";
    }

    const result = creep.withdraw(source, RESOURCE_ENERGY);

    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(source);
      return "CONTINUE";
    }

    if (result === OK) {
      return "CONTINUE";
    }

    delete creep.memory.working;
    return "DONE";
  }

  if (!targetFull) {
    const result = creep.transfer(target, RESOURCE_ENERGY);

    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(target);
      return "CONTINUE";
    }

    if (result === OK || result === ERR_FULL) {
      return "CONTINUE";
    }

    delete creep.memory.working;
    return "SKIP";
  }

  // Target полон, но рюкзак ещё не пуст — сбрасываем обратно в source (storage)
  const dropResult = creep.transfer(source, RESOURCE_ENERGY);

  if (dropResult === ERR_NOT_IN_RANGE) {
    creep.travelTo(source);
    return "CONTINUE";
  }

  if (dropResult === OK) {
    return "CONTINUE";
  }

  delete creep.memory.working;
  return "SKIP";
}

function isValidRepairTask(task) {
  return !!task && task.type === "repair" && !!task.targetId;
}

function executeRepairStructures(creep, task) {
  if (!isValidRepairTask(task)) {
    return "SKIP";
  }

  const target = Game.getObjectById(task.targetId);

  if (!target) {
    return "SKIP";
  }

  // ДОРОГИ РЕМОНТЯТ БАШНИ, НЕ ВОРКЕРЫ (решение владельца, C2).
  // Генератор такие задачи больше не создаёт (task.generators.js), но очередь
  // Memory чистится только по DONE/SKIP — без этого гейта 80 уже стоящих
  // дорожных задач E35S37 продолжали бы водить воркеров по дорогам.
  if (target.structureType === STRUCTURE_ROAD) {
    return "SKIP";
  }

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store[RESOURCE_ENERGY] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    if (target.hits >= target.hitsMax) {
      delete creep.memory.working;
      return "DONE";
    }

    const withdrawn = energySource.withdrawFromStorage(creep);
    if (!withdrawn) {
      delete creep.memory.working;
      return "SKIP";
    }

    return "CONTINUE";
  }

  if (target.hits >= target.hitsMax) {
    delete creep.memory.working;
    return "DONE";
  }

  const result = creep.repair(target);

  switch (result) {
    case OK:
      return target.hits >= target.hitsMax ? "DONE" : "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_INVALID_TARGET:
      delete creep.memory.working;
      return "SKIP";

    case ERR_NOT_ENOUGH_RESOURCES:
      delete creep.memory.working;
      return "SKIP";

    default:
      delete creep.memory.working;
      return "SKIP";
  }
}

function isValidBuildTask(task) {
  return !!task && task.type === "build" && !!task.targetId;
}

/**
 * Состав структур комнаты изменился — сбрасываем heap-кэш scanner этой комнаты.
 *
 * Кэш живёт до scanner.STRUCTURE_CACHE_TTL (1000 тиков) и пересобирается
 * только по этому таймеру либо вручную, поэтому построенное здание (расширение,
 * линк, лаба, башня) не попадало в roomState — а значит, и в задачи
 * fillSpawnsExtensions/fillTowers и в ремонт башен — до 1000 тиков.
 * Единственный момент появления нового здания — исчезновение стройплощадки,
 * которую строил этот крип (стройка в своих комнатах идёт только через
 * buildStructures этого же Task System), поэтому инвалидация вешается именно
 * на этот переход. Стоимость — один пересбор кэша на завершённую стройку
 * (room.find по структурам комнаты), а не на каждый тик.
 * @param {Creep} creep
 */
function invalidateStructureCache(creep) {
  scanner.clearStructureCache(creep.room.name);
}

function executeBuildStructures(creep, task) {
  if (!isValidBuildTask(task)) {
    return "SKIP";
  }

  const target = Game.getObjectById(task.targetId);

  if (!target) {
    // Стройплощадка исчезла — значит либо достроена, либо снесена.
    // В любом случае задача больше не актуальна.
    invalidateStructureCache(creep);
    return "DONE";
  }

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store[RESOURCE_ENERGY] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    const withdrawn = energySource.withdrawFromStorage(creep);
    if (!withdrawn) {
      delete creep.memory.working;
      return "SKIP";
    }

    return "CONTINUE";
  }

  const result = creep.build(target);

  switch (result) {
    case OK:
      return "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_INVALID_TARGET:
      delete creep.memory.working;
      // Стройплощадка, вероятно, уже достроена — состав структур изменился.
      invalidateStructureCache(creep);
      return "DONE";

    case ERR_NOT_ENOUGH_RESOURCES:
      delete creep.memory.working;
      return "SKIP";

    default:
      delete creep.memory.working;
      return "SKIP";
  }
}

function isValidUpgradeTask(task) {
  return !!task && task.type === "upgrade" && !!task.targetId;
}

function executeUpgradeController(creep, task) {
  if (!isValidUpgradeTask(task)) {
    return "SKIP";
  }

  const target = Game.getObjectById(task.targetId);

  if (!target) {
    return "SKIP";
  }

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store[RESOURCE_ENERGY] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    if (target.ticksToDowngrade >= CONTROLLER.DOWNGRADE_MAX) {
      delete creep.memory.working;
      return "DONE";
    }

    const withdrawn = energySource.withdrawFromStorage(creep);
    if (!withdrawn) {
      delete creep.memory.working;
      return "SKIP";
    }

    return "CONTINUE";
  }

  if (target.ticksToDowngrade >= CONTROLLER.DOWNGRADE_MAX) {
    delete creep.memory.working;
    return "DONE";
  }

  const result = creep.upgradeController(target);

  switch (result) {
    case OK:
      return "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_INVALID_TARGET:
      delete creep.memory.working;
      return "SKIP";

    case ERR_NOT_ENOUGH_RESOURCES:
      delete creep.memory.working;
      return "SKIP";

    default:
      delete creep.memory.working;
      return "SKIP";
  }
}

module.exports = {
  executeFillSpawnsExtensions,
  executeFillPowerSpawnPower,
  executeFillPowerSpawnEnergy,
  executors: {
    fillSpawnsExtensions: executeFillSpawnsExtensions,
    fillTerminalEnergy: executeFillTerminalEnergy,
    fillTerminalResources: executeFillTerminalResources,
    fillPowerSpawnPower: executeFillPowerSpawnPower,
    fillPowerSpawnEnergy: executeFillPowerSpawnEnergy,
    fillFactoryEnergy: executeFillFactoryEnergy,
    collectFactoryBattery: executeCollectFactoryBattery,
    fillTowers: executeFillTowers,
    repairStructures: executeRepairStructures,
    buildStructures: executeBuildStructures,
    upgradeController: executeUpgradeController,
  },
};
