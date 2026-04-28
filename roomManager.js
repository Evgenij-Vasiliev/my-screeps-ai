// Подключаем модуль для создания крипов (спавна)
const factory = require("./factory");
// Подключаем модуль логики башен
const roleTower = require("./role.tower");

const roomManager = {
  // Метод run вызывается каждый тик для каждой комнаты, которой мы владеем
  run: function (room) {
    /**
     * =========================================
     * 0. ENERGY TARGETS (цели для заправки энергией)
     * =========================================
     * Спавны и расширения (Extensions) нужно постоянно заправлять энергией.
     * Искать их через room.find() каждый тик — дорого по CPU.
     * Решение: кэшируем ID объектов в памяти комнаты (room.memory).
     * room.memory сохраняется между тиками, в отличие от обычных переменных.
     *
     * ИСПРАВЛЕНИЕ: убрали кэш по таймеру (Game.time % 10).
     * Проблема была в том, что структура могла заполниться, но крип
     * всё равно шёл к ней ещё 10 тиков. Теперь пересканируем каждый тик,
     * но только те структуры, у которых есть свободное место.
     */
    {
      const energyTargets = room.find(FIND_MY_STRUCTURES, {
        filter: s =>
          // Ищем только спавны и расширения...
          (s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_SPAWN) &&
          // ...у которых есть место для энергии (не заполнены)
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });

      // Сохраняем только ID, а не сами объекты.
      // Объекты нельзя хранить в Memory — там только простые данные (числа, строки, массивы).
      room.memory.energyTargets = energyTargets.map(s => s.id);

      // Восстанавливаем объекты по ID для использования в этом тике.
      // Привязываем к room._ (временное хранилище на один тик, не сохраняется в Memory).
      room._energyTargets = energyTargets;
    }

    /**
     * =========================================
     * 1. БАШНИ
     * =========================================
     * Башни не меняются часто — их не строят и не разрушают каждый тик.
     * Поэтому кэшируем их ID в памяти и пересканируем редко (раз в 50 тиков).
     * Game.time — это счётчик тиков с начала игры. % 50 === 0 значит
     * "выполни это один раз каждые 50 тиков".
     */
    if (!room.memory.towers || Game.time % 50 === 0) {
      const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
      });
      room.memory.towers = towers.map(t => t.id);
    }

    // Восстанавливаем объекты башен по ID.
    // .filter(obj => obj) убирает null — на случай если башня была разрушена.
    room._towers = (room.memory.towers || [])
      .map(id => Game.getObjectById(id))
      .filter(obj => obj);

    /**
     * =========================================
     * 2. ИСТОЧНИКИ ЭНЕРГИИ
     * =========================================
     * Источники (Sources) никогда не исчезают из комнаты — их можно
     * кэшировать один раз навсегда (!room.memory.sources).
     */
    if (!room.memory.sources) {
      const sources = room.find(FIND_SOURCES);
      room.memory.sources = sources.map(s => s.id);
    }

    room._sources = room.memory.sources
      .map(id => Game.getObjectById(id))
      .filter(obj => obj);

    /**
     * =========================================
     * 3. КОНТЕЙНЕРЫ У ИСТОЧНИКОВ
     * =========================================
     * Контейнеры могут быть построены или разрушены, поэтому
     * не кэшируем навсегда — проверяем существование каждый тик,
     * и пересканируем только если контейнер исчез.
     */
    if (!room.memory.sourceContainers) {
      room.memory.sourceContainers = [];
    }

    room._sourceContainers = [];

    // Проходим по каждому источнику и ищем рядом контейнер
    room._sources.forEach((source, index) => {
      let container = null;
      const containerId = room.memory.sourceContainers[index];

      // Пробуем получить контейнер из кэша по сохранённому ID
      if (containerId) {
        container = Game.getObjectById(containerId);
      }

      // Если контейнера нет (не построен или разрушен) — ищем заново
      if (!container) {
        // findInRange ищет структуры в радиусе 2 клеток от источника
        container =
          source.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
          })[0] || null;

        // Обновляем кэш: записываем новый ID или null если не нашли
        room.memory.sourceContainers[index] = container ? container.id : null;
      }

      room._sourceContainers[index] = container;
    });

    /**
     * =========================================
     * 4. КОНФИГУРАЦИЯ РОЛЕЙ
     * =========================================
     * localRolesConfig — крипы, которые считаются по комнате.
     * Например, нам нужно 2 майнера именно в этой комнате.
     *
     * globalRolesConfig — крипы, которые считаются по всей игре.
     * Например, атакеры могут находиться в любой комнате.
     */

    // Локальные роли: счётчик ведётся по крипам в ЭТОЙ комнате
    const localRolesConfig = [
      { role: "test_harvester", count: 1 },
      { role: "test_miner", count: 2 },
      { role: "test_hauler", count: 4 },
      { role: "test_towerSupplier", count: 1 },
      { role: "test_builder", count: 1 },
      { role: "test_upgrader", count: 1 },
      { role: "test_repairer", count: 1 },
      { role: "test_mineralMiner", count: 1 },
    ];

    // Глобальные роли: счётчик ведётся по ВСЕМ крипам в игре
    const globalRolesConfig = [];

    // Атакеры нужны только если есть враги — убрали безусловный спавн 5 атакеров,
    // это съедало энергию впустую. Пока оставляем 0, добавим логику позже.
    // globalRolesConfig.push({ role: "test_attacker", count: 5 });

    // Удалённые роли только для конкретной комнаты E35S37
    if (room.name === "E35S37") {
      globalRolesConfig.push({ role: "test_reserver", count: 2 });
      globalRolesConfig.push({ role: "test_remoteMiner", count: 2 });
      globalRolesConfig.push({ role: "test_remoteHauler", count: 2 });
    }

    /**
     * =========================================
     * 5. ПОДСЧЁТ КРИПОВ
     * =========================================
     * _.groupBy — это утилита библиотеки Lodash, встроенной в Screeps.
     * Она группирует массив по ключу. Результат выглядит так:
     * { "test_miner": [creep1, creep2], "test_hauler": [creep3], ... }
     *
     * ИСПРАВЛЕНИЕ: заменили Object.values(Game.creeps) на for...in.
     * Object.values создаёт временный массив — лишняя работа для движка.
     */

    // Собираем всех крипов в массив через for...in (дешевле чем Object.values)
    const allCreeps = [];
    for (const name in Game.creeps) {
      allCreeps.push(Game.creeps[name]);
    }

    // Крипы только в этой комнате
    const roomCreeps = room.find(FIND_MY_CREEPS);

    // Группируем: { "роль": [крип1, крип2, ...] }
    const globalGroups = _.groupBy(allCreeps, c => c.memory.role);
    const localGroups = _.groupBy(roomCreeps, c => c.memory.role);

    /**
     * Подсчёт занятости источников.
     * ИСПРАВЛЕНИЕ: раньше было { 0: 0, 1: 0 } — работало только при 2 источниках.
     * Теперь создаём объект динамически под реальное количество источников.
     */
    const sourceUsage = {};
    // Инициализируем счётчик для каждого источника
    room._sources.forEach((_, index) => {
      sourceUsage[index] = 0;
    });
    // Считаем сколько крипов уже назначено на каждый источник
    roomCreeps.forEach(c => {
      if (
        c.memory.sourceIndex !== undefined &&
        sourceUsage[c.memory.sourceIndex] !== undefined
      ) {
        sourceUsage[c.memory.sourceIndex]++;
      }
    });

    /**
     * =========================================
     * 6. СПАВН КРИПОВ
     * =========================================
     * Ищем свободный спавн (не занятый созданием крипа прямо сейчас).
     * Если спавн занят — s.spawning содержит данные о текущем крипе.
     */
    const spawns = room.find(FIND_MY_SPAWNS, {
      filter: s => !s.spawning, // только свободные спавны
    });

    const spawn = spawns[0]; // берём первый свободный (обычно он один)

    if (spawn) {
      // Объединяем локальный и глобальный конфиги в один список
      const fullConfig = [...localRolesConfig, ...globalRolesConfig];

      for (const roleData of fullConfig) {
        // Определяем: это глобальная роль или локальная?
        const isGlobal = globalRolesConfig.some(r => r.role === roleData.role);

        // Считаем текущее количество крипов этой роли
        const currentCount = isGlobal
          ? (globalGroups[roleData.role] || []).length // по всей игре
          : (localGroups[roleData.role] || []).length; // только в этой комнате

        // Если крипов меньше нужного — спавним
        if (currentCount < roleData.count) {
          // Выбираем источник с наименьшей нагрузкой
          // Object.entries превращает { 0: 2, 1: 1 } в [[0,2],[1,1]]
          // Затем находим пару с минимальным значением
          const bestIndex = Number(
            Object.entries(sourceUsage).sort((a, b) => a[1] - b[1])[0][0],
          );

          // factory.run пытается создать крипа и возвращает OK если успешно
          const result = factory.run(spawn, roleData, bestIndex);

          // Если спавн принял команду — выходим из цикла.
          // Нельзя спавнить двух крипов одновременно!
          if (result === OK) break;
        }
      }
    }

    /**
     * =========================================
     * 7. ЛОГИКА БАШЕН
     * =========================================
     * Запускаем логику для каждой башни в комнате.
     * Башни атакуют врагов, лечат своих, ремонтируют структуры —
     * всё это описано в role.tower.js.
     */
    if (room._towers && room._towers.length > 0) {
      room._towers.forEach(tower => roleTower.run(tower));
    }
  },
};

module.exports = roomManager;
