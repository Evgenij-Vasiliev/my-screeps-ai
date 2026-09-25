/**
 * ===================================================
 * REMOTE.MINER.JS — Дальний майнер
 * ===================================================
 * Майнер приходит в удалённую комнату, садится на контейнер у источника,
 * добывает энергию и складывает её в контейнер, откуда её забирает
 * дальний хайлер (remote.hauler). Пока контейнера нет — сам ставит площадку.
 *
 * Оптимизация CPU (адресные замеры и разбор — docs/REMOTE-CPU-OPTIMIZATION.md):
 *  - harvest вызывается ПАЧКАМИ — той же формулой, что у домашнего miner
 *    (role.miner.harvestPlan: тело + источник). Пока пачка не влезает в
 *    рюкзак, вызова нет вообще: «пустой» harvest в полный рюкзак возвращает
 *    ERR_FULL, но стоит как продуктивный (≈0.21 мс — замер на живом шарде);
 *  - когда пачка не влезает, добытое уходит в контейнер (creep.transfer,
 *    одно действие раз в ~10 тиков) — так энергия и попадает в контейнер;
 *    без контейнера или при полном контейнере крип просто ждёт;
 *  - контейнер и площадка ищутся не каждый тик, а раз в
 *    REMOTE.STRUCTURE_CHECK_INTERVAL тиков (или сразу, если кэшированный
 *    объект исчез): findInRange обходит все структуры комнаты (A/B-замер:
 *    1–2 вызова на каждый тик работы, ≈0.011 мс за вызов в разреженной
 *    удалённой комнате);
 *  - createConstructionSite вызывается один раз на позицию, а не каждый тик
 *    (проверка «есть ли площадка» идёт из того же кэша);
 *  - рабочее место (клетка контейнера) задано в constants.REMOTE
 *    (ROOM_TO_CONTAINER_POS), а не «под крипом»: майнер подходит к источнику
 *    разными маршрутами, и площадка контейнера появлялась в случайной клетке
 *    (в E35S38 — (37,33) вместо (37,32)). Пока клетка для комнаты не настроена,
 *    работает прежнее правило: любая клетка в радиусе 1 от источника, площадка
 *    ставится под самим крипом.
 *
 * Переход между комнатами (правка 18.09.2026, docs/REMOTE-BORDER-PING-PONG.md):
 *  - пока крип вне целевой комнаты, он идёт сразу к рабочей цели
 *    (контейнер/источник), а центр комнаты (25,25) — только запасной вариант
 *    для первого захода, когда цель ещё не найдена;
 *  - ветка «стою на кромке — уйду в центр» удалена: вместе с подменой цели
 *    она и превращала рейс в вечный пинг-понг на границе (путь к источнику
 *    E35S38 дешевле через дороги домашней комнаты, и крип, выйдя из комнаты,
 *    каждый раз разворачивался к её центру).
 */
const { REMOTE } = require("./constants");
const shardState = require("./shard.state");
const { harvestPlan, harvestBoostedWork } = require("./role.miner");
const { roomScopedTarget } = require("./remote.targets");

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
 * дубль, который оставляет pre-spawn) источник покинутой комнаты должен быть
 * отброшен. Вместе с ним выбрасывается и план пачечной добычи
 * (harvestInterval/harvestPerCall): он посчитан от источника, то есть от его
 * capacity, и для источника другой комнаты недействителен.
 *
 * @param {Creep} creep
 * @param {string} targetRoom
 * @returns {any} источник или null
 */
function knownSource(creep, targetRoom) {
  const hadCached = !!creep.memory.sourceId;
  const source = roomScopedTarget(creep, "sourceId", targetRoom);

  if (!source && hadCached) {
    delete creep.memory.harvestInterval;
    delete creep.memory.harvestPerCall;
  }

  return source;
}

