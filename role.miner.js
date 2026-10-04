/**
 * ЛОГИКА МАЙНЕРА (Miner Role) — один майнер на два источника.
 *
 * Правка 01.10.2026. Слот при спавне больше НЕ выдаётся: майнер в комнате один
 * (SPAWN_QUOTA.miner = 1), конкурировать за место не с кем. Рабочие места
 * комнаты лежат в Memory.rooms[room].minerSpots — по одной клетке на источник;
 * майнер берёт одно из двух и работает на нём.
 *
 * АКТИВНОЕ МЕСТО ЖИВЁТ НА УРОВНЕ КОМНАТЫ (Memory.rooms[room].minerWp), а не в
 * памяти крипа: память умершего майнера удаляется (empire.js), и следующий
 * майнер обязан ПРОДОЛЖИТЬ путь предыдущего — встать на то же рабочее место и
 * работать с того источника, на котором тот остановился, а не начинать с
 * первого. Запись — только в момент смены места.
 *
 * Цикл: вычерпал источник под своим местом -> слил всё в линк -> ушёл
 * ПОРОЖНЯКОМ на соседнее место. Поэтому тело собрано под ходьбу порожняком по
 * дорогам (майнеры ходят по дорогам).
 *
 * Условие «у соседнего источника есть энергия» обязательно: без него майнер
 * бегал бы между двумя пустыми источниками вхолостую.
 *
 * ВЫЧЕРПАННОСТЬ СЧИТАЕТСЯ ЧЕРЕЗ ОДНО ДЕЙСТВИЕ, А НЕ ЧЕРЕЗ ПОРОГ (правка
 * 01.10.2026, вторая авария «остаток 10 в источниках»): любой остаток в
 * источнике обязан быть снят — майнер, отказавшийся от «неполного удара»,
 * оставляет эту энергию простаивать до наливки. См. `amount` ниже.
 *
 * СНИЖЕНИЕ CPU (правка 01.10.2026): постановка интента стоит 0.2 CPU (driver
 * lib/runtime/runtime.js:60,69). Роль платила его дважды за тик: harvest и
 * transfer уходили КАЖДЫЙ тик, пока майнер стоял на источнике с энергией —
 * замер динамики 01.10.2026 (Game.time 83355405-83355413) дал груз ровно 46 у
 * всех пяти майнеров в каждом тике и +46 энергии в линке каждый тик. Теперь
 * transfer идёт ПАЧКАМИ: раз в ~10 ударов (~20 тиков), когда в рюкзаке
 * кончилось место под удар.
 *
 * harvest экономить нечем, и это проверено симуляцией, а не рассуждением:
 * число ударов задаёт объём добычи (3000 / 46 = 65 ударов на источник), поэтому
 * «бить реже» даёт те же 65 интентов, только растянутых по тикам
 * (tests/miner.cpu.test.js, раздел 5). Источник и так «молчит» — harvest не
 * зовётся, пока в нём нет энергии.
 *
 * Источник и линк кэшируются в HEAP по ключу клетки: id постоянны, а объекты
 * Game пересобираются каждый тик, поэтому в Memory они не пишутся вовсе.
 */
const { MINER } = require("./constants");

/**
 * Энергии за одно действие harvest на одну WORK-часть. Глобальная константа
 * движка (HARVEST_POWER = 2, @types/screeps:168 — тот же приём, что с WORK и
 * RESOURCE_ENERGY в этом файле); фолбэк 2 нужен офлайн-тестам, где движка нет.
 */
const HARVEST_PER_WORK = typeof HARVEST_POWER === "number" ? HARVEST_POWER : 2;

/** Сколько тиков держать в кэше отрицательный ответ «линка рядом нет»:
 *  линк могли построить позже, а findInRange — это вызов API. */
const LINK_RECHECK = 100;

/**
 * Сила ОДНОГО действия harvest по телу: сумма по ЖИВЫМ WORK-частям, где каждая
 * даёт HARVEST_PER_WORK, умноженный на BOOSTS.work[boost].harvest.
 *
 * Формула повторяет движковую calcBodyEffectiveness (engine src/utils.js:623-636) —
 * ровно ту, которой пользуется обработчик harvest (`amount = min(target.energy,
 * calcBodyEffectiveness(body, WORK, 'harvest', HARVEST_POWER))`). Часть считается
 * живой при `hits > 0`, как и в движке.
 *
 * BOOSTS — глобал движка; в офлайн-тестах его может не быть (guard через typeof,
 * тот же приём, что у HARVEST_PER_WORK выше).
 * @param {Array} body
 * @returns {number}
 */
