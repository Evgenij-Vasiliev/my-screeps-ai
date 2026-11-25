/**
 * ===================================================
 * ROLE.REMOTEMINER.JS — дальний майнер: добыча в нейтральной комнате
 * ===================================================
 * Майнер приходит в удалённую комнату, садится на контейнер у источника,
 * добывает энергию и складывает её в контейнер, откуда её забирает дальний
 * хайлер (role.remoteHauler). Пока контейнера НЕТ — сам ставит площадку и сам её
 * строит своей энергией: отдельного builder'а в удалённой комнате нет (решение
 * владельца 25.11.2026), и это часть работы роли, а не отдельная роль.
 *
 * Целевую комнату назначает remote.manager (assignTargetRoom) — единственная
 * точка назначения targetRoom; список комнат — REMOTE.ROOMS (constants.js).
 *
 * ПОЧЕМУ ПАЧКАМИ (адресные замеры старой ветки, docs/REMOTE-CPU-OPTIMIZATION.md):
 *  - harvest зовётся пачками: пока пачка не влезает в рюкзак, вызова нет вообще;
 *    «пустой» harvest в полный рюкзак возвращает ERR_FULL, но стоит как
 *    продуктивный (≈0.21 мс — замер на живом шарде);
 *  - когда пачка не влезает, добытое уходит в контейнер (creep.transfer, одно
 *    действие раз в ~10 тиков) — так энергия и попадает в контейнер; без
 *    контейнера или при полном контейнере крип просто ждёт;
 *  - контейнер и площадка ищутся не каждый тик, а раз в
 *    REMOTE.STRUCTURE_CHECK_INTERVAL тиков (или сразу, если кэшированный объект
 *    исчез): findInRange обходит все структуры комнаты (A/B-замер: 1-2 вызова на
 *    каждый тик работы, ≈0.011 мс за вызов в разреженной комнате);
 *  - createConstructionSite вызывается ОДИН РАЗ на позицию, а не каждый тик:
 *    проверка «есть ли площадка» идёт из того же кэша;
 *  - рабочее место — настроенная клетка REMOTE.ROOM_TO_CONTAINER_POS, а не «под
 *    крипом»: майнер подходит к источнику разными маршрутами, и площадка
 *    появлялась в случайной клетке (в E35S38 — (37,33) вместо (37,32)).
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ origin/Новая-Империя:remote.miner.js:
 *  1. План пачечной добычи считается ЗДЕСЬ (role.miner.js этого репозитория не
 *     экспортирует harvestPlan) и пересчитывается при смене ёмкости источника.
 *     Это не косметика: в нейтральной комнате ёмкость источника 1500
 *     (SOURCE_ENERGY_NEUTRAL_CAPACITY), после резервации — 3000. Кэш без ключа
 *     ёмкости оставил бы интервал «1500-й» (4 тика вместо 2) и после резервации
 *     резал добычу вдвое.
 *  2. Сброс creep.memory._travel при переходе границы убран: Traveler этого
 *     репозитория сам стирает путь при смене цели (traveler.js:249-259), а путь
 *     у него межкомнатный — чистка на каждой границе стоила бы лишних
 *     пересчётов (0.33-0.75 CPU за поиск, docs/pathfinding-measure.json).
 * ===================================================
 */

const { REMOTE, CREEP_BODIES } = require("./constants");
const { roomScopedTarget } = require("./remote.targets");

/**
 * Вместимость одной CARRY-части (@screeps/common: CARRY_CAPACITY = 50).
 * Фолбэк — только для офлайн-тестов, где движка нет.
 */
const CARRY_UNIT = typeof CARRY_CAPACITY === "number" ? CARRY_CAPACITY : 50;

/**
 * Потолок пачки — рюкзак тела: CREEP_BODIES.remoteMiner.carry × 50 = 100.
 *
 * Почему потолок обязателен: при свободном месте меньше пачки роль уходит в
 * ветку слива в контейнер, и harvest не зовётся. Если «пачка» окажется больше
 * рюкзака, эта ветка станет истинной всегда — крип будет вечно отдавать
 * энергию и не сделает ни одного удара.
 */
const BACKPACK = CREEP_BODIES.remoteMiner.carry * CARRY_UNIT;

/**
 * Тиков на восстановление источника (ENERGY_REGEN_TIME = 300). Фолбэк — для
 * офлайн-тестов.
 */
const REGEN_TIME = typeof ENERGY_REGEN_TIME === "number" ? ENERGY_REGEN_TIME : 300;