/**
 * Рабочая цель крипа, известная из прошлого захода в удалённую комнату:
 * контейнер, иначе источник. Пока крип вне целевой комнаты, идти нужно
 * именно к ней, а не к точке (25,25).
 *
 * Почему (разбор — docs/REMOTE-BORDER-PING-PONG.md): в E35S38 путь от входа
 * к источнику (36,32) дешевле не внутри комнаты, а через дороги домашней
 * комнаты (стоимость PathFinder 80 против 88). Раньше роль на каждом шаге
 * вне комнаты подменяла цель центром комнаты, поэтому крип, выйдя из
 * удалённой комнаты по «дешёвому» маршруту, снова разворачивался к центру —
 * и так по кругу на кромке: ни источника, ни контейнера.
 *
 * ВАЖНО: и контейнер, и источник — room-зависимые цели. Они берутся только
 * через roomScopedTarget, иначе переназначенный на другую комнату майнер ушёл
 * бы по старой памяти обратно в покинутую комнату.
 *
 * @param {Creep} creep
 * @param {string} targetRoom
 * @returns {any} контейнер, источник или null
 */
function knownWorkTarget(creep, targetRoom) {
  const container = roomScopedTarget(creep, "containerId", targetRoom);
  if (container) return container;

  return knownSource(creep, targetRoom);
}

/**
 * Забывает room-зависимые цели, оставшиеся в покинутой комнате.
 *
 * Проверка на месте использования уже не даёт уйти по чужому ID, но если в
 * текущем тике он не понадобился, то так и лежал бы в памяти до следующего
 * обращения. После переназначения targetRoom память о прежней комнате
 * недействительна целиком, поэтому вычищаем её сразу.
 *
 * @param {Creep} creep
 * @param {string} targetRoom
 */
function forgetForeignTargets(creep, targetRoom) {
  roomScopedTarget(creep, "containerId", targetRoom);
  roomScopedTarget(creep, "containerSiteId", targetRoom);
  // knownSource сам сбросит и план пачечной добычи, если источник чужой.
  knownSource(creep, targetRoom);
}

/**
 * Контейнер и площадка контейнера у источника.
 *
 * ID найденных объектов и тик последней проверки кэшируются в memory:
 * между проверками функция работает только по кэшу (getObjectById ≈0.001 мс
 * против ≈0.05–0.15 мс за findInRange по всей комнате). Поиск выполняется
 * заново, когда кэш устарел (≥REMOTE.STRUCTURE_CHECK_INTERVAL тиков) или
 * когда кэшированный объект пропал (контейнер снесли, площадку достроили) —
 * в том числе если он остался в покинутой комнате.
 *
 * @param {Creep} creep
 * @param {any} source источник в текущей targetRoom
 * @param {string} targetRoom
 * @returns {{container: any, site: any}}
 */
function findContainerTargets(creep, source, targetRoom) {
  const hadCached =
    !!creep.memory.containerId || !!creep.memory.containerSiteId;

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

  // Кэш потерян, если он был, а цели в текущей комнате не нашлось: объект
  // исчез, сменил тип или относится к покинутой комнате. Тогда ищем заново
  // сразу, не дожидаясь STRUCTURE_CHECK_INTERVAL.
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
  creep.memory.containerCheckedAt = Game.time;

  return { container: container, site: site };
}

/**
 * Рабочее место дальнего майнера в комнате — настроенная клетка контейнера у
 * источника (Memory.empire.remoteContainerPos). Майнер стоит на ней,
 * добывает с источника и отдаёт энергию в контейнер.
 *
 * Зачем настраивать явно: пока контейнера нет, роль ставила площадку под
 * собой, а к источнику крип подходит разными маршрутами (в E35S38 путь идёт
 * через дороги домашней комнаты — docs/REMOTE-BORDER-PING-PONG.md), поэтому
 * клетка контейнера получалась случайной: в E35S38 — (37,33). С настроенной
 * клеткой положение контейнера и рабочего места детерминировано.
 *
 * @param {string} targetRoom
 * @returns {RoomPosition|null} клетка или null, если для комнаты не настроена
 */
function configuredWorkCell(targetRoom) {
  const cell = shardState.remoteContainerPos(targetRoom);
  return cell ? new RoomPosition(cell.x, cell.y, targetRoom) : null;
}