function harvestPowerOf(body) {
  let power = 0;

  for (let i = 0; i < body.length; i++) {
    const part = body[i];
    if (part.type !== WORK || !part.hits) continue;

    let partPower = HARVEST_PER_WORK;
    if (part.boost && typeof BOOSTS !== "undefined" && BOOSTS[WORK]) {
      const entry = BOOSTS[WORK][part.boost];
      if (entry && entry.harvest) partPower *= entry.harvest;
    }
    power += partPower;
  }

  return power;
}

/**
 * Подпись тела для кэша удара: сколько ЖИВЫХ WORK-частей и сколько из них с
 * бустом. Одним числом (alive × 100 + boosted) — дешевле хранить в Memory и
 * сравнивать, чем строкой; при ≤50 частях тела значения не пересекаются.
 * @param {Array} body
 * @returns {number}
 */
function workSignature(body) {
  let alive = 0;
  let boosted = 0;

  for (let i = 0; i < body.length; i++) {
    const part = body[i];
    if (part.type !== WORK || !part.hits) continue;
    alive++;
    if (part.boost) boosted++;
  }

  return alive * 100 + boosted;
}

function spotCache() {
  return (global.__minerSpots = global.__minerSpots || {});
}

/** Источник, примыкающий к рабочему месту (резолвится один раз на клетку). */
function sourceAt(creep, wp) {
  const cache = spotCache();
  const key = creep.room.name + ":" + wp.x + "," + wp.y;

  let entry = cache[key];
  if (!entry) {
    entry = cache[key] = {
      sourceId: undefined,
      linkId: undefined,
      linkCheckedAt: 0,
    };
  }

  if (entry.sourceId === undefined) {
    const pos = creep.room.getPositionAt(wp.x, wp.y);
    const source = pos ? pos.findInRange(FIND_SOURCES, 1)[0] : null;
    entry.sourceId = source ? source.id : null;
  }

  return entry.sourceId ? Game.getObjectById(entry.sourceId) : null;
}

/** Линк рядом с рабочим местом; «нет линка» перепроверяется раз в LINK_RECHECK. */
function linkAt(creep, wp) {
  const cache = spotCache();
  const key = creep.room.name + ":" + wp.x + "," + wp.y;

  let entry = cache[key];
  if (!entry) {
    entry = cache[key] = {
      sourceId: undefined,
      linkId: undefined,
      linkCheckedAt: 0,
    };
  }

  if (
    entry.linkId === undefined ||
    (entry.linkId === null && Game.time - entry.linkCheckedAt >= LINK_RECHECK)
  ) {
    const pos = creep.room.getPositionAt(wp.x, wp.y);
    const link = pos
      ? pos.findInRange(FIND_MY_STRUCTURES, 1, {
          filter: s => s.structureType === STRUCTURE_LINK,
        })[0]
      : null;
    entry.linkId = link ? link.id : null;
    entry.linkCheckedAt = Game.time;
  }

  return entry.linkId ? Game.getObjectById(entry.linkId) : null;
}

