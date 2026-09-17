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
 *    (проверка «есть ли площадка» идёт из того же кэша).
 */
const { REMOTE } = require("./constants");
const { harvestPlan } = require("./role.miner");

/**
 * @param {any} s
 * @returns {boolean}
 */
function isContainer(s) {
  return s.structureType === STRUCTURE_CONTAINER;
}

/**
 * Контейнер и площадка контейнера у источника.
 *
 * ID найденных объектов и тик последней проверки кэшируются в memory:
 * между проверками функция работает только по кэшу (getObjectById ≈0.001 мс
 * против ≈0.05–0.15 мс за findInRange по всей комнате). Поиск выполняется
 * заново, когда кэш устарел (≥REMOTE.STRUCTURE_CHECK_INTERVAL тиков) или
 * когда кэшированный объект пропал (контейнер снесли, площадку достроили).
 *
 * @param {Creep} creep
 * @param {any} source
 * @returns {{container: any, site: any}}
 */
function findContainerTargets(creep, source) {
  let container = creep.memory.containerId
    ? Game.getObjectById(creep.memory.containerId)
    : null;

  if (container && !isContainer(container)) container = null;

  let site = null;
  if (!container) {
    site = creep.memory.containerSiteId
      ? Game.getObjectById(creep.memory.containerSiteId)
      : null;

    if (site && site.structureType !== STRUCTURE_CONTAINER) site = null;
  }

  const lostCached =
    (creep.memory.containerId && !container) ||
    (creep.memory.containerSiteId && !site);
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

module.exports = {
  run: function (creep) {
    const targetRoom = creep.memory.targetRoom;

    if (!targetRoom) {
      return;
    }

    if (creep.room.name !== targetRoom) {
      if (
        creep.memory._lastRoom &&
        creep.memory._lastRoom !== creep.room.name
      ) {
        delete creep.memory._travel;
      }

      creep.memory._lastRoom = creep.room.name;

      creep.travelTo(new RoomPosition(25, 25, targetRoom));

      return;
    }

    creep.memory._lastRoom = creep.room.name;

    const onBorder =
      creep.pos.x === 0 ||
      creep.pos.x === 49 ||
      creep.pos.y === 0 ||
      creep.pos.y === 49;

    if (onBorder) {
      creep.travelTo(new RoomPosition(25, 25, creep.room.name));
      return;
    }

    if (creep.memory.sourceId) {
      const cachedSource = Game.getObjectById(creep.memory.sourceId);

      if (!cachedSource || cachedSource.room.name !== targetRoom) {
        delete creep.memory.sourceId;
      }
    }

    // Источник кэшируется один раз за жизнь крипа: в комнате он не меняется.
    // (Ветка creep.room.memory.sources убрана — этот ключ никто не пишет,
    // см. docs/PROJECT_AUDIT_AND_ROADMAP.md, дефект №36.)
    if (!creep.memory.sourceId) {
      const source = creep.pos.findClosestByRange(
        creep.room.find(FIND_SOURCES),
      );

      if (source) {
        creep.memory.sourceId = source.id;
      }
    }

    const source = creep.memory.sourceId
      ? Game.getObjectById(creep.memory.sourceId)
      : null;

    if (!source) {
      delete creep.memory.sourceId;
      return;
    }

    const targets = findContainerTargets(creep, source);
    const container = targets.container;
    const site = targets.site;

    // Рабочее место: клетка контейнера (энергия отдаётся в него) либо, пока
    // контейнера нет, любая клетка в радиусе 1 от источника.
    if (container) {
      if (!creep.pos.isEqualTo(container.pos)) {
        creep.travelTo(container);
        return;
      }
    } else {
      if (creep.pos.getRangeTo(source) > 1) {
        creep.travelTo(source);
        return;
      }
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
        creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
        delete creep.memory.containerCheckedAt;
      }
    }

    // План пачечной добычи (размер пачки и интервал) считается один раз:
    // тело и источник дальнего майнера не меняются.
    let interval = creep.memory.harvestInterval;
    let perCall = creep.memory.harvestPerCall;

    if (interval === undefined || perCall === undefined) {
      const plan = harvestPlan(creep, source);

      interval = plan.interval;
      perCall = plan.perCall;
      creep.memory.harvestInterval = interval;
      creep.memory.harvestPerCall = perCall;
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