module.exports = {
  run: function (creep) {
    const targetRoom = creep.memory.targetRoom;

    if (!targetRoom) {
      return;
    }

    // remote.manager мог переназначить комнату живому крипу (лечение дубля
    // после pre-spawn) — память о прежней комнате недействительна целиком.
    forgetForeignTargets(creep, targetRoom);

    // Целевая комната недостижима напрямую (крип вне неё) — идём к рабочей
    // цели, если она уже известна из прошлого захода; точка (25,25) — только
    // запасной вариант для первого захода.
    //
    // ВАЖНО: цель здесь НЕ подменяется на каждом пересечении границы.
    // Именно подмена («вне комнаты — иди в центр») превращала рейс в вечный
    // пинг-понг на кромке: путь к источнику дешевле через дороги домашней
    // комнаты, крип выходил из удалённой комнаты, роль возвращала его к
    // центру, и так по кругу (docs/REMOTE-BORDER-PING-PONG.md).
    if (creep.room.name !== targetRoom) {
      if (
        creep.memory._lastRoom &&
        creep.memory._lastRoom !== creep.room.name
      ) {
        delete creep.memory._travel;
      }

      creep.memory._lastRoom = creep.room.name;

      creep.travelTo(
        knownWorkTarget(creep, targetRoom) || new RoomPosition(25, 25, targetRoom),
      );

      return;
    }

    creep.memory._lastRoom = creep.room.name;

    // Источник кэшируется: в комнате он не меняется. Но remote.manager может
    // ПЕРЕНАЗНАЧИТЬ комнату живому крипу (лечение дубля после pre-spawn),
    // поэтому источник покинутой комнаты (вместе с посчитанным от него планом
    // пачечной добычи) должен быть отброшен — иначе майнер уйдёт к старому
    // источнику и останется в старой комнате.
    // (Ветка creep.room.memory.sources убрана — этот ключ никто не пишет,
    // см. docs/PROJECT_AUDIT_AND_ROADMAP.md, дефект №36.)
    let source = knownSource(creep, targetRoom);

    if (!source) {
      source = creep.pos.findClosestByRange(creep.room.find(FIND_SOURCES));

      if (source) {
        creep.memory.sourceId = source.id;
      }
    }

    if (!source) {
      delete creep.memory.sourceId;
      return;
    }

    const targets = findContainerTargets(creep, source, targetRoom);
    const container = targets.container;
    const site = targets.site;

    // Рабочее место: клетка контейнера (энергия отдаётся в него), а пока
    // контейнера нет — настроенная клетка контейнера из REMOTE. Если клетка для
    // комнаты не настроена, работает прежнее правило: любая клетка в радиусе 1
    // от источника.
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

    // Контейнер повреждён — латаем его своей энергией (как было).
    if (
      container &&
      container.hits < container.hitsMax * 0.5 &&
      creep.store[RESOURCE_ENERGY] > 0
    ) {
      creep.repair(container);
      return;
    }

    // Контейнера нет: строим площадку своей энергией, а саму площадку ставим
    // один раз (дальше её находит поиск из кэша — иначе createConstructionSite
    // вызывался бы каждый тик и каждый раз возвращал ERR_INVALID_TARGET).
    if (!container) {
      if (site && creep.store[RESOURCE_ENERGY] > 0) {
        creep.build(site);
        return;
      }

      if (!site) {
        // Площадка ставится в настроенную клетку (рабочее место), а не под
        // крипом: иначе положение контейнера зависит от того, каким маршрутом
        // майнер подошёл к источнику (docs/REMOTE-BORDER-PING-PONG.md).
        (workCell || creep.pos).createConstructionSite(STRUCTURE_CONTAINER);
        delete creep.memory.containerCheckedAt;
      }
    }

    // План пачечной добычи (размер пачки и интервал) считается один раз:
    // тело и источник дальнего майнера не меняются. Пересчёт — при смене
    // состояния буста: XUHO2 (harvest ×7) увеличивает пачку, и без пересчёта
    // интервал остался бы «небустнутым» (буст потрачен, экономии вызовов нет).
    const boosted = harvestBoostedWork(creep);
    let interval = creep.memory.harvestInterval;
    let perCall = creep.memory.harvestPerCall;

    if (
      interval === undefined ||
      perCall === undefined ||
      (creep.memory.harvestBoosted | 0) !== boosted
    ) {
      const plan = harvestPlan(creep, source);

      interval = plan.interval;
      perCall = plan.perCall;
      creep.memory.harvestInterval = interval;
      creep.memory.harvestPerCall = perCall;
      creep.memory.harvestBoosted = boosted;
    }

    // Пачка не влезает в рюкзак: вместо «пустого» вызова harvest (ERR_FULL)
    // отдаём добытое в контейнер. Если отдать некуда (контейнера нет или он
    // полон) — крип просто ждёт: вызов harvest всё равно ничего не принесёт,
    // но стоил бы ≈0.21 мс.
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