module.exports = {
  run: function (creep) {
    const roomName = creep.room.name;
    const roomMemory = Memory.rooms && Memory.rooms[roomName];
    if (!roomMemory) return;

    const workplaces = roomMemory.minerSpots || [];
    if (workplaces.length === 0) return;

    // ── Своё рабочее место ─────────────────────────────────────────────
    // Старый формат памяти (`memory.spot`) — у майнеров, заспавненных ДО
    // правки 01.10.2026. Их в комнате ещё двое, и они обязаны остаться на
    // РАЗНЫХ местах, пока не умрут: иначе оба уйдут на одно и второй не сможет
    // войти на занятую клетку — тот самый живой случай E35S37. Такие майнеры
    // место не меняют вовсе.
    // Новый формат — место берётся из памяти КОМНАТЫ (minerWp): следующий
    // майнер продолжает путь предыдущего.
    let idx = -1;

    if (creep.memory.spot) {
      for (let i = 0; i < workplaces.length; i++) {
        const w = workplaces[i];
        if (w.x === creep.memory.spot.x && w.y === creep.memory.spot.y) {
          idx = i;
          break;
        }
      }
    }

    const fixedSpot = idx !== -1;

    if (!fixedSpot) {
      idx = roomMemory.minerWp === 1 ? 1 : 0;
      if (idx >= workplaces.length) idx = 0;
    }

    const wp = workplaces[idx];

    // Стоим на рабочем месте или идём на него.
    if (!creep.pos.isEqualTo(wp.x, wp.y)) {
      creep.travelTo(creep.room.getPositionAt(wp.x, wp.y));
      return;
    }

    // Порядок чтений выбран под CPU: сначала store (нужен всегда), потом
    // источник (нужен и для удара, и для признака «вычерпан»), и только потом
    // линк — он нужен лишь тогда, когда в рюкзаке есть что сливать. Пока груз
    // пуст (пассивная фаза цикла), Game.getObjectById для линка не тратится.
    const store = creep.store;
    const carried = store[RESOURCE_ENERGY];
    const free = store.getFreeCapacity(RESOURCE_ENERGY);

    const source = sourceAt(creep, wp);
    const link = carried > 0 ? linkAt(creep, wp) : null;

    // ── Сколько энергии снимет ОДНО действие ───────────────────────────
    // Движок отдаёт по 2 энергии на WORK, но не больше, чем осталось в источнике:
    // `amount = Math.min(target.energy, harvestAmount)` (engine
    // src/processor/intents/creeps/harvest.js). Значит остаток 10 снимается
    // ЦЕЛИКОМ — важно лишь позвать harvest.
    //
    // Число WORK берётся из ФАКТИЧЕСКОГО тела крипа: тело майнера менялось
    // 01.10.2026 ({23,10,17} -> {35,7,8}, см. constants.js CREEP_BODIES.miner), и
    // майнеры старого поколения доживают свой срок рядом с новыми. Константа тут
    // дала бы старому майнеру неверный удар (ждал бы 70, а снимает 46).
    //
    // УДАР СЧИТЫВАЕТСЯ С БУСТОМ (правка 02.10.2026, T1-контур). Прежний текст
    // «Бустов WORK у майнеров нет; если появятся — кэш надо сбрасывать вместе с
    // бустом» перестал быть верным: политика выдаёт майнеру UO
    // (BOOSTS.work.UO.harvest = 3, constants.js LAB_BOOST.BOOST_POLICY.miner).
    // Считает движок — calcBodyEffectiveness (engine src/utils.js:623-636): сила
    // ЖИВОЙ части умножается на BOOSTS[WORK][boost].harvest. Здесь повторена та же
    // формула, иначе роль планирует удар 70, а движок отдаёт 90 и больше: рюкзак
    // переполняется, и лишнее СБРАСЫВАЕТСЯ НА ПОЛ (engine
    // src/processor/intents/creeps/harvest.js, ветка sum > storeCapacity → drop).
    // При 5 бустнутых частях терялось бы 10 единиц из 350 (2.9 %), при 35 — 70
    // (20 %), и мешало бы поднять parts в BOOST_POLICY.
    //
    // Кэш в памяти крипа остаётся (тело за жизнь не меняется), но привязан к
    // ПОДПИСИ тела — «сколько живых WORK и сколько из них с бустом». Подпись ловит
    // и буст, и потерянные части, а запись в Memory происходит только при её смене
    // (в обычном тике Memory не трогается). Цена — один проход по телу (~50
    // элементов) вместо getActiveBodyparts (0.000851 CPU за вызов, замер
    // 01.10.2026, K=200); любой из вариантов на порядки дешевле интента (0.2 CPU).
    const body = creep.body;
    let take = creep.memory.harvestTake;

    if (body) {
      const signature = workSignature(body);
      if (take === undefined || creep.memory.harvestSignature !== signature) {
        take = harvestPowerOf(body);
        creep.memory.harvestTake = take;
        creep.memory.harvestSignature = signature;
      }
    } else if (take === undefined) {
      // Тело недоступно (мок/симулятор без body) — прежнее поведение.
      take = creep.getActiveBodyparts(WORK) * HARVEST_PER_WORK;
      creep.memory.harvestTake = take;
    }

    // «Вычерпан» = снимать больше нечего. Отдельное от `canHarvest` условие,
    // потому что ПОКА в источнике есть хоть единица, harvest обязан зваться:
    // остаток, который майнер не забрал, простаивает до наливки.
    // Живой случай shard3 01.10.2026 (Game.time 83350573+): майнер стоял на месте
    // 52 тика подряд с нулевым грузом и 500 свободного места, а источник держал
    // ровно 10 — роль отказывалась от «неполного удара» (`energy <= take`) и
    // harvest не звала.
    const sourceEnergy = source ? source.energy : 0;
    const drained = sourceEnergy <= 0;

    // Сколько движок отдаст за это действие: остаток источника, если он меньше удара.
    const amount = sourceEnergy < take ? sourceEnergy : take;

    // ── Удар по источнику ──────────────────────────────────────────────
    // Каждый интент стоит 0.2 CPU (driver lib/runtime/runtime.js:60,69), и
    // соблазн «бить реже» здесь проверен симуляцией и ОТКЛОНЁН: число ударов
    // задаёт не частота опроса, а объём добычи — чтобы снять 3000 из источника,
    // нужно 65 ударов по 46, и удар раз в 2 тика даёт те же 65 интентов, только
    // растянутых на 130 тиков (tests/miner.cpu.test.js, раздел 5: 396 harvest за
    // 900 тиков при обоих расписаниях). Экономить тут нечего — источник и так
    // «молчит» (не бьётся), пока в нём нет энергии.
    //
    // `free >= amount` — без потерь: если свободного места меньше, чем даст удар,
    // движок СБРАСЫВАЕТ излишек на пол (`drop`, engine harvest.js), а майнер лучше
    // дождётся слива в линк — условие слива ниже сработает в тот же тик.
    const canHarvest = !drained && free >= amount;

    if (canHarvest) {
      creep.harvest(source);
    }

    // Слив в линк — ПАЧКАМИ, а не каждый тик (снижение CPU, 01.10.2026).
    // Два случая:
    //   1) места в рюкзаке не хватает на удар (free < take; полный рюкзак
    //      free === 0 входит сюда) — слить, чтобы harvest мог снять следующий;
    //   2) источник вычерпан (drained) — на соседнее место майнер уходит
    //      порожняком, поэтому перед уходом сливается всё.
    // Прежнее условие `free + freeEnergy >= take` при пустом рюкзаке (free 454
    // против take 46) истинно ВСЕГДА, поэтому transfer уходил каждый тик: замер
    // динамики 01.10.2026 (Game.time 83355405-83355413) — груз ровно 46 у всех
    // пяти майнеров в каждом тике и +46 энергии в линке каждый тик. Теперь пачка
    // копится ~10 ударов, то есть transfer идёт раз в ~20 тиков.
    // Живой случай, ради которого условие вообще появилось (shard3 01.10.2026,
    // Game.time 83353130): майнер уходил с грузом 470 из 500 — `c470->wp1` — и на
    // соседнем источнике мог снять только 30 единиц. `free < take` это исключает.
    // Если линк полон — слить нечего, майнер остаётся на месте (ждать некуда:
    // уйдёт он всё равно не с пустым рюкзаком).
    if (link && carried > 0) {
      const freeEnergy = link.store.getFreeCapacity(RESOURCE_ENERGY);
      if (freeEnergy > 0 && (drained || free < take)) {
        creep.transfer(link, RESOURCE_ENERGY);
      }
    }

    // ── Переход на соседнее рабочее место ──────────────────────────────
    // Условия ровно два и оба обязательны:
    //   1) источник под ногами вычерпан ПОЛНОСТЬЮ (`drained`, energy === 0) —
    //      значит его наливка уже запущена, ждать на месте нечего;
    //   2) у соседнего места есть хоть капля энергии (`OTHER_SPOT_MIN_ENERGY` = 1) —
    //      иначе майнер бегал бы между двумя пустыми источниками.
    // Запись идёт в память КОМНАТЫ — чтобы следующий майнер пришёл сразу сюда,
    // а не начинал с первого места.
    //
    // ЧЕГО ЗДЕСЬ БОЛЬШЕ НЕТ И ПОЧЕМУ (разбор shard3 01.10.2026, Game.time
    // 83350546-83350620). В первых версиях правки стояли два предохранителя:
    // `other.energy >= 46` (идти только за полным ударом) и `free >= take`
    // (идти только если на новом месте поместится удар). Оба были нужны лишь
    // потому, что роль ОТКАЗЫВАЛАСЬ снимать неполный остаток. Теперь harvest
    // зовётся при любом остатке > 0 (см. `canHarvest` выше), и предохранители
    // превратились в замок:
    //   • `other.energy >= 46` не пускал майнера на соседний источник, который
    //     как раз НУЖНО вычерпать до нуля, чтобы запустить его наливку — майнер
    //     стоял на вычерпанном месте («источник вычерпан, но майнер не идёт»);
    //   • `free >= take` не пускал его с грузом, хотя снять остаток и увезти
    //     может и гружёный.
    // Единственный источник, который действительно нельзя оставлять, — это
    // остаток БОЛЬШЕ нуля: он не наливается. Именно его снимает harvest выше.
    if (!fixedSpot && workplaces.length > 1 && drained) {
      const otherIdx = 1 - idx;
      const other = sourceAt(creep, workplaces[otherIdx]);
      // Право на переход даёт либо энергия у соседа (её можно снять), либо его
      // наливка, которая начнётся РАНЬШЕ, чем на текущем месте: тогда майнер
      // встречает источник уже полным, а не бежит к пустому.
      // Плюс обязательное условие по рюкзаку: уходить можно только с таким
      // грузом, который оставляет место на полный удар (free >= take). Слив в
      // линк выше как раз доводит рюкзак до этого состояния, если линк не полон.
      const otherRegen = other ? other.ticksToRegeneration : undefined;
      const thisRegen = source ? source.ticksToRegeneration : undefined;
      const regenFirst = otherRegen !== undefined &&
        (thisRegen === undefined || otherRegen < thisRegen);
      if (
        other &&
        free >= take &&
        (other.energy >= MINER.OTHER_SPOT_MIN_ENERGY || regenFirst)
      ) {
        roomMemory.minerWp = otherIdx;
      }
    }
  },
};
