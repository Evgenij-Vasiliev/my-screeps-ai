/**
 * ===================================================
 * FACTORY.JS — Фабрика крипов
 * ===================================================
 * Этот модуль отвечает за создание (спавн) крипов.
 *
 * Как это работает:
 * 1. blueprints — "чертежи" крипов. Каждый чертёж описывает
 *    тело (body) и начальную память (memory) для роли.
 * 2. prepareBody — удобная функция для сборки тела крипа
 *    из именованных параметров.
 * 3. factory.run — вызывается из roomManager, берёт нужный
 *    чертёж и отдаёт команду спавну.
 * ===================================================
 */

/**
 * prepareBody — собирает массив частей тела крипа.
 *
 * Почему порядок частей тела важен:
 * - TOUGH идёт первым — урон снимается с частей по порядку,
 *   TOUGH дешевле чинить буффами, поэтому его "подставляют" первым.
 * - MOVE идёт последним — его повреждение снижает скорость,
 *   лучше потерять его в последнюю очередь.
 * - Остальные части идут в середине по логике роли.
 *
 * Стоимость частей тела (энергия):
 * MOVE=50, WORK=100, CARRY=50, ATTACK=80,
 * RANGED_ATTACK=150, HEAL=250, CLAIM=600, TOUGH=10
 *
 * @param {object} parts — объект с количеством каждой части
 * @returns {string[]} — массив констант частей тела
 */
const prepareBody = ({
  work = 0,
  carry = 0,
  move = 0,
  attack = 0,
  tough = 0,
  ranged_attack = 0,
  heal = 0,
  claim = 0,
} = {}) => {
  // Собираем тело в правильном порядке: броня → рабочие части → движение
  const body = [];
  for (let i = 0; i < tough; i++) body.push(TOUGH);
  for (let i = 0; i < work; i++) body.push(WORK);
  for (let i = 0; i < carry; i++) body.push(CARRY);
  for (let i = 0; i < attack; i++) body.push(ATTACK);
  for (let i = 0; i < ranged_attack; i++) body.push(RANGED_ATTACK);
  for (let i = 0; i < heal; i++) body.push(HEAL);
  for (let i = 0; i < claim; i++) body.push(CLAIM);
  for (let i = 0; i < move; i++) body.push(MOVE);

  return body;
};

