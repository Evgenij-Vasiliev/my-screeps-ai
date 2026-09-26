/**
 * ===================================================
 * LAB.WORKER.JS — Крип для обслуживания лабораторий
 * ===================================================
 * ОПТИМИЗАЦИЯ v3: один крип на комнату вместо одного на тройку.
 *
 * ОПТИМИЗАЦИЯ v4 (ТЗ №5): Round-Robin Scheduling — указатель старта обхода
 * троек, чтобы ни одна тройка не голодала.
 *
 * ОПТИМИЗАЦИЯ v6 (CPU, живой замер shard3 2026-09-25, tests/_lwprobe.js):
 * бакет роли — 3.19 мс/тик (31 % roomManager), 10 крипов = 0.32 мс/тик на крипа.
 * Адресный замер (82 тика, 820 вызовов run) разложил это так: travelTo 167 мс
 * (60 %), withdraw 25 мс, transfer 26 мс, перебор конфигов 3 мс, остальное —
 * логика. Причина — безусловный сброс задачи на пустом рюкзаке (был ниже):
 * пустой рюкзак — НОРМАЛЬНОЕ состояние фазы забора, поэтому задача сбрасывалась
 * и планировалась заново КАЖДЫЙ тик. Зонд (71 тик, 420 вызовов): пустых 276,
 * из них с задачей 228, цель сменилась прямо в вызове 196 раз (2.8 смены/тик),
 * getRotatedConfigs — 276 вызовов (ровно на каждый пустой). Смена цели — это
 * новый PathFinder.search в Traveler. Что изменено:
 *   1. Задача НЕ сбрасывается на пустом рюкзаке. Невыполнимая задача сбрасывается
 *      адресно: источник исчерпан, цель пуста, цель полна (ERR_FULL) — см. ветки.
 *   2. `transfer` с ERR_FULL завершает задачу: раньше крип с остатком груза
 *      «залипал» у полной лаборатории и слал transfer каждый тик вечно.
 *   3. Движок НЕ обрезает amount у `withdraw`: пока крип ехал, реакция выедала
 *      реагент у лабы-источника, устаревший memory.amount давал
 *      ERR_NOT_ENOUGH_RESOURCES каждый тик — задача висла навсегда (живой замер:
 *      153 withdraw, 67 ошибок). Теперь amount = min(memory.amount, остаток
 *      источника), а любой иной не-OK сбрасывает задачу (ERR_NOT_IN_RANGE — нет).
 *
 * ОПТИМИЗАЦИЯ v5 (CPU, отчёт docs/LAB-WORKER-CPU-OPTIMIZATION.md):
 * замеры на живом шарде (0.94 мс/тик, 13.8 % roomManager) показали, что ~85 %
 * бакета — это рейсы «хранилище → лаба»: крип возил по 5 единиц реагента
 * (ровно свежая порция реакции) и делал на каждые 5 единиц полный рейс.
 * Что изменено:
 *   1. Гистерезис дозаправки: задача «долить реагент» создаётся, только когда
 *      дефицит лабы не меньше рюкзака крипа — за рейс привозится полный
 *      рюкзак и крип возвращается пустым (рейсов в десятки раз меньше).
 *      Лаба держится в коридоре [CAPACITY − рюкзак, CAPACITY] — для реакции
 *      (5 единиц/тик) это буфер на сотни тиков.
 *   2. Порог выгрузки продукта — LAB_WORKER.PRODUCT_UNLOAD_AT (было 50):
 *      рейсов в 5 раз меньше.
 *   3. Действие вызывается только когда крип уже рядом (`isNearTo`) — раньше
 *      каждый тик поездки уходил «пустой» withdraw/transfer с
 *      ERR_NOT_IN_RANGE (0.03–0.07 мс впустую).
 *   4. Перебор конфигов крипом без задачи — не чаще IDLE_SCAN_INTERVAL тиков.
 *   5. Указатель round-robin переехал из `room.memory.labWorkerIndex` в heap:
 *      раньше каждый перебор конфигов писал в Memory, «пачкая» её каждый тик.
 *
 * Задачи (не изменились):
 * 1. Выгружает чужие ресурсы из лаб (если поменяли конфиг)
 * 2. Загружает реагенты из Terminal или Storage в Лаб1 и Лаб2
 * 3. Выгружает готовый продукт из реактора в Terminal или Storage
 *
 * Крип перебирает ВСЕ тройки в комнате и берёт первую найденную задачу.
 * Память крипа: task / resource / targetId / sourceId / labKey / amount.
 * Heap (global._labWorker): idx / scanAt / noCfgAt — по именам комнат.
 * ===================================================
 */

