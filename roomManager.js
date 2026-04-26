const factory = require("./factory");
const roleTower = require("./role.tower");

const roomManager = {
  run: function (room) {
    /**
     * =========================================
     * 0. КЭШ СТРУКТУР С TTL (НОВОЕ)
     * =========================================
     */

    // Если кэша нет ИЛИ прошло 10 тиков → обновляем
    if (!room.memory.energyTargets || Game.time % 10 === 0) {
      // ДОРОГАЯ операция — поэтому делаем редко
      const energyTargets = room.find(FIND_MY_STRUCTURES, {
        filter: s =>
          // Интересующие нас структуры
          (s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_TOWER) &&
          // Только те, куда можно передать энергию
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });

      // Сохраняем только ID (Memory безопасен только для JSON)
      room.memory.energyTargets = energyTargets.map(s => s.id);
    }

    /**
     * Runtime-кэш (на 1 тик)
     * Здесь мы превращаем ID обратно в объекты
     * Это делается 1 раз на комнату, а не в каждом крипе
     */
    room._energyTargets = room.memory.energyTargets
      .map(id => Game.getObjectById(id)) // превращаем ID → объект
      .filter(obj => obj); // удаляем null (если структура исчезла)

    /**
     * =========================================
     * 1. ЛОКАЛЬНЫЙ ПЛАН
     * =========================================
     */
    let localRolesConfig = [
      { role: "test_harvester", count: 1 },
      { role: "test_miner", count: 2 },
      { role: "test_hauler", count: 2 },
      { role: "test_towerSupplier", count: 2 },
      { role: "test_builder", count: 1 },
      { role: "test_upgrader", count: 1 },
      { role: "test_repairer", count: 1 },
      { role: "test_mineralMiner", count: 0 },
    ];

    /**
     * =========================================
     * 2. ГЛОБАЛЬНЫЙ ПЛАН
     * =========================================
     */
    let globalRolesConfig = [];

    globalRolesConfig.push({ role: "test_attacker", count: 0 });

    if (room.name === "E35S37") {
      globalRolesConfig.push({ role: "test_reserver", count: 0 });
      globalRolesConfig.push({ role: "test_remoteMiner", count: 0 });
      globalRolesConfig.push({ role: "test_remoteHauler", count: 0 });
    }

    /**
     * =========================================
     * 3. ПОДСЧЕТ КРИПОВ
     * =========================================
     */

    // Все крипы в игре (для глобальных ролей)
    const allCreeps = Object.values(Game.creeps);

    // Только крипы в этой комнате
    const roomCreeps = room.find(FIND_MY_CREEPS);

    // Группировка по ролям (удобно и быстро)
    const globalGroups = _.groupBy(allCreeps, c => c.memory.role);
    const localGroups = _.groupBy(roomCreeps, c => c.memory.role);

    /**
     * Балансировка по источникам
     * Чтобы крипы не шли все в один источник
     */
    let sourceUsage = { 0: 0, 1: 0 };

    roomCreeps.forEach(c => {
      if (c.memory.sourceIndex !== undefined) {
        sourceUsage[c.memory.sourceIndex]++;
      }
    });

    /**
     * =========================================
     * 4. СПАВН
     * =========================================
     */

    // Ищем свободный спавн (не занят спавном)
    const spawns = room.find(FIND_MY_SPAWNS, {
      filter: s => !s.spawning,
    });

    const spawn = spawns[0];

    if (spawn) {
      // Объединяем локальные и глобальные роли
      const fullConfig = [...localRolesConfig, ...globalRolesConfig];

      for (let roleData of fullConfig) {
        // Проверяем: роль глобальная или локальная
        const isGlobal = globalRolesConfig.some(r => r.role === roleData.role);

        // Выбираем правильный счетчик
        const currentCount = isGlobal
          ? (globalGroups[roleData.role] || []).length
          : (localGroups[roleData.role] || []).length;

        // Если крипов меньше, чем нужно → спавним
        if (currentCount < roleData.count) {
          // Выбираем менее загруженный источник
          const bestIndex = sourceUsage[0] <= sourceUsage[1] ? 0 : 1;

          const result = factory.run(spawn, roleData, bestIndex);

          // ВАЖНО: только 1 крип за тик (экономия CPU и контроль)
          if (result === OK) break;
        }
      }
    }

    /**
     * =========================================
     * 5. БАШНИ
     * =========================================
     */

    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER,
    });

    towers.forEach(tower => roleTower.run(tower));
  },
};

module.exports = roomManager;
