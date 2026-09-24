/**
 * ===================================================
 * LAB.MANAGER.JS — Утилита управления лабораториями
 * ===================================================
 * Запускается из roomManager каждый тик.
 * НЕ крип — просто запускает реакцию в реакторах.
 *
 * Поддерживает несколько троек лаб в одной комнате.
 * Конфиги хранятся в памяти комнаты:
 *   Memory.rooms['E35S37'].labs  — первая тройка
 *   Memory.rooms['E35S37'].labs2 — вторая тройка
 *   Memory.rooms['E35S37'].labs3 — третья тройка
 *   и так далее...
 *
 * Настройка через консоль:
 *   Memory.rooms['E35S37'].labs2 = {
 *     lab1: 'ID',
 *     lab2: 'ID',
 *     reactor: 'ID',
 *     reagent1: 'KH2O',
 *     reagent2: 'X',
 *     product: 'XKH2O'
 *   }
 *
 * ДВЕ РЕАКЦИИ НА ТРОЙКУ (docs/LAB_BOOST_PRODUCTION_PLAN.md): перед реакциями
 * менеджер синхронизирует тройки с планом LAB_PLAN (lab.recipes.sync) — там
 * лежат recipeA/recipeB и пороги LOW/HIGH, и оттуда же выбирается активный
 * рецепт. Выбор с гистерезисом, без таймера и без «длинных if по комнатам»:
 * вся логика — в lab.recipes.selectRecipe (чистая функция).
 *
 * При этом формат конфига для остального кода не изменился: активный рецепт
 * по-прежнему лежит в reagent1/reagent2/product, поэтому runReaction ниже
 * работает ровно так же, как раньше.
 * ===================================================
 */
const recipes = require("./lab.recipes");