const { LAB_WORKER, LAB_BOOST, STORAGE } = require("./constants");
const recipes = require("./lab.recipes");

const LAB_CAPACITY = LAB_WORKER.CAPACITY;
const MIN_UNLOAD = LAB_WORKER.PRODUCT_UNLOAD_AT;

/**
 * Heap-состояние роли: живёт между тиками внутри одного global и сбрасывается
 * при Global Reset. Это безопасно: указатель round-robin начинается с 0,
 * а троттлинг перебора просто исчезает на один тик.
 */
function heap() {
  if (!global._labWorker) {
    global._labWorker = { idx: {}, scanAt: {}, noCfgAt: {} };
  }
  return global._labWorker;
}

/**
 * Ресурсы, которые империя вообще использует как бусты (LAB_BOOST.BOOST_POLICY).
 * Нужны буст-лабе как «зарезервированные» ресурсы: запас буста в буст-лабе
 * учитывается в local-запасе комнаты (terminalNetwork.resourceInLabs) и не
 * считается её излишком. Список вычисляется один раз за тик.
 * @returns {string[]}
 */
function boostResources() {
  const cached = global._labBoostResources;
  if (cached && cached.tick === Game.time) return cached.list;

  const list = [];
  const seen = /** @type {Object<string, boolean>} */ ({});
  const policy = LAB_BOOST.BOOST_POLICY || {};
  for (const role in policy) {
    const rows = policy[role];
    for (let i = 0; i < rows.length; i++) {
      const resource = rows[i].resource;
      if (resource && !seen[resource]) {
        seen[resource] = true;
        list.push(resource);
      }
    }
  }

  global._labBoostResources = { tick: Game.time, list };
  return list;
}

/**
 * Выполняет действие, только когда крип уже рядом с целью; иначе — идёт к ней.
 * Раньше действие вызывалось из любой точки и возвращало ERR_NOT_IN_RANGE
 * на каждом тике поездки (замер: 0.03–0.07 мс за «пустой» вызов).
 * @param {Creep} creep
 * @param {Object} target
 * @param {function(): number} fn
 * @returns {number}
 */
function actIfNear(creep, target, fn) {
  if (!creep.pos.isNearTo(target)) {
    creep.travelTo(target);
    return ERR_NOT_IN_RANGE;
  }
  return fn();
}