const factory = {
  /**
   * blueprints — словарь чертежей крипов.
   *
   * Каждый чертёж — это функция, которая принимает (spawn, bestIndex)
   * и возвращает объект { body, memory }.
   *
   * Почему функция, а не просто объект?
   * Потому что некоторые крипы (miner, mineralMiner) нуждаются
   * в данных из комнаты на момент спавна — ID источника и т.д.
   *
   * =====================================================
   * НАСТРОЙКА ТЕЛ КРИПОВ — РЕДАКТИРУЙ ЗДЕСЬ
   * Меняй числа в prepareBody чтобы изменить состав крипа.
   * Помни: максимум 50 частей на крипа, лимит энергии спавна.
   * =====================================================
   */
  blueprints: {
    // ----- ДОБЫВАЮЩИЕ -----

    // Статичный майнер: сидит у источника и копает.
    // work:5 = максимальная добыча (3000 энергии за 300 тиков = весь источник).
    // move:2 = только добраться до места, потом стоит неподвижно.
    // ИСПРАВЛЕНИЕ: берём sourceId из room.memory (уже закэшировано),
    // а не делаем новый find() каждый раз.
    test_miner: (spawn, bestIndex) => {
      const sourceId = (spawn.room.memory.sources || [])[bestIndex] || null;
      return {
        body: prepareBody({ work: 5, move: 2 }),
        memory: { sourceId },
      };
    },

    // Перевозчик: забирает энергию из контейнера и несёт в хранилище/спавн.
    // carry:3, move:3 — базовый вариант. Увеличь carry для дальних маршрутов.
    test_hauler: () => ({
      body: prepareBody({ carry: 3, move: 3 }),
      memory: {},
    }),

    // Харвестер: сам копает и сам несёт. Нужен на старте до постройки контейнеров.
    // work:1, carry:1, move:1 — минимальный крип (300 энергии).
    test_harvester: () => ({
      body: prepareBody({ work: 1, carry: 1, move: 1 }),
      memory: {},
    }),

    // Майнер минералов: копает минерал в комнате (нужен Extractor на RCL6+).
    // ИСПРАВЛЕНИЕ: берём mineralId из room.memory если есть,
    // иначе делаем find() как запасной вариант.
    test_mineralMiner: spawn => {
      let mineralId = null;
      // Сначала проверяем кэш в памяти комнаты
      if (spawn.room.memory.mineralId) {
        mineralId = spawn.room.memory.mineralId;
      } else {
        // Если кэша нет — ищем и сохраняем на будущее
        const minerals = spawn.room.find(FIND_MINERALS);
        mineralId = minerals.length > 0 ? minerals[0].id : null;
        spawn.room.memory.mineralId = mineralId;
      }
      return {
        body: prepareBody({ work: 5, carry: 5, move: 5 }),
        memory: { mineralId },
      };
    },

    // ----- СТРОИТЕЛИ И РЕМОНТНИКИ -----

    // Строитель: строит конструкции (дороги, контейнеры, стены).
    // work:4 = скорость строительства. carry:4 = запас энергии.
    // move:8 = нужно много движения, т.к. много путешествует по комнате.
    test_builder: () => ({
      body: prepareBody({ work: 4, carry: 4, move: 8 }),
      memory: {},
    }),

    // Ремонтник: чинит дороги и контейнеры.
    // work:2, carry:2, move:2 — сбалансированный состав.
    test_repairer: () => ({
      body: prepareBody({ work: 2, carry: 2, move: 2 }),
      memory: {},
    }),

    // ----- РАЗВИТИЕ -----

    // Апгрейдер: улучшает контроллер. Чем больше work — тем быстрее.
    // work:2, carry:2, move:4 — двигается быстро к контроллеру.
    test_upgrader: () => ({
      body: prepareBody({ work: 2, carry: 2, move: 4 }),
      memory: {},
    }),

    // Поставщик башен: носит энергию в башни (Towers).
    // carry:3, move:3 — небольшой, но шустрый.
    test_towerSupplier: () => ({
      body: prepareBody({ carry: 3, move: 3 }),
      memory: {},
    }),

    // ----- УДАЛЁННЫЕ ОПЕРАЦИИ -----

    // Удалённый майнер: работает в соседней комнате.
    // work:6 = быстро копает. carry:1 = минимум (оставляет энергию для hauler).
    // move:3 = достаточно для перемещения между комнатами.
    test_remoteMiner: () => ({
      body: prepareBody({ work: 6, carry: 1, move: 3 }),
      memory: {},
    }),

    // Удалённый перевозчик: возит энергию из соседней комнаты.
    // carry:20, move:20 = максимальная грузоподъёмность с полной скоростью.
    // Дорого! (2000 энергии). Нужен высокий уровень комнаты.
    test_remoteHauler: () => ({
      body: prepareBody({ carry: 20, move: 20 }),
      memory: { working: false },
    }),

    // Резервист: резервирует контроллер в соседней комнате (не даёт деградировать).
    // claim:2 = резервирует быстрее. move:2 = передвижение.
    test_reserver: () => ({
      body: prepareBody({ claim: 2, move: 2 }),
      memory: { working: false },
    }),

    // ----- ВОЕННЫЕ -----

    // Атакер: боевой крип для защиты или атаки.
    // tough:10 = "броня" (принимает урон первой, дёшево чинится буффами).
    // ranged_attack:10 = дистанционная атака.
    // heal:5 = самолечение в бою.
    // move:25 = нужно много движения для тяжёлого крипа.
    test_attacker: () => ({
      body: prepareBody({
        tough: 10,
        ranged_attack: 10,
        heal: 5,
        move: 25,
      }),
      memory: { targetRoom: null },
    }),

    // ----- ЗАПАСНОЙ ВАРИАНТ -----

    // Используется если роль не найдена в blueprints.
    // Минимальный крип, который хотя бы не упадёт с ошибкой.
    default: () => ({
      body: prepareBody({ work: 1, carry: 1, move: 1 }),
      memory: {},
    }),
  },

  /**
   * run — главный метод фабрики. Вызывается из roomManager.
   *
   * @param {StructureSpawn} spawn    — объект спавна
   * @param {object}         roleData — { role: "test_miner", count: 2 }
   * @param {number}         bestIndex — индекс источника с наименьшей нагрузкой
   * @returns {number} — код результата: OK (0) или код ошибки
   */
  run: function (spawn, roleData, bestIndex) {
    // Берём чертёж для роли, или дефолтный если роль неизвестна
    const blueprintFunc =
      this.blueprints[roleData.role] || this.blueprints["default"];

    // Вызываем функцию-чертёж — она вернёт { body, memory }
    const blueprint = blueprintFunc(spawn, bestIndex);

    // Проверка: тело не должно быть пустым
    if (!blueprint.body || blueprint.body.length === 0) {
      console.log(`[Factory] ОШИБКА: пустое тело для роли ${roleData.role}`);
      return ERR_INVALID_ARGS;
    }

    // Собираем итоговую память крипа.
    // Object.assign объединяет объекты: базовые поля + поля из чертежа.
    // Если в blueprint.memory есть то же поле — оно перезапишет базовое.
    const finalMemory = Object.assign(
      {
        role: roleData.role, // роль обязательна — по ней main.js находит модуль
        sourceIndex: bestIndex, // индекс источника для балансировки
        working: false, // стартовое состояние (большинство ролей используют)
      },
      blueprint.memory,
    );

    // Уникальное имя крипа: "роль_тик". Game.time гарантирует уникальность.
    const name = `${roleData.role}_${Game.time}`;

    // Отдаём команду спавну и возвращаем результат (OK или код ошибки)
    const result = spawn.spawnCreep(blueprint.body, name, {
      memory: finalMemory,
    });

    // Логируем только реальные ошибки (не ERR_NOT_ENOUGH_ENERGY — это норма)
    if (
      result !== OK &&
      result !== ERR_NOT_ENOUGH_ENERGY &&
      result !== ERR_BUSY
    ) {
      console.log(`[Factory] Ошибка спавна ${roleData.role}: ${result}`);
    }

    return result;
  },
};

module.exports = factory;