/** Энергии за одно действие harvest на одну WORK-часть (HARVEST_POWER = 2). */
const HARVEST_PER_WORK = typeof HARVEST_POWER === "number" ? HARVEST_POWER : 2;

/**
 * @param {any} s
 * @returns {boolean}
 */
function isContainer(s) {
  return s.structureType === STRUCTURE_CONTAINER;
}

/**
 * Источник из памяти, пригодный в текущей targetRoom.
 *
 * Room-зависимая цель: после переназначения targetRoom (remote.manager лечит
 * дубль, который оставил пре-спавн) источник покинутой комнаты должен быть
 * отброшен. Вместе с ним выбрасывается и план пачечной добычи: он посчитан от
 * источника, то есть от его ёмкости, и для источника другой комнаты
 * недействителен.
 *
 * @param {Object} creep
 * @param {string} targetRoom
 * @returns {any} источник или null
 */
function knownSource(creep, targetRoom) {
  const hadCached = !!creep.memory.sourceId;
  const source = roomScopedTarget(creep, "sourceId", targetRoom);

  if (!source && hadCached) {
    delete creep.memory.harvestInterval;
    delete creep.memory.harvestPerCall;
    delete creep.memory.harvestCapacity;
  }

  return source;
}

/**
 * Забывает room-зависимые цели, оставшиеся в покинутой комнате.
 *
 * Проверка на месте использования (roomScopedTarget) уже не даёт уйти по чужому
 * id, но если этот id в текущем тике не понадобился, он лежал бы в памяти до
 * следующего обращения. После переназначения targetRoom память о прежней
 * комнате недействительна целиком, поэтому чистим сразу.
 *
 * @param {Object} creep
 * @param {string} targetRoom
 */
function forgetForeignTargets(creep, targetRoom) {
  roomScopedTarget(creep, "containerId", targetRoom);
  roomScopedTarget(creep, "containerSiteId", targetRoom);
  // knownSource сам сбросит и план пачечной добычи, если источник чужой.
  knownSource(creep, targetRoom);
}

/**
 * Рабочая цель, известная из прошлого захода в удалённую комнату: контейнер,
 * иначе источник. Пока крип вне целевой комнаты, идти нужно именно к ней, а не к
 * точке (25,25).
 *
 * Почему (разбор — docs/REMOTE-BORDER-PING-PONG.md в старой ветке): в E35S38
 * путь от входа к источнику (36,32) дешевле не внутри комнаты, а через дороги
 * домашней комнаты (стоимость PathFinder 80 против 88). Раньше роль на каждом
 * шаге вне комнаты подменяла цель центром комнаты, поэтому крип, выйдя из
 * удалённой комнаты по «дешёвому» маршруту, снова разворачивался к центру — и так
 * по кругу на кромке: ни источника, ни контейнера. Поэтому точка (25,25) —
 * ТОЛЬКО запасной вариант для первого захода, когда цель ещё ни разу не видна.
 *
 * @param {Object} creep
 * @param {string} targetRoom
 * @returns {any} контейнер, источник или null
 */
function knownWorkTarget(creep, targetRoom) {
  const container = roomScopedTarget(creep, "containerId", targetRoom);
  if (container) return container;

  return knownSource(creep, targetRoom);
}

/**
 * Контейнер и площадка контейнера у источника.
 *
 * id найденных объектов и тик последней проверки кэшируются в памяти: между
 * проверками функция работает только по кэшу (Game.getObjectById ≈0.001 мс
 * против ≈0.05-0.15 мс за findInRange). Поиск выполняется заново, когда кэш
 * устарел (≥ REMOTE.STRUCTURE_CHECK_INTERVAL тиков) или когда кэшированный объект
 * пропал (контейнер снесли, площадку достроили) — в том числе если он остался в
 * покинутой комнате.
 *
 * @param {Object} creep
 * @param {any} source источник в текущей targetRoom
 * @param {string} targetRoom
 * @returns {{container: any, site: any}}
 */