const labManager = {
  /**
   * Ключи троек в Memory.rooms (порядок = порядок запуска реакций).
   * @param {Object} mem
   * @returns {Object[]}
   */
  getConfigs: function (mem) {
    const configs = [];
    if (mem.labs) configs.push(mem.labs);
    if (mem.labs2) configs.push(mem.labs2);
    if (mem.labs3) configs.push(mem.labs3);
    if (mem.labs4) configs.push(mem.labs4);
    if (mem.labs5) configs.push(mem.labs5);
    return configs;
  },

  /**
   * Слот, под который НАСТРОЕНА тройка (её проекция reagent1/reagent2/product).
   * Нужен для паузной тройки: активного слота у неё нет, но проекция заполнена
   * всегда (lab.recipes.applyPlan), и по ней восстанавливается, какая реакция
   * заряжена в lab1/lab2.
   * @param {Object} config
   * @returns {"A"|"B"}
   */
  projectedSlot: function (config) {
    if (!config.recipeA || !config.recipeB) return "A";
    const b = config.recipeB;
    if (
      config.reagent1 === b.reagent1 &&
      config.reagent2 === b.reagent2 &&
      config.product === b.product
    ) {
      return "B";
    }
    return "A";
  },

  /**
   * Слот, который РЕАЛЬНО может вариться прямо сейчас: сначала тот, под который
   * тройка заряжена проекцией (обычный случай), затем второй. Так паузная
   * тройка запускается и когда реагенты привезли под «не свой» рецепт — при
   * двух рецептах на тройку это штатная ситуация.
   * @param {Room} room
   * @param {Object} config
   * @returns {"A"|"B"}
   */
  readySlot: function (room, config) {
    const projected = this.projectedSlot(config);
    if (recipes.reactionReady(room, config, projected)) return projected;
    const other = projected === "A" ? "B" : "A";
    return recipes.reactionReady(room, config, other) ? other : projected;
  },

  runReaction: function (room, config) {
    if (!config) return;

    const lab1 = recipes.labById(room, config.lab1);
    const lab2 = recipes.labById(room, config.lab2);
    const reactor = recipes.labById(room, config.reactor);
    if (!lab1 || !lab2 || !reactor) return;
    if (reactor.cooldown > 0) return;

    if (config.recipeA && config.recipeB) {
      // Плановая тройка: движку нужно LAB_REACTION_AMOUNT (5) единиц КАЖДОГО
      // реагента. Прежняя проверка «> 0» пропускала реакцию с 1–4 единицами:
      // в живом shard3 в E35S37.labs лежало KH2O 500 и X 4, реакция XKH2O не
      // запускалась НИКОГДА, а тройка при этом выглядела «занятой».
      //
      // ТЗ ВЛАДЕЛЬЦА «ЗАПУСТИТЬ ЛАБЫ — ВСЕ»: `if (config.paused) return` здесь
      // БОЛЬШЕ НЕТ. Пауза (config.paused) — это решение ПЛАНА «продукт насыщен,
      // варить не нужно» (lab.recipes.selectRecipe вернул null по LOW/HIGH), и
      // она НЕ означает «тройка выключена». Пока реагенты физически лежат в
      // lab1/lab2, тройка варит: живые тройки простаивали именно так —
      // E36S38.labs с Z 2815 и O 2570 при ZO выше HIGH, E37S38.labs2.
      // Если заряженного слота нет, пробуем второй: у паузной тройки активного
      // слота не существует, а реагенты могли привезти под любой из двух.
      const slot = config.paused === true || !config.active
        ? this.readySlot(room, config)
        : config.active === "B"
          ? "B"
          : "A";
      if (!recipes.reactionReady(room, config, slot)) {
        this.warnOnce(
          "stall:" + room.name + ":" + slot + ":" + config.product,
          `[LabManager] ${room.name}.${slot} (${config.product}) не может вариться: ` +
            `${config.reagent1}=${lab1.store[config.reagent1] || 0} в lab1, ` +
            `${config.reagent2}=${lab2.store[config.reagent2] || 0} в lab2, ` +
            `движку нужно ≥ ${recipes.reactionAmount()}`,
        );
        return;
      }
    } else {
      // Конфиг без плана (ручная настройка Memory): прежняя проверка «> 0».
      if (!config.reagent1 || !lab1.store[config.reagent1]) return;
      if (!config.reagent2 || !lab2.store[config.reagent2]) return;
    }

    const result = reactor.runReaction(lab1, lab2);
    if (result !== OK && result !== ERR_TIRED) {
      // Ошибка реакции: конфиг/лаборатории разобраны выше, поэтому сюда
      // попадают только редкие состояния (например, смена рецепта на лету).
      // Лог намеренно не «каждый тик», но и НЕ молча: полностью глушить ошибку
      // нельзя — именно так в плане незамеченной жила НЕСУЩЕСТВУЮЩАЯ реакция
      // (UO + OH → "UH2O" в E37S38), из-за которой U-цепочка не производила
      // ничего месяцами. Одно сообщение на комнату+слот+код за сессию.
      this.warnOnce(
        "err:" + room.name + ":" + (config.active || "?") + ":" + result,
        `[LabManager] ${room.name}.${config.active || "?"}: реакция ` +
          `${config.reagent1} + ${config.reagent2} → ${config.product} вернула код ${result}`,
      );
    }
  },

  /**
   * Разовое предупреждение по ключу (heap-кэш): одна и та же проблема по
   * комнате+слоту печатается один раз за сессию — без спама каждый тик и без
   * записей в Memory.
   * @param {string} key
   * @param {string} message
   */
  warnOnce: function (key, message) {
    if (!global._labManagerWarn) global._labManagerWarn = {};
    if (global._labManagerWarn[key]) return;
    global._labManagerWarn[key] = true;
    console.log(message);
  },
  run: function (room) {
    // Bootstrap привязки троек: если слоты labs*/lab1|lab2|reactor в Memory
    // разошлись с координатами LAB_BINDING (в живом shard3 labs3 дублировал
    // labs, а три лаборатории простаивали) — привязка починяется здесь, ДО
    // sync (рецепты и пороги допишет обычный applyPlan). Отдельного
    // планировщика нет.
    try {
      recipes.ensureTriples(room);
    } catch (e) {
      console.log(
        `[LabManager] binding ${room.name}: ${e && e.stack ? e.stack : e}`,
      );
    }

    // Bootstrap буст-лабы: если Memory.rooms[room].boostLab нет (Global Reset,
    // правка Memory, новый деплой), запись восстанавливается из конфигурации
    // комнаты (LAB_BOOST.BOOST_LAB). Восстановление идёт здесь, потому что
    // labManager — первая подсистема комнаты в тике (room.manager.runRoom), то
    // есть ДО labWorker, терминальной сети, рынка и boost.manager: все они в
    // этом же тике видят уже непустую запись. Отдельного планировщика нет.
    let bootstrapBoostLab = null;
    try {
      bootstrapBoostLab = recipes.ensureBoostLab(room);
    } catch (e) {
      console.log(
        `[LabManager] boostLab ${room.name}: ${e && e.stack ? e.stack : e}`,
      );
    }

    // Синхронизация плана: дописывает recipeA/recipeB/пороги в конфиги троек
    // (один раз при первом запуске или смене LAB_PLAN) и выбирает активный
    // рецепт по дефициту с гистерезисом. В обычном тике — почти бесплатно:
    // пока рецепт валиден, в Memory ничего не пишется, а склады не читаются.
    // Ошибка плана не должна ломать реакции: комната без плана (или с битым
    // конфигом) продолжает работать в прежнем однореечном режиме.
    let configs;
    try {
      recipes.sync(room);
      configs = this.getConfigs(room.memory);
    } catch (e) {
      console.log(
        `[LabManager] plan ${room.name}: ${e && e.stack ? e.stack : e}`,
      );
      configs = this.getConfigs(room.memory);
    }

    for (const config of configs) {
      this.runReaction(room, config);
    }

    return bootstrapBoostLab;
  },
};
module.exports = labManager;