module.exports = {
  /**
   * Откуда крип берёт реагент: Terminal → Storage → ЛАБОРАТОРИЯ комнаты.
   *
   * Третий источник — лаборатории: тройки одной комнаты делят реагенты
   * (например, X лежит в лабе финальной тройки E35S37 и в лабе её второй
   * тройки; KH2O/KHO2 производятся здесь же и нужны сразу нескольким тройкам).
   * Без этого правила реагент, уже находящийся в комнате, но «не в своей»
   * лаборатории, для labWorker не существовал: тройка стояла пустой, хотя
   * сырьё лежало в двух клетках от неё, а единственным транспортом между
   * лабораториями был межкомнатный терминал. Регулярно это даёт не перенос
   * (оба источника живут в одной комнате), а именно отсутствие простоя.
   *
   * За один рейс берём не больше рюкзака, поэтому источник-лаборатория
   * опустошается постепенно, а внутрикомнатный перенос не конкурирует с
   * межкомнатным: терминал и storage проверяются первыми.
   *
   * @param {Room} room
   * @param {string} resource
   * @param {StructureLab} [targetLab] лаборатория-получатель; её собственная
   *   лаборатория исключается из поиска, чтобы задача не превратилась в
   *   «выгрузи реагент из цели обратно в неё же»
   * @returns {Object|null}
   */
  findSource: function (room, resource, targetLab) {
    const terminal = room.terminal;
    const storage = room.storage;

    // ЭНЕРГИЯ — ТОЛЬКО ИЗ ХРАНИЛИЩА (правило владельца: единый источник энергии
    // для всех крипов — storage). Раньше энергия бралась из терминала ПЕРВЫМ
    // (строка стояла выше склада), и заправка буст-лабораторий вычерпывала
    // терминал: в живом замере терминал E35S39 потерял 4495 энергии за 43 тика.
    // Энергия терминала предназначена комиссиям отправок и сделок. Резерв склада
    // неприкосновенен: ниже STORAGE.ENERGY_MIN энергия не берётся (забор ещё и
    // обрезается по остатку сверх резерва — см. energySource.withdrawFromStorage).
    // Важно: и лаборатории, и PowerSpawn, и ремонт живут из остатка склада ВЫШЕ
    // резерва, поэтому снабжение фабрики гейтится отдельно и с рабочим буфером
    // (FACTORY.ENERGY_RESERVE_MULTIPLIER).
    if (resource === RESOURCE_ENERGY) {
      if (storage && (storage.store[RESOURCE_ENERGY] || 0) > STORAGE.ENERGY_MIN) {
        return storage;
      }
      return null;
    }

    if (terminal && terminal.store[resource] > 0) return terminal;
    if (storage && storage.store[resource] > 0) return storage;

    const configs = this.getConfigs(room);
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i].config;
      const lab = recipes.labById(room, config.lab1);
      if (!lab || lab === targetLab) continue;
      if ((lab.store[resource] || 0) > 0) return lab;

      const lab2 = recipes.labById(room, config.lab2);
      if (!lab2 || lab2 === targetLab) continue;
      if ((lab2.store[resource] || 0) > 0) return lab2;
    }
    return null;
  },

  findDest: function (room) {
    const terminal = room.terminal;
    const storage = room.storage;
    if (terminal && terminal.store.getFreeCapacity() > 0) return terminal;
    if (storage && storage.store.getFreeCapacity() > 0) return storage;
    return null;
  },

  /**
   * Все конфиги троек в комнате в порядке по умолчанию.
   * getRotatedConfigs применяет round-robin смещение.
   *
   * Используется также terminalNetwork.js и market.manager.js — сигнатура не
   * меняется (массив {key, config}). Дополнительно в список попадает буст-лаба
   * комнаты (Memory.rooms[].boostLab) как отдельная «тройка» из одной лабы:
   * так её ресурсы автоматически учитываются в reagentList/resourceInLabs
   * терминальной сети, то есть готовый буст довозится до неё существующим
   * транспортом и защищён от продажи рынком. Реакций в буст-лабе нет —
   * labManager её конфиг не читает (нет lab1/lab2/reactor в паре с product).
   */
  getConfigs: function (room) {
    const mem = room.memory;
    const configs = [];
    if (mem.labs) configs.push({ key: "labs", config: mem.labs });
    if (mem.labs2) configs.push({ key: "labs2", config: mem.labs2 });
    if (mem.labs3) configs.push({ key: "labs3", config: mem.labs3 });
    if (mem.labs4) configs.push({ key: "labs4", config: mem.labs4 });
    if (mem.labs5) configs.push({ key: "labs5", config: mem.labs5 });
    if (mem.boostLab)
      configs.push({
        key: "boostLab",
        config: { lab1: mem.boostLab, boost: boostResources() },
      });
    return configs;
  },

  /**
   * Возвращает конфиги в ротируемом порядке и сдвигает указатель.
   *
   * Пример для 3 троек:
   *   index=0 → [labs, labs2, labs3]
   *   index=1 → [labs2, labs3, labs]
   *   index=2 → [labs3, labs, labs2]
   *
   * Указатель хранится в heap (global._labWorker.idx), а не в room.memory:
   * запись в Memory при каждом переборе конфигов держала Memory «грязной».
   *
   * @param {Room} room
   * @returns {Array} — конфиги в ротируемом порядке
   */
  getRotatedConfigs: function (room) {
    const configs = this.getConfigs(room);
    if (configs.length === 0) return configs;

    const h = heap();
    let idx = h.idx[room.name] || 0;
    // Защита от выхода за пределы массива (если убрали тройку)
    if (idx >= configs.length) idx = 0;
    // Сдвигаем указатель для СЛЕДУЮЩЕГО перебора
    h.idx[room.name] = (idx + 1) % configs.length;

    // Одно выделение вместо slice+concat: собираем порядок в один проход.
    const rotated = [];
    for (let i = 0; i < configs.length; i++) {
      rotated.push(configs[(idx + i) % configs.length]);
    }
    return rotated;
  },

  run: function (creep) {
    if (!creep || !creep.room) return;

    // ── ЗАДАЧА НЕ СБРАСЫВАЕТСЯ НА ПУСТОМ РЮКЗАКЕ (v6) ────────────────────
    // Здесь раньше стоял безусловный сброс задачи при getUsedCapacity() === 0.
    // Для фазы ЗАБОРА пустой рюкзак — норма (крип едет к источнику), поэтому
    // сброс срабатывал на каждом тике рейса и запускал перепланирование:
    // getRotatedConfigs двигал round-robin, цель менялась, Traveler удалял путь
    // к прежней цели и считал новый (живой замер — в шапке файла).
    // Завершение задачи делает исполнитель (transfer → OK → task = null), а
    // невыполнимая задача сбрасывается адресно в ветках выполнения ниже:
    // источник исчерпан, цель пуста (забрать нечего), цель полна (ERR_FULL).

    // Ищем задачу если нет текущей
    if (!creep.memory.task) {
      const h = heap();
      const roomName = creep.room.name;

      // Троттлинг: крип без задачи перебирает конфиги не каждый тик.
      const nextScan = h.scanAt[roomName];
      if (nextScan && Game.time < nextScan) return;

      const configs = this.getRotatedConfigs(creep.room);

      if (configs.length === 0) {
        // Спам убран (дефект №17 аудита): сообщение не чаще раза в 50 тиков.
        const said = h.noCfgAt[roomName];
        if (!said || Game.time - said >= 50) {
          creep.say("❌ нет конфига");
          h.noCfgAt[roomName] = Game.time;
        }
        h.scanAt[roomName] = Game.time + LAB_WORKER.IDLE_SCAN_INTERVAL;
        return;
      }

      // Дефицит, при котором есть смысл начинать рейс: не меньше свободного
      // места в рюкзаке крипа (см. п.1 в шапке файла).
      const freeCapacity = creep.store.getFreeCapacity();

      // ── БУСТ-ЛАБА: ЭНЕРГИЯ — ПЕРВЫМ ПРИОРИТЕТОМ ──────────────────────────
      // Буст одной части тела стоит LAB_BOOST_MINERAL = 30 единиц буста И
      // LAB_BOOST_ENERGY = 20 энергии, причём энергия списывается ИЗ ЛАБЫ.
      // Буст-минерал привозит сам бустуемый крип (boost.manager.runDelivery),
      // а энергию не привозил НИКТО: у конфига буст-лабы нет lab2/reactor,
      // поэтому он пропускался в цикле ниже, а задачи fill* для буст-лабы в
      // Task System не существует. Живой shard3: буст-лаба стояла с бустом
      // (XZHO2 240) и нулём энергии — creep.boost возвращал
      // ERR_NOT_ENOUGH_ENERGY, boost.manager молча стирал процедуру, и ни один
      // обычный крип не получил ни одной бустнутой части.
      //
      // Почему ПЕРЕД циклом, а не внутри него: внутри рейс за энергией
      // проигрывал очистке лабораторий (clear_lab) от реагентов прежнего плана
      // и откладывался на много сканов — на живом shard3 буст-лаба простояла
      // без энергии всё время, пока labWorker разбирал ZHO2/KH2O. Рейс нужен
      // РЕДКО (500 энергии = 25 бустнутых частей), поэтому отдельный приоритет
      // реагентам не мешает.
      for (let i = 0; i < configs.length; i++) {
        const boostConfig = configs[i].config;
        if (!boostConfig.boost) continue;
        const boostLab = recipes.labById(creep.room, boostConfig.lab1);
        if (!boostLab) continue;

        // ЭНЕРГОКРИЗИС: пока спавны/расширения не набраны хотя бы наполовину,
        // энергию в буст-лабу не возим — она нужна комнате (та же логика, что в
        // boost.manager.ENERGY_PAUSE_RATIO). Буст оппортунистический: он не имеет
        // права отбирать энергию у спавнов.
        const roomCap = creep.room.energyCapacityAvailable;
        if (
          typeof creep.room.energyAvailable === "number" &&
          typeof roomCap === "number" &&
          roomCap > 0 &&
          creep.room.energyAvailable < roomCap * LAB_BOOST.ENERGY_PAUSE_RATIO
        ) {
          break;
        }

        const curEnergy = boostLab.store[RESOURCE_ENERGY] || 0;
        const target = LAB_BOOST.ENERGY_TARGET;
        const carriesEnergy = (creep.store[RESOURCE_ENERGY] || 0) > 0;

        // ОСТАТОК ПРОШЛОГО БУСТА. Лаборатория держит энергию и ОДИН тип минерала
        // за раз (StructureLab.mineralType), поэтому после частичной выдачи в ней
        // может остаться меньше LAB_BOOST_MINERAL = 30 единиц старого буста: на
        // целую часть тела этого не хватает, а залить новый буст мешает
        // (transfer вернул бы ERR_INVALID_ARGS, и кип ждал бы вечно). Убираем
        // остаток тем же механизмом, что и чужие реагенты тройки (clear_lab →
        // терминал или склад комнаты).
        const curMineral = boostLab.mineralType;
        const leftover = curMineral ? boostLab.store[curMineral] || 0 : 0;
        if (curMineral && leftover > 0 && leftover < 30) {
          creep.memory.task = "clear_lab";
          creep.memory.resource = curMineral;
          creep.memory.targetId = boostConfig.lab1;
          creep.memory.labKey = configs[i].key;
          break;
        }

        if (
          curEnergy >= target ||
          (!carriesEnergy && target - curEnergy < freeCapacity)
        )
          continue;

        const energySrc = this.findSource(
          creep.room,
          RESOURCE_ENERGY,
          boostLab,
        );
        if (!energySrc) continue;

        creep.memory.task = "load_lab1";
        creep.memory.resource = RESOURCE_ENERGY;
        creep.memory.sourceId = energySrc.id;
        creep.memory.targetId = boostConfig.lab1;
        creep.memory.labKey = configs[i].key;
        creep.memory.amount = Math.min(
          target - curEnergy,
          energySrc.store[RESOURCE_ENERGY] || 0,
          creep.store.getFreeCapacity(),
        );
        break;
      }

      // ДВА ПРОХОДА, А НЕ ОДИН (ТЗ владельца «ЗАПУСТИТЬ ЛАБЫ — ВСЕ»).
      // Приоритеты 1–4.5 (расчистить и ЗАПУСТИТЬ каждую тройку) обрабатываются
      // для ВСЕХ троек раньше, чем буферная доливка 5/6 хотя бы одной. Прежний
      // одиночный проход останавливался на первой тройке с ЛЮБОЙ задачей: живой
      // shard3 (tick 83195239) — оба labWorker E35S37 возили доливку X в
      // активную labs, пока labs3 стояла ПУСТОЙ, а UHO2 300 лежал в терминале
      // той же комнаты. Из-за этого «простаивающие» тройки не запускались
      // никогда, хотя реагент для них уже был в комнате.
      for (let pass = 1; pass <= 2 && !creep.memory.task; pass++) {
      for (const { key, config } of configs) {
        if (creep.memory.task) break;
        // Разрешение объектов идёт через tick-кэш lab.recipes (он же использует
        // lab.manager): один Game.getObjectById на id за тик на комнату вместо
        // повторных разыменований теми же подсистемами.
        const lab1 = recipes.labById(creep.room, config.lab1);
        const lab2 = recipes.labById(creep.room, config.lab2);
        const reactor = recipes.labById(creep.room, config.reactor);

        // Конфиг буст-лабы обслуживается выше (энергия первым приоритетом),
        // в логику троек он не попадает: у него нет lab2/reactor.
        if (config.boost) continue;

        if (!lab1 || !lab2 || !reactor) continue;

        if (pass === 1) {
        // Приоритет 1: чужой ресурс в lab1
        for (const res in lab1.store) {
          if (res !== config.reagent1 && lab1.store[res] > 0) {
            creep.memory.task = "clear_lab";
            creep.memory.resource = res;
            creep.memory.targetId = config.lab1;
            creep.memory.labKey = key;
            break;
          }
        }
        if (creep.memory.task) break;

        // Приоритет 2: чужой ресурс в lab2
        for (const res in lab2.store) {
          if (res !== config.reagent2 && lab2.store[res] > 0) {
            creep.memory.task = "clear_lab";
            creep.memory.resource = res;
            creep.memory.targetId = config.lab2;
            creep.memory.labKey = key;
            break;
          }
        }
        if (creep.memory.task) break;

        // Приоритет 3: чужой ресурс в реакторе
        for (const res in reactor.store) {
          if (res !== config.product && reactor.store[res] > 0) {
            creep.memory.task = "clear_lab";
            creep.memory.resource = res;
            creep.memory.targetId = config.reactor;
            creep.memory.labKey = key;
            break;
          }
        }
        if (creep.memory.task) break;

        // Приоритет 4: выгрузить продукт из реактора
        if ((reactor.store[config.product] || 0) >= MIN_UNLOAD) {
          creep.memory.task = "unload_reactor";
          creep.memory.resource = config.product;
          creep.memory.targetId = config.reactor;
          creep.memory.labKey = key;
          break;
        }

        // Приоритет 4.5 — КРИТИЧЕСКИЙ РЕАГЕНТ (ТЗ владельца «ЗАПУСТИТЬ ЛАБЫ —
        // ВСЕ»). Тройка варит ТОЛЬКО когда ОБА реагента ≥ LAB_REACTION_AMOUNT
        // (lab.recipes.reactionReady). Прежний порядок (сначала буферная доливка
        // lab1 до LAB_CAPACITY, затем lab2) означал, что курьер возит «доливку» в
        // одну лабу, пока вторая стоит ПУСТОЙ, — и тройка не варит вовсе. Живой
        // shard3 25.09.2026 (tick 83194866): E37S38.labs — U 600 в lab1, O 0 в
        // lab2 при O 3400 в терминале ТОЙ ЖЕ комнаты, а курьер вёз доливку U;
        // E37S37.labs — O 600, H 0; E36S38.labs3 — O 2107, H 0; E37S38.labs2 —
        // Z 0, O 0. Теперь первым везём то, чего не хватает ДЛЯ РЕАКЦИИ, а
        // буферная доливка (приоритеты 5/6) остаётся ниже.
        const reactionNeed = recipes.reactionAmount();
        if ((lab1.store[config.reagent1] || 0) < reactionNeed) {
          const critSrc1 = this.findSource(creep.room, config.reagent1, lab1);
          if (critSrc1) {
            creep.memory.task = "load_lab1";
            creep.memory.resource = config.reagent1;
            creep.memory.sourceId = critSrc1.id;
            creep.memory.targetId = config.lab1;
            creep.memory.labKey = key;
            creep.memory.amount = Math.min(
              LAB_CAPACITY - (lab1.store[config.reagent1] || 0),
              critSrc1.store[config.reagent1],
              creep.store.getFreeCapacity(),
            );
            break;
          }
        }
        if ((lab2.store[config.reagent2] || 0) < reactionNeed) {
          const critSrc2 = this.findSource(creep.room, config.reagent2, lab2);
          if (critSrc2) {
            creep.memory.task = "load_lab2";
            creep.memory.resource = config.reagent2;
            creep.memory.sourceId = critSrc2.id;
            creep.memory.targetId = config.lab2;
            creep.memory.labKey = key;
            creep.memory.amount = Math.min(
              LAB_CAPACITY - (lab2.store[config.reagent2] || 0),
              critSrc2.store[config.reagent2],
              creep.store.getFreeCapacity(),
            );
            break;
          }
        }

        } else {
        // Приоритет 5: загрузить реагент1 в lab1.
        // Гистерезис (см. п.1 в шапке): новый рейс начинаем, только если
        // дефицит не меньше рюкзака. Если крип уже везёт этот реагент — задачу
        // даём всегда, чтобы он сдал привезённое.
        //
        // ВАЖНО ПРО ПРОСТОЙ (config.paused). Простаивающую тройку НЕЛЬЗЯ
        // исключать из загрузки: простой означает «не варим», а не «тройка
        // выключена». Если тройка ушла в простой, ожидая первый подвоз реагента
        // (продукт ниже LOW), то именно эта загрузка и есть условие выхода из
        // простоя: lab.recipes.selectRecipe возобновляет работу только по
        // canRun(slot) — «реагенты реально лежат в lab1/lab2». Запрет загрузки
        // навсегда запирал бы тройку в простое (проверено и откачено).
        const cur1 = lab1.store[config.reagent1] || 0;
        if (cur1 < LAB_CAPACITY) {
          const needed1 = LAB_CAPACITY - cur1;
          const carries1 = (creep.store[config.reagent1] || 0) > 0;
          if (carries1 || needed1 >= freeCapacity) {
            const src = this.findSource(creep.room, config.reagent1, lab1);
            if (src) {
              creep.memory.task = "load_lab1";
              creep.memory.resource = config.reagent1;
              creep.memory.sourceId = src.id;
              creep.memory.targetId = config.lab1;
              creep.memory.labKey = key;
              creep.memory.amount = Math.min(
                needed1,
                src.store[config.reagent1],
                creep.store.getFreeCapacity(),
              );
              break;
            }
          }
        }

        // Приоритет 6: загрузить реагент2 в lab2 (та же логика гистерезиса)
        const cur2 = lab2.store[config.reagent2] || 0;
        if (cur2 < LAB_CAPACITY) {
          const needed2 = LAB_CAPACITY - cur2;
          const carries2 = (creep.store[config.reagent2] || 0) > 0;
          if (carries2 || needed2 >= freeCapacity) {
            const src = this.findSource(creep.room, config.reagent2, lab2);
            if (src) {
              creep.memory.task = "load_lab2";
              creep.memory.resource = config.reagent2;
              creep.memory.sourceId = src.id;
              creep.memory.targetId = config.lab2;
              creep.memory.labKey = key;
              creep.memory.amount = Math.min(
                needed2,
                src.store[config.reagent2],
                creep.store.getFreeCapacity(),
              );
              break;
            }
          }
        }
        }
      }
      }

      // Перебор не дал задачи — не повторяем его каждый тик.
      if (!creep.memory.task) {
        h.scanAt[roomName] = Game.time + LAB_WORKER.IDLE_SCAN_INTERVAL;
        return;
      }
    }

    // ── ВЫПОЛНЕНИЕ ЗАДАЧИ ─────────────────────────────────────────────────

    // Очистка лабы от чужого ресурса
    if (creep.memory.task === "clear_lab") {
      const target = Game.getObjectById(creep.memory.targetId);
      const dest = this.findDest(creep.room);
      if (!target || !dest) {
        creep.memory.task = null;
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        // Цель уже пуста (ресурс забрал другой крип) — задача невыполнима,
        // планируем заново. Без этой проверки задача висела бы на крипе вечно
        // (withdraw возвращает ERR_NOT_ENOUGH_RESOURCES каждый тик).
        if ((target.store[creep.memory.resource] || 0) === 0) {
          creep.memory.task = null;
          return;
        }
        const r = actIfNear(creep, target, () =>
          creep.withdraw(target, creep.memory.resource),
        );
        // Не-OK кроме «ещё не дошёл» (например, рюкзак забит другим ресурсом —
        // withdraw вернёт ERR_FULL): задача невыполнима, сбрасываем.
        if (r !== OK && r !== ERR_NOT_IN_RANGE) creep.memory.task = null;
      } else {
        const r = actIfNear(creep, dest, () =>
          creep.transfer(dest, creep.memory.resource),
        );
        // ERR_FULL: приёмник заполнен (в т.ч. другим крипом) — задача
        // выполнена настолько, насколько возможно. Сбрасываем её: остаток
        // груза крип перевезёт следующей задачей (ветка «уже везёт»), иначе он
        // слал бы transfer в полный приёмник каждый тик вечно.
        if (r === OK || r === ERR_FULL) creep.memory.task = null;
      }
      return;
    }

    // Выгрузка продукта из реактора
    if (creep.memory.task === "unload_reactor") {
      const reactor = Game.getObjectById(creep.memory.targetId);
      const dest = this.findDest(creep.room);
      if (!dest) {
        creep.say("❌ некуда");
        creep.memory.task = null;
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        if (!reactor || (reactor.store[creep.memory.resource] || 0) === 0) {
          creep.memory.task = null;
          return;
        }
        const r = actIfNear(creep, reactor, () =>
          creep.withdraw(reactor, creep.memory.resource),
        );
        if (r !== OK && r !== ERR_NOT_IN_RANGE) creep.memory.task = null;
      } else {
        const r = actIfNear(creep, dest, () =>
          creep.transfer(dest, creep.memory.resource),
        );
        if (r === OK || r === ERR_FULL) creep.memory.task = null;
      }
      return;
    }

    // Загрузка реагента в lab1 или lab2
    if (
      creep.memory.task === "load_lab1" ||
      creep.memory.task === "load_lab2"
    ) {
      const src =
        Game.getObjectById(creep.memory.sourceId) ||
        this.findSource(creep.room, creep.memory.resource);
      const dest = Game.getObjectById(creep.memory.targetId);
      if (!src || !dest) {
        creep.memory.task = null;
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        const have = src.store[creep.memory.resource] || 0;
        // Источник исчерпан (реагент забрал другой крип или его израсходовала
        // реакция) — задача невыполнима, планируем заново. Раньше это скрывал
        // сброс задачи на пустом рюкзаке.
        if (have === 0) {
          creep.memory.task = null;
          return;
        }
        // ДВИЖОК НЕ ОБРЕЗАЕТ amount. memory.amount мог устареть, пока крип ехал:
        // 5 единиц/тик выедает реакция у лабы-источника, а живой замер (153
        // withdraw, 67 ошибок) показал, что withdraw с завышенным amount
        // возвращает ERR_NOT_ENOUGH_RESOURCES и задача виснет навсегда. Берём
        // минимум с ТЕКУЩИМ остатком источника; 0/мусор в памяти = «сколько есть».
        const want = creep.memory.amount;
        const amount =
          typeof want === "number" && want > 0 ? Math.min(want, have) : have;
        const r = actIfNear(creep, src, () =>
          creep.withdraw(src, creep.memory.resource, amount),
        );
        if (r === OK) delete creep.memory.amount;
        // Любой другой не-OK, кроме «ещё не дошёл», означает невыполнимую
        // задачу — сбрасываем, иначе крип повторял бы проваленный withdraw вечно.
        else if (r !== ERR_NOT_IN_RANGE) creep.memory.task = null;
      } else {
        const r = actIfNear(creep, dest, () =>
          creep.transfer(dest, creep.memory.resource),
        );
        if (r === OK || r === ERR_FULL) creep.memory.task = null;
      }
      return;
    }
  },
};
