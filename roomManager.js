/**
 * ===================================================
 * ROOMMANAGER.JS — Менеджер комнат
 * ===================================================
 * Запускается каждый тик для каждой комнаты под контролем.
 *
 * ОПТИМИЗАЦИИ:
 * - energyTargets: каждый тик (меняется быстро — спавн/расширения берут энергию)
 * - hasSites, needsRepair: раз в 100 тиков (медленно меняются)
 * - towers: раз в 50 тиков (башни не появляются часто)
 * - sources, sourceContainers, mineralId: один раз навсегда (в memory)
 * - allCreeps: один цикл for...in вместо _.groupBy + find
 * - roomCreeps: фильтр из уже собранного массива (не отдельный find)
 * ===================================================
 */

const factory = require("./factory");
const roleTower = require("./role.tower");
const terminalManager = require("./terminalManager");

const REMOTE_ROOMS = ["E35S38", "E36S37"];

const roomManager = {
  run: function (room) {
    // ── 1. ENERGY TARGETS — каждый тик ────────────────────────────────────
    // Меняется быстро: крипы берут энергию из спавна/расширений каждый тик.
    // Кэшировать нельзя — дадим устаревший список и крип пойдёт в уже
    // заполненную структуру.
    {
      const energyTargets = room.find(FIND_MY_STRUCTURES, {
        filter: s =>
          (s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_SPAWN) &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });
      room.memory.energyTargets = energyTargets.map(s => s.id);
      room._energyTargets = energyTargets;
    }

    // ── 2. БАШНИ — раз в 50 тиков ─────────────────────────────────────────
    // Башни не строятся часто. Кэш в memory переживает перезагрузку скрипта.
    if (!room.memory.towers || Game.time % 50 === 0) {
      const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
      });
      room.memory.towers = towers.map(t => t.id);
    }
    room._towers = room.memory.towers
      .map(id => Game.getObjectById(id))
      .filter(Boolean);

    // ── 3. ИСТОЧНИКИ — один раз навсегда ──────────────────────────────────
    // Источники энергии не меняются никогда.
    if (!room.memory.sources) {
      const sources = room.find(FIND_SOURCES);
      room.memory.sources = sources.map(s => s.id);
    }
    room._sources = room.memory.sources
      .map(id => Game.getObjectById(id))
      .filter(Boolean);

    // ── 4. КОНТЕЙНЕРЫ У ИСТОЧНИКОВ — с проверкой валидности ───────────────
    // Контейнеры могут быть разрушены — проверяем что объект ещё существует.
    if (!room.memory.sourceContainers) {
      room.memory.sourceContainers = [];
    }
    room._sourceContainers = [];

    room._sources.forEach((source, index) => {
      let container = null;
      const containerId = room.memory.sourceContainers[index];

      if (containerId) {
        container = Game.getObjectById(containerId);
      }

      // Если контейнер разрушен или не найден — ищем заново
      if (!container) {
        container =
          source.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
          })[0] || null;
        room.memory.sourceContainers[index] = container ? container.id : null;
      }

      room._sourceContainers[index] = container;
    });

    // ── 5. МИНЕРАЛ — раз в 100 тиков ──────────────────────────────────────
    // Минерал восстанавливается медленно (~50000 тиков).
    // Проверяем редко — только не ноль ли там.
    if (!room.memory.mineralId || Game.time % 100 === 0) {
      const minerals = room.find(FIND_MINERALS);
      room.memory.mineralId = minerals.length > 0 ? minerals[0].id : null;
    }
    const mineral = room.memory.mineralId
      ? Game.getObjectById(room.memory.mineralId)
      : null;

    // ИСПРАВЛЕНИЕ: в Screeps shard3 поле называется mineralAmount, а не amount.
    // mineral.amount всегда undefined → старое условие было всегда true →
    // mineralMiner спавнились даже когда минерал полностью истощён.
    const mineralAvailable = mineral && mineral.mineralAmount > 0;

    // ── 6. СТРОЙКИ — раз в 100 тиков ──────────────────────────────────────
    // ОПТИМИЗАЦИЯ: раньше find() по стройкам шёл каждый тик.
    // Стройки появляются редко — достаточно проверять раз в 100 тиков.
    if (room.memory.hasSites === undefined || Game.time % 100 === 0) {
      room.memory.hasSites = room.find(FIND_CONSTRUCTION_SITES).length > 0;
    }
    const hasSites = room.memory.hasSites;

    // ── 7. РЕМОНТ — раз в 100 тиков ───────────────────────────────────────
    // ОПТИМИЗАЦИЯ: раньше find() по всем структурам шёл каждый тик.
    // Структуры теряют хиты медленно — достаточно проверять раз в 100 тиков.
    if (room.memory.needsRepair === undefined || Game.time % 100 === 0) {
      room.memory.needsRepair =
        room.find(FIND_STRUCTURES, {
          filter: s =>
            s.hits < s.hitsMax * 0.8 &&
            s.structureType !== STRUCTURE_WALL &&
            s.structureType !== STRUCTURE_RAMPART,
        }).length > 0;
    }
    const needsRepair = room.memory.needsRepair;

    // ── 8. ПОДСЧЁТ КРИПОВ — один цикл вместо двух ─────────────────────────
    // Теперь: один for...in, два простых объекта-счётчика.
    // localGroups  — крипы в этой комнате по роли
    // globalGroups — все крипы игры по роли

    const localGroups = {}; // { role: count } для этой комнаты
    const globalGroups = {}; // { role: count } для всей игры
    const roomCreeps = []; // крипы этой комнаты (для sourceUsage)
    let attackersHere = 0; // атакеры приписанные к этой комнате

    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      const role = creep.memory.role;

      // Глобальный счётчик — все крипы
      globalGroups[role] = (globalGroups[role] || 0) + 1;

      // Локальный счётчик — только крипы этой комнаты
      if (creep.room.name === room.name) {
        localGroups[role] = (localGroups[role] || 0) + 1;
        roomCreeps.push(creep);
      }

      // Считаем атакеров приписанных к этой комнате
      if (role === "test_attacker" && creep.memory.homeRoom === room.name) {
        attackersHere++;
      }
    }

    // ── 9. КОНФИГУРАЦИЯ РОЛЕЙ ──────────────────────────────────────────────
    const needsUpgrader =
      room.controller && room.controller.ticksToDowngrade < 100000 ? 1 : 0;

    const attackerCount = room.name === "E35S37" ? 0 : 1;

    const localRolesConfig = [
      { role: "test_harvester", count: 1 },
      { role: "test_miner", count: 2 },
      { role: "test_hauler", count: 2 },
      { role: "test_towerSupplier", count: 1 },
      { role: "test_builder", count: hasSites ? 1 : 0 },
      { role: "test_upgrader", count: needsUpgrader },
      { role: "test_repairer", count: needsRepair ? 1 : 0 },
      // ИСПРАВЛЕНИЕ: mineralAvailable теперь использует mineral.mineralAmount
      { role: "test_mineralMiner", count: mineralAvailable ? 2 : 0 },
    ];

    const globalRolesConfig = [];
    if (room.name === "E35S37") {
      globalRolesConfig.push({ role: "test_reserver", count: 2 });
      globalRolesConfig.push({ role: "test_remoteMiner", count: 2 });
      globalRolesConfig.push({ role: "test_remoteHauler", count: 2 });
    }

    // ── 10. БАЛАНСИРОВКА ИСТОЧНИКОВ ───────────────────────────────────────
    // Считаем сколько крипов уже назначено на каждый источник.
    // Новый крип получит наименее загруженный источник.
    const sourceUsage = {};
    room._sources.forEach((_, index) => {
      sourceUsage[index] = 0;
    });

    roomCreeps.forEach(c => {
      if (
        (c.memory.role === "test_miner" ||
          c.memory.role === "test_hauler" ||
          c.memory.role === "test_harvester") &&
        c.memory.sourceIndex !== undefined &&
        sourceUsage[c.memory.sourceIndex] !== undefined
      ) {
        sourceUsage[c.memory.sourceIndex]++;
      }
    });

    // ── 11. СПАВН ─────────────────────────────────────────────────────────
    const spawns = room.find(FIND_MY_SPAWNS, { filter: s => !s.spawning });
    const spawn = spawns[0];

    if (spawn) {
      // Атакеры — высший приоритет если их не хватает
      if (attackerCount > 0 && attackersHere < attackerCount) {
        const result = factory.run(spawn, { role: "test_attacker" }, 0);
        if (result === OK) {
          room._towers.forEach(tower => roleTower.run(tower));
          return;
        }
      }

      // Обычные роли — по порядку конфига
      const fullConfig = [...localRolesConfig, ...globalRolesConfig];

      for (const roleData of fullConfig) {
        const isGlobal = globalRolesConfig.some(r => r.role === roleData.role);
        const currentCount = isGlobal
          ? globalGroups[roleData.role] || 0
          : localGroups[roleData.role] || 0;

        if (currentCount < roleData.count) {
          const bestIndex = Number(
            Object.entries(sourceUsage).sort((a, b) => a[1] - b[1])[0][0],
          );

          // Для удалённых ролей назначаем свободную комнату
          const remoteRoles = [
            "test_remoteMiner",
            "test_remoteHauler",
            "test_reserver",
          ];
          if (remoteRoles.includes(roleData.role)) {
            const taken = Object.values(Game.creeps)
              .filter(
                c =>
                  c.memory.role === roleData.role &&
                  (c.memory.target || c.memory.targetRoom),
              )
              .map(c => c.memory.target || c.memory.targetRoom);

            roleData.targetRoom =
              REMOTE_ROOMS.find(r => !taken.includes(r)) || REMOTE_ROOMS[0];
          }

          const result = factory.run(spawn, roleData, bestIndex);
          if (result === OK) break;
        }
      }
    }

    // ── Продажа ресурсов ───────────────────────────────────────────────────
    terminalManager.run(room);

    // ── 12. БАШНИ ─────────────────────────────────────────────────────────
    room._towers.forEach(tower => roleTower.run(tower));
  },
};

module.exports = roomManager;