function findContainerTargets(creep, source, targetRoom) {
  const hadCached = !!creep.memory.containerId || !!creep.memory.containerSiteId;

  let container = roomScopedTarget(creep, "containerId", targetRoom);

  if (container && !isContainer(container)) {
    delete creep.memory.containerId;
    container = null;
  }

  let site = null;
  if (!container) {
    site = roomScopedTarget(creep, "containerSiteId", targetRoom);

    if (site && site.structureType !== STRUCTURE_CONTAINER) {
      delete creep.memory.containerSiteId;
      site = null;
    }
  }

  // Кэш потерян, если он был, а цели в текущей комнате не нашлось: объект исчез,
  // сменил тип или относится к покинутой комнате. Тогда ищем заново сразу, не
  // дожидаясь STRUCTURE_CHECK_INTERVAL.
  const lostCached = hadCached && !container && !site;
  const checkedAt = creep.memory.containerCheckedAt;
  const stale =
    checkedAt === undefined ||
    Game.time - checkedAt >= REMOTE.STRUCTURE_CHECK_INTERVAL;

  if (!lostCached && !stale) return { container: container, site: site };

  if (!container) {
    container =
      source.pos.findInRange(FIND_STRUCTURES, 1, { filter: isContainer })[0] ||
      null;
  }

  site = container
    ? null
    : source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
        filter: isContainer,
      })[0] || null;

  if (container) creep.memory.containerId = container.id;
  else delete creep.memory.containerId;
  if (site) creep.memory.containerSiteId = site.id;
  else delete creep.memory.containerSiteId;

  // Запись только при изменении: Game.time мог совпасть с прошлым значением
  // только при повторном входе, а безусловная запись — это лишняя сериализация
  // Memory каждый тик (правило 8 tests/rules.test.js).
  if (creep.memory.containerCheckedAt !== Game.time) {
    creep.memory.containerCheckedAt = Game.time;
  }

  return { container: container, site: site };
}

/**
 * Рабочее место майнера в комнате — настроенная клетка контейнера у источника
 * (REMOTE.ROOM_TO_CONTAINER_POS).
 *
 * Зачем настраивать явно: пока контейнера нет, роль ставила площадку под собой, а
 * к источнику крип подходит разными маршрутами (в E35S38 путь идёт через дороги
 * домашней комнаты), поэтому клетка контейнера получалась случайной.
 *
 * @param {string} targetRoom
 * @returns {RoomPosition|null} клетка или null, если для комнаты не настроена
 */
function configuredWorkCell(targetRoom) {
  const cell = REMOTE.ROOM_TO_CONTAINER_POS[targetRoom];
  return cell ? new RoomPosition(cell.x, cell.y, targetRoom) : null;
}

/**
 * План пачечной добычи: сколько энергии крип берёт за один вызов harvest и через
 * сколько тиков вызов повторять.
 *
 *   perCall  = min(HARVEST_POWER × activeWORK, рюкзак)     = min(2 × 10, 100) = 20
 *   interval = max(1, floor(perCall / (energyCapacity / ENERGY_REGEN_TIME)))
 *
 * Источник восстанавливает energyCapacity / 300 энергии в тик: в нейтральной
 * комнате 1500/300 = 5/тик (интервал 4), после резервации 3000/300 = 10/тик
 * (интервал 2). Ключ кэша — ФАКТИЧЕСКОЕ число WORK и ёмкость источника, поэтому
 * после резервации интервал пересчитывается сам.
 *
 * @param {any} source
 * @param {number} work фактическое число активных WORK-частей
 * @returns {{perCall: number, interval: number, capacity: number}}
 */
function harvestPlan(source, work) {
  const power = HARVEST_PER_WORK * work;
  const perCall = power < BACKPACK ? power : BACKPACK;

  const capacity = source.energyCapacity || 0;
  let interval = 1;

  if (perCall > 0 && capacity > 0) {
    const perTick = capacity / REGEN_TIME;
    interval = Math.floor(perCall / perTick);
    if (interval < 1) interval = 1;
  }

  return { perCall: perCall, interval: interval, capacity: capacity };
}

module.exports = {
  run: function (creep) {
    // Спавнящийся крип не может действовать: интенты всё равно отбросятся.
    if (creep.spawning) return;

    const targetRoom = creep.memory.targetRoom;

    // Комнату назначает ТОЛЬКО remote.manager. Пока свободного слота нет,
    // майнер ждёт и не покидает домашнюю комнату.
    if (!targetRoom) return;

    // remote.manager мог переназначить комнату живому крипу (лечение дубля после
    // пре-спавна) — память о прежней комнате недействительна целиком.
    forgetForeignTargets(creep, targetRoom);

    // Вне целевой комнаты идём к рабочей цели, если она уже известна из прошлого
    // захода; точка (25,25) — только запасной вариант для первого захода.
    if (creep.room.name !== targetRoom) {
      creep.travelTo(
        knownWorkTarget(creep, targetRoom) ||
          new RoomPosition(25, 25, targetRoom),
      );
      return;
    }

    // Источник кэшируется: в комнате он не меняется. Но именно здесь нужен
    // roomScopedTarget — после переназначения комнаты источник покинутой комнаты
    // (вместе с посчитанным от него планом) должен быть отброшен.
    let source = knownSource(creep, targetRoom);

    if (!source) {
      source = creep.pos.findClosestByRange(FIND_SOURCES);

      if (source) creep.memory.sourceId = source.id;
    }

    if (!source) return; // в комнате нет источников — идти некуда

    const targets = findContainerTargets(creep, source, targetRoom);
    const container = targets.container;
    const site = targets.site;

    // Рабочее место: клетка контейнера (энергия отдаётся в него), а пока
    // контейнера нет — настроенная клетка из REMOTE.ROOM_TO_CONTAINER_POS. Если
    // клетка для комнаты не настроена, работает прежнее правило: любая клетка в
    // радиусе 1 от источника.
    const workCell = container ? container.pos : configuredWorkCell(targetRoom);

    if (workCell) {
      if (!creep.pos.isEqualTo(workCell)) {
        creep.travelTo(workCell);
        return;
      }
    } else if (creep.pos.getRangeTo(source) > 1) {
      creep.travelTo(source);
      return;
    }

    // Контейнер повреждён — латаем его СВОЕЙ энергией.
    //
    // ПОЧЕМУ ПОРОГ ЕСТЬ. У контейнера CONTAINER_HITS = 250 000 (полные хиты в
    // момент постройки), а в комнате БЕЗ ВЛАДЕЛЬЦА он теряет CONTAINER_DECAY =
    // 5000 хитов каждые CONTAINER_DECAY_TIME = 100 тиков, то есть 50 хитов/тик
    // (замер владельца 25.11.2026 совпал: 50/тик; резервация владельцем комнату
    // НЕ делает — распад идёт по неприватизированной ставке). Полных хитов
    // хватает на 5000 тиков, порог 50 % (125 000 хитов) отодвигает ремонт на
    // ~2500 тиков после постройки. Без ремонта контейнер исчезает, и «майнер сам
    // содержит контейнер» превращается в «контейнер пропал, майнер стоит».
    //
    // Ремонт идёт с той же клетки (майнер стоит НА контейнере), REPAIR_POWER =
    // 100 хитов на WORK за тик: при 10 WORK это 1000 хитов за тик против 50
    // распада — догнать потери успевает, платит энергией из своего рюкзака
    // (REPAIR_COST = 0.01 энергии за хит).
    if (
      container &&
      container.hits < container.hitsMax * 0.5 &&
      creep.store[RESOURCE_ENERGY] > 0
    ) {
      creep.repair(container);
      return;
    }

    // Контейнера нет: площадка ставится ОДИН раз в настроенную клетку (не «под
    // крипом»), а дальше её находит поиск из кэша — иначе
    // createConstructionSite вызывался бы каждый тик и каждый раз возвращал
    // ERR_INVALID_TARGET.
    if (!container) {
      if (site && creep.store[RESOURCE_ENERGY] > 0) {
        creep.build(site);
        return;
      }

      if (!site) {
        (workCell || creep.pos).createConstructionSite(STRUCTURE_CONTAINER);
        // Кэш проверки сбрасываем: следующий тик должен найти поставленную
        // площадку сразу, а не через STRUCTURE_CHECK_INTERVAL.
        delete creep.memory.containerCheckedAt;
      }
    }

    // План пачечной добычи кэшируется: пересчёт — только когда изменилось тело
    // или ЁМКОСТЬ ИСТОЧНИКА (1500 до резервации, 3000 после).
    const work = creep.getActiveBodyparts(WORK);
    let interval = creep.memory.harvestInterval;
    let perCall = creep.memory.harvestPerCall;

    if (
      interval === undefined ||
      perCall === undefined ||
      creep.memory.harvestWork !== work ||
      creep.memory.harvestCapacity !== source.energyCapacity
    ) {
      const plan = harvestPlan(source, work);

      interval = plan.interval;
      perCall = plan.perCall;
      creep.memory.harvestInterval = interval;
      creep.memory.harvestPerCall = perCall;
      creep.memory.harvestWork = work;
      creep.memory.harvestCapacity = plan.capacity;
    }

    // Пачка не влезает в рюкзак: вместо «пустого» вызова harvest (ERR_FULL)
    // отдаём добытое в контейнер. Если отдать некуда (контейнера нет или он
    // полон) — крип ждёт: вызов harvest всё равно ничего не принесёт, но стоил бы
    // ≈0.21 мс.
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) < perCall) {
      if (
        creep.store[RESOURCE_ENERGY] > 0 &&
        container &&
        container.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        creep.transfer(container, RESOURCE_ENERGY);
      }

      return;
    }

    if (interval > 1 && Game.time % interval !== 0) return;

    creep.harvest(source);
  },
};
