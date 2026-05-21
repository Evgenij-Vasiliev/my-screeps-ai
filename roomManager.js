/**
 * ===================================================
 * ROOMMANAGER.JS — Менеджер комнат
 * ===================================================
 * Запускается каждый тик для каждой комнаты под контролем.
 * Точка входа: main.js вызывает roomManager.run(room)
 * для каждой нашей комнаты.
 *
 * Что делает:
 * 1. Собирает кэш данных комнаты (источники, башни, контейнеры...)
 * 2. Считает крипов по ролям
 * 3. Спавнит недостающих крипов
 * 4. Запускает менеджеры (терминал, линки, лабы, башни, observer)
 * 5. Сканирует врагов и управляет Memory.attackAlert
 *
 * ТЕКУЩИЙ СОСТАВ КРИПОВ:
 * - test_miner        — статичный майнер у источника
 * - test_towerSupplier — заряжает башни и разгружает линки
 * - test_terminalUnloader — логист терминала
 * - test_mineralMiner — добывает минералы
 * - test_labWorker    — обслуживает лаборатории
 * - test_nukerFiller  — заряжает Nuker (только E37S37)
 * - test_worker       — универсал: SUPPLY→REPAIR→BUILD→UPGRADE
 *
 * ЗАКОММЕНТИРОВАНЫ (заменены на test_worker):
 * - test_harvester    — заправщик spawn/extensions
 * - test_builder      — строитель
 * - test_upgrader     — апгрейдер контроллера
 * - test_repairer     — ремонтник
 * ===================================================
 */

// Спавнер крипов — создаёт тела и записывает память
const factory = require("./factory");
// Логика башен — атакует врагов, лечит союзников
const roleTower = require("./role.tower");
// Торговля на рынке и логистика между комнатами
const terminalManager = require("./terminalManager");
// Управление линками — телепорт энергии между точками
const linkManager = require("./role.linkManager");
// Управление лабораториями — варка бустов
const labManager = require("./role.labManager");
// Управление фабриками
const factoryController = require("./factoryController");

// Комнаты для удалённых операций (remoteMiner, remoteHauler, reserver)
const REMOTE_ROOMS = ["E35S38", "E36S37"];
// Комната с Observer — сканирует соседние комнаты
const OBSERVER_ROOM = "E36S38";
// Комната с Nuker — только здесь спавним nukerFiller
const NUKER_ROOM = "E37S37";

// Пороги для определения переполнения терминала энергией.
// ИСПРАВЛЕНО v2: снижен TERMINAL_ENERGY_OVERFLOW (было 50000)
// и повышен STORAGE_ENERGY_MIN (было 10000) —
// чтобы terminalUnloader активнее перекачивал энергию в storage.
const TERMINAL_ENERGY_OVERFLOW = 100000;
const STORAGE_ENERGY_MIN = 30000;

// Комнаты с повышенным риском нападения — сканируем в первую очередь.
// Включает наши комнаты И комнаты дальней добычи.
// При обнаружении врагов здесь аттакеры реагируют быстрее.
const HIGH_RISK_ROOMS = ["E36S37", "E35S38"];

// Комнаты дальней добычи — сканируем на врагов даже если не наши.
// Observer даёт видимость этих комнат каждый тик.
const REMOTE_SCAN_ROOMS = ["E36S37", "E35S38"];

/**
 * Роли которые спавнятся заранее до смерти старого крипа.
 * travelBuffer — сколько тиков нужно чтобы добраться до позиции.
 * Например remoteMiner идёт 80 тиков до соседней комнаты —
 * значит спавним нового когда у старого осталось 80+тело*3 тиков.
 */
const EARLY_SPAWN_ROLES = {
  test_miner: { travelBuffer: 10 },
  test_remoteMiner: { travelBuffer: 80 },
};

/**
 * Роли у которых фиксированный sourceIndex.
 * Каждый крип этой роли привязан к конкретному источнику.
 * Нужно следить чтобы на каждый источник был ровно 1 крип.
 */
const FIXED_SOURCE_ROLES = new Set([
  "test_hauler",
  "test_miner",
  "test_harvester",
]);

/**
 * Удалённые роли — работают в соседних комнатах.
 * При спавне им нужно назначить целевую комнату (targetRoom).
 */
const REMOTE_ROLES = new Set([
  "test_remoteMiner",
  "test_remoteHauler",
  "test_reserver",
]);

/**
 * Считает порог раннего спавна для роли.
 * Формула: длина тела × 3 тика (время спавна одной части) + буфер дороги.
 * Например тело из 11 частей спавнится 33 тика + 10 буфер = 43 тика.
 */
function getEarlySpawnThreshold(role, travelBuffer, spawn) {
  try {
    const blueprint = factory.blueprints[role]
      ? factory.blueprints[role](spawn, 0, {})
      : null;
    if (blueprint && blueprint.body) {
      return blueprint.body.length * 3 + travelBuffer;
    }
  } catch (e) {}
  return 50 + travelBuffer;
}

/**
 * Проверяет есть ли конфиг лабораторий в памяти комнаты.
 * Конфиг задаётся вручную: Memory.rooms['E35S37'].labs = {...}
 * Поддерживает до 5 троек лабораторий (labs, labs2, labs3...).
 */
function hasLabConfig(room) {
  const mem = room.memory;
  return !!(mem.labs || mem.labs2 || mem.labs3 || mem.labs4 || mem.labs5);
}

/**
 * Проверяет нужен ли nukerFiller в комнате.
 * Nuker заряжается энергией (300k) и ghodium (5k).
 * Возвращает true если хотя бы один ресурс не заполнен.
 */
function nukerNeedsFilling(room) {
  const nuker = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_NUKER,
  })[0];
  if (!nuker) return false;
  return (
    nuker.store.getFreeCapacity(RESOURCE_ENERGY) > 0 ||
    nuker.store.getFreeCapacity(RESOURCE_GHODIUM) > 0
  );
}

/**
 * Генерирует список комнат для сканирования Observer'ом.
 * Берёт имя комнаты (например E36S38), парсит координаты
 * и создаёт список всех комнат в радиусе radius клеток.
 * Observer может смотреть максимум на 10 комнат в радиусе.
 */
function generateScanList(roomName, radius) {
  const match = roomName.match(/([EW])(\d+)([NS])(\d+)/);
  if (!match) return [];
  const xDir = match[1];
  const x = parseInt(match[2]);
  const yDir = match[3];
  const y = parseInt(match[4]);
  const list = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (dx === 0 && dy === 0) continue; // пропускаем свою комнату
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0) continue; // пропускаем отрицательные координаты
      list.push(`${xDir}${nx}${yDir}${ny}`);
    }
  }
  return list;
}

/**
 * Запускает Observer — каждый тик смотрит в следующую комнату по списку.
 * Observer даёт видимость комнаты на 1 тик — достаточно для разведки.
 * Список хранится в памяти комнаты и перебирается по кругу.
 */
function runObserver(room) {
  const observer = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_OBSERVER,
  })[0];
  if (!observer) return;

  // Генерируем список если его нет или он пуст
  if (
    !room.memory.observerScanList ||
    room.memory.observerScanList.length === 0
  ) {
    room.memory.observerScanList = generateScanList(room.name, 10);
    room.memory.observerIdx = 0;
    console.log(
      `[Observer ${room.name}] Список сгенерирован: ${room.memory.observerScanList.length} комнат`,
    );
  }

  const list = room.memory.observerScanList;
  const idx = room.memory.observerIdx || 0;
  observer.observeRoom(list[idx % list.length]); // смотрим в текущую комнату
  room.memory.observerIdx = (idx + 1) % list.length; // переходим к следующей
}

/**
 * Сканирует все наши комнаты И комнаты дальней добычи на наличие врагов.
 * Запускается ОДИН РАЗ за тик из первой комнаты в алфавитном списке.
 *
 * Логика:
 * - Сначала проверяем HIGH_RISK_ROOMS (E36S37, E35S38) — зоны риска
 * - Затем все наши комнаты
 * - Если враги найдены — записываем Memory.attackAlert
 * - Если нигде врагов нет — удаляем Memory.attackAlert
 *
 * Аттакеры читают Memory.attackAlert в role.attacker.js и реагируют.
 * Memory.attackAlert = { room: "E35S38", time: Game.time }
 *
 * Фильтр: считаем боевых крипов (ATTACK, RANGED_ATTACK, HEAL)
 * И Invader Core — структуру которая захватывает контроллер.
 * Мирные крипы (например чужие hauler) тревогу не поднимают.
 *
 * ВАЖНО: комнаты дальней добычи (E36S37, E35S38) видны только если
 * Observer смотрел в них в этом или прошлом тике.
 */
function runAttackScanner() {
  // Собираем все наши комнаты
  const ourRooms = Object.values(Game.rooms).filter(
    r => r.controller && r.controller.my,
  );

  // Добавляем комнаты дальней добычи если они видимы
  // (Observer даёт видимость на 1 тик — Game.rooms содержит их если видны)
  const remoteRooms = REMOTE_SCAN_ROOMS.map(name => Game.rooms[name]).filter(
    Boolean,
  ); // filter(Boolean) убирает невидимые комнаты

  // Объединяем все комнаты для сканирования без дублей
  const allRooms = [...ourRooms];
  for (const r of remoteRooms) {
    if (!allRooms.find(x => x.name === r.name)) allRooms.push(r);
  }

  // Сортируем: сначала комнаты высокого риска, потом остальные
  const sorted = allRooms.sort((a, b) => {
    const aRisk = HIGH_RISK_ROOMS.includes(a.name) ? 0 : 1;
    const bRisk = HIGH_RISK_ROOMS.includes(b.name) ? 0 : 1;
    return aRisk - bRisk;
  });

  // Ищем комнату с боевыми врагами или Invader Core
  for (const room of sorted) {
    // ── БОЕВЫЕ КРИПЫ ──────────────────────────────────────────────────────
    // Игнорируем мирных крипов — считаем только боевых
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
      filter: c =>
        c.body.some(
          b => b.type === ATTACK || b.type === RANGED_ATTACK || b.type === HEAL,
        ),
    });

    if (hostiles.length > 0) {
      // Враги найдены — устанавливаем тревогу
      // Логируем только если тревога новая или сменилась комната
      const prev = Memory.attackAlert;
      if (!prev || prev.room !== room.name) {
        console.log(
          `[AttackAlert] 🚨 Враги в ${room.name}! Поднимаем тревогу. Крипов: ${hostiles.length}`,
        );
      }
      Memory.attackAlert = { room: room.name, time: Game.time };
      return; // нашли — дальше не ищем
    }

    // ── INVADER CORE ──────────────────────────────────────────────────────
    // Invader Core — вражеская структура которая захватывает контроллер.
    // Это НЕ крип — обычный фильтр FIND_HOSTILE_CREEPS его не видит.
    // Обнаружив Core — поднимаем тревогу и посылаем аттакеров.
    const invaderCore = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_INVADER_CORE,
    });

    if (invaderCore.length > 0) {
      const prev = Memory.attackAlert;
      if (!prev || prev.room !== room.name) {
        console.log(
          `[AttackAlert] 🚨 Invader Core в ${room.name}! Поднимаем тревогу.`,
        );
      }
      Memory.attackAlert = { room: room.name, time: Game.time };
      return; // нашли — дальше не ищем
    }
  }

  // Нигде врагов нет — снимаем тревогу
  if (Memory.attackAlert) {
    console.log(
      `[AttackAlert] ✅ Комната ${Memory.attackAlert.room} очищена. Аттакеры возвращаются на точку сбора.`,
    );
    delete Memory.attackAlert;
  }
}

const roomManager = {
  run: function (room) {
    // ── 1. ENERGY TARGETS — каждый тик ────────────────────────────────────
    // Список незаполненных spawn и extensions.
    // Обновляется каждый тик потому что меняется очень быстро —
    // harvester/worker заполняет их за несколько тиков.
    // Записываем и в память (для сохранения между тиками)
    // и в _energyTargets (быстрый доступ без getObjectById).
    {
      const energyTargets = room.find(FIND_MY_STRUCTURES, {
        filter: s =>
          (s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_SPAWN) &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });
      room.memory.energyTargets = energyTargets.map(s => s.id);
      room._energyTargets = energyTargets; // прямые объекты — бесплатно
    }

    // ── 2. БАШНИ — раз в 50 тиков ─────────────────────────────────────────
    // Башни не строятся и не ломаются часто — обновляем редко.
    // _towers используется в role.tower и role.towerSupplier.
    if (!room.memory.towers || Game.time % 50 === 0) {
      const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
      });
      room.memory.towers = towers.map(t => t.id);
    }
    room._towers = room.memory.towers
      .map(id => Game.getObjectById(id))
      .filter(Boolean); // filter(Boolean) убирает null если башня сломана

    // ── 3. ИСТОЧНИКИ — один раз навсегда ──────────────────────────────────
    // Источники энергии не меняются — запоминаем ID один раз.
    // _sources используется в role.miner, role.harvester и других.
    if (!room.memory.sources) {
      const sources = room.find(FIND_SOURCES);
      room.memory.sources = sources.map(s => s.id);
    }
    room._sources = room.memory.sources
      .map(id => Game.getObjectById(id))
      .filter(Boolean);

    // ── 4. КОНТЕЙНЕРЫ У ИСТОЧНИКОВ ────────────────────────────────────────
    // Контейнер у каждого источника — место куда майнер скидывает энергию.
    // Ищем один раз и кэшируем. Если контейнер сломан — ищем заново.
    // _sourceContainers[0] — контейнер у первого источника и т.д.

    // if (!room.memory.sourceContainers) {
    //   room.memory.sourceContainers = [];
    // }
    // room._sourceContainers = [];
    // room._sources.forEach((source, index) => {
    //   let container = null;
    //   const containerId = room.memory.sourceContainers[index];
    //   if (containerId) container = Game.getObjectById(containerId);
    //   if (!container) {
    //     // Ищем контейнер в радиусе 2 клеток от источника
    //     container =
    //       source.pos.findInRange(FIND_STRUCTURES, 2, {
    //         filter: s => s.structureType === STRUCTURE_CONTAINER,
    //       })[0] || null;
    //     room.memory.sourceContainers[index] = container ? container.id : null;
    //   }
    //   room._sourceContainers[index] = container;
    // });

    // ── 5. МИНЕРАЛ — раз в 100 тиков ──────────────────────────────────────
    // В каждой комнате один минерал (O, H, K, U, L, Z, X, G).
    // mineralAvailable — есть ли ещё запасы (mineralAmount > 0).
    // Когда минерал истощается — mineralMiner не нужен.
    if (!room.memory.mineralId || Game.time % 100 === 0) {
      const minerals = room.find(FIND_MINERALS);
      room.memory.mineralId = minerals.length > 0 ? minerals[0].id : null;
    }
    const mineral = room.memory.mineralId
      ? Game.getObjectById(room.memory.mineralId)
      : null;
    const mineralAvailable = mineral && mineral.mineralAmount > 0;

    // ── 6. СТРОЙКИ — раз в 100 тиков ──────────────────────────────────────
    // hasSites — есть ли стройплощадки в комнате.
    // Определяет нужен ли builder/worker для стройки.
    // Обновляем раз в 100 тиков — стройки не появляются мгновенно.
    if (room.memory.hasSites === undefined || Game.time % 100 === 0) {
      room.memory.hasSites = room.find(FIND_CONSTRUCTION_SITES).length > 0;
    }
    const hasSites = room.memory.hasSites;

    // ── 7. РЕМОНТ — раз в 100 тиков ───────────────────────────────────────
    // needsRepair — есть ли структуры с HP < 80%.
    // Стены и рампарты исключаем — у них hitsMax в миллионы,
    // ремонтник застрянет на них навсегда.
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

    // ── 8. СКАНЕР АТАК — один раз за тик из первой комнаты ────────────────
    // Определяем первую комнату в алфавитном порядке и запускаем
    // сканер только из неё — чтобы не дублировать работу каждый тик.
    // Результат пишется в Memory.attackAlert — читается role.attacker.
    const ourRoomNames = Object.keys(Game.rooms)
      .filter(n => {
        const r = Game.rooms[n];
        return r.controller && r.controller.my;
      })
      .sort();

    if (ourRoomNames[0] === room.name) {
      runAttackScanner();
    }

    // ── 9. ПОДСЧЁТ КРИПОВ ─────────────────────────────────────────────────
    // Считаем крипов по ролям один раз за тик.
    // localGroups — крипы в этой комнате.
    // globalGroups — крипы во всех комнатах (для глобальных ролей).
    // roomCreeps — все крипы в этой комнате (для запуска ролей).

    const spawnsForThreshold = room.find(FIND_MY_SPAWNS);
    const spawnForThreshold = spawnsForThreshold[0] || null;

    // Пересчитываем пороги раннего спавна раз в 200 тиков
    if (!room.memory.earlySpawnThresholds || Game.time % 200 === 0) {
      room.memory.earlySpawnThresholds = {};
      for (const role in EARLY_SPAWN_ROLES) {
        const { travelBuffer } = EARLY_SPAWN_ROLES[role];
        room.memory.earlySpawnThresholds[role] = spawnForThreshold
          ? getEarlySpawnThreshold(role, travelBuffer, spawnForThreshold)
          : 50 + travelBuffer;
      }
    }
    const thresholds = room.memory.earlySpawnThresholds;

    const localGroups = {}; // { 'test_miner': 2, 'test_worker': 1, ... }
    const globalGroups = {}; // то же но для всех комнат
    const roomCreeps = []; // все крипы в этой комнате
    let attackersHere = 0; // наши атакеры приписанные к этой комнате

    // fixedSourceCount считает сколько крипов с фиксированным sourceIndex
    // уже на каждом источнике — чтобы не посылать двух майнеров к одному
    const fixedSourceCount = {};
    for (const role of FIXED_SOURCE_ROLES) {
      fixedSourceCount[role] = {};
      for (let i = 0; i < (room.memory.sources || []).length; i++) {
        fixedSourceCount[role][i] = 0;
      }
    }

    // Один проход по всем крипам в игре
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      const role = creep.memory.role;

      // Крип "умирающий" — не считаем его живым для спавна нового
      // но всё равно добавляем в roomCreeps для запуска логики
      let countAsAlive = true;
      if (thresholds[role] !== undefined && creep.ticksToLive !== undefined) {
        if (creep.ticksToLive < thresholds[role]) countAsAlive = false;
      }

      if (countAsAlive) {
        globalGroups[role] = (globalGroups[role] || 0) + 1;
        if (creep.room.name === room.name) {
          localGroups[role] = (localGroups[role] || 0) + 1;
          roomCreeps.push(creep);
          // Считаем занятые источники для FIXED_SOURCE_ROLES
          if (
            FIXED_SOURCE_ROLES.has(role) &&
            creep.memory.sourceIndex !== undefined &&
            fixedSourceCount[role] !== undefined &&
            fixedSourceCount[role][creep.memory.sourceIndex] !== undefined
          ) {
            fixedSourceCount[role][creep.memory.sourceIndex]++;
          }
        }
      } else {
        if (creep.room.name === room.name) roomCreeps.push(creep);
      }

      if (role === "test_attacker" && creep.memory.homeRoom === room.name) {
        attackersHere++;
      }
    }

    // ── 10. КОНФИГУРАЦИЯ РОЛЕЙ ──────────────────────────────────────────────
    // Здесь определяем СКОЛЬКО крипов каждой роли нужно в комнате.
    // count: 0 означает что крипы этой роли не нужны сейчас.

    // Апгрейдер нужен только когда контроллер близок к даунгрэйду
    const needsUpgrader =
      room.controller && room.controller.ticksToDowngrade < 100000 ? 1 : 0;

    // Всегда держим 1 атакера в комнате для защиты
    const attackerCount = 1;

    // Суммарное количество не-энергетических ресурсов в терминале
    // Если > 5000 — нужен unloader чтобы разгрузить терминал в storage
    const terminalNonEnergy = room.terminal
      ? Object.entries(room.terminal.store)
          .filter(([r]) => r !== RESOURCE_ENERGY)
          .reduce((sum, [, amt]) => sum + amt, 0)
      : 0;

    // Есть ли очередь запросов на перенос ресурсов
    // (создаётся terminalManager для балансировки между комнатами)
    const hasTerminalNeeds = (room.memory.terminalNeeds || []).length > 0;

    // Терминал переполнен энергией а storage пуст — нужен unloader
    // ИСПРАВЛЕНО: используем обновлённые пороги (20000 и 30000)
    const terminalEnergyOverflow =
      room.terminal &&
      room.storage &&
      (room.terminal.store[RESOURCE_ENERGY] || 0) > TERMINAL_ENERGY_OVERFLOW &&
      (room.storage.store[RESOURCE_ENERGY] || 0) < STORAGE_ENERGY_MIN;

    // Локальные роли — крипы работают в этой комнате
    const localRolesConfig = [
      // 1 универсальный worker на комнату
      // Выполняет задачи: UNLOAD_LINK → TOWER → TERMINAL → SUPPLY → REPAIR → BUILD → UPGRADE
      { role: "test_worker", count: 2 },
      // test_harvester закомментирован — заменён на test_worker (задача SUPPLY)
      // { role: "test_harvester", count: 1 },

      // 2 майнера — по одному на каждый источник энергии
      { role: "test_miner", count: 2 },

      // test_hauler закомментирован — с линками не нужен
      // (майнер скидывает в линк → энергия телепортируется в storage)
      // { role: "test_hauler", count: 0 },

      // 1 towerSupplier — заряжает башни и разгружает линк у storage
      // { role: "test_towerSupplier", count: 1 },

      {
        role: "test_terminalUnloader",
        // Спавним если:
        // - в терминале накопились не-энергетические ресурсы (> 5000)
        // - есть очередь запросов (балансировка или продажа минералов)
        // - терминал переполнен энергией при пустом storage
        count:
          terminalNonEnergy > 5000 || hasTerminalNeeds || terminalEnergyOverflow
            ? 1
            : 0,
      },

      // test_builder закомментирован — заменён на test_worker (задача BUILD)
      { role: "test_builder", count: hasSites ? 2 : 0 },

      // test_upgrader закомментирован — заменён на test_worker (задача UPGRADE)
      // { role: "test_upgrader", count: needsUpgrader },

      // test_repairer закомментирован — заменён на test_worker (задача REPAIR)
      // { role: "test_repairer", count: needsRepair ? 1 : 0 },

      {
        role: "test_mineralMiner",
        // Добываем минерал только если:
        // - минерал ещё есть в земле
        // - в storage достаточно энергии (> 20000) чтобы не голодать
        count:
          mineralAvailable &&
          room.storage &&
          room.storage.store[RESOURCE_ENERGY] > 20000
            ? 2
            : 0,
      },

      {
        role: "test_labWorker",
        // Нужен только если в памяти комнаты прописан конфиг лабораторий
        count: hasLabConfig(room) ? 1 : 0,
      },

      {
        role: "test_nukerFiller",
        // Только в комнате с Nuker и только пока он не заряжен
        count: room.name === NUKER_ROOM && nukerNeedsFilling(room) ? 1 : 0,
      },
      { role: "test_deliveryWorker", count: 1 },

      // 1 универсальный worker на комнату
      // Выполняет задачи: UNLOAD_LINK → TOWER → TERMINAL → SUPPLY → REPAIR → BUILD → UPGRADE
    ];

    // Глобальные роли — крипы работают в соседних комнатах
    // Счётчик берём из globalGroups (все комнаты, не только эта)
    const globalRolesConfig = [];
    if (room.name === "E35S37") {
      // 2 резервера — держат контроллеры соседних комнат под резервом
      globalRolesConfig.push({ role: "test_reserver", count: 2 });
      // 2 удалённых майнера — добывают энергию в соседних комнатах
      globalRolesConfig.push({ role: "test_remoteMiner", count: 2 });
      // 2 удалённых хаулера — возят энергию из соседних комнат
      globalRolesConfig.push({ role: "test_remoteHauler", count: 2 });
    }

    // ── 11. СПАВН ─────────────────────────────────────────────────────────
    // Берём первый свободный спавн (не занятый спавном крипа)
    const spawns = room.find(FIND_MY_SPAWNS, { filter: s => !s.spawning });
    const spawn = spawns[0];

    if (spawn) {
      // Приоритет 0: спавним атакера если нужен
      if (attackerCount > 0 && attackersHere < attackerCount) {
        const result = factory.run(spawn, { role: "test_attacker" }, 0);
        if (result === OK) {
          room._towers.forEach(tower => roleTower.run(tower));
          return;
        }
      }

      const fullConfig = [...localRolesConfig, ...globalRolesConfig];

      // Перебираем роли по приоритету (порядок в массиве = приоритет)
      for (const roleData of fullConfig) {
        const isGlobal = globalRolesConfig.some(r => r.role === roleData.role);
        // Для глобальных ролей считаем всех крипов этой роли во всех комнатах
        const currentCount = isGlobal
          ? globalGroups[roleData.role] || 0
          : localGroups[roleData.role] || 0;

        if (currentCount < roleData.count) {
          let bestIndex;

          if (FIXED_SOURCE_ROLES.has(roleData.role)) {
            // Для фиксированных ролей — выбираем источник с наименьшим числом крипов
            const counts = fixedSourceCount[roleData.role] || {};
            bestIndex = Number(
              Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0],
            );
          } else {
            // Для остальных — выбираем наименее загруженный источник
            const sourceUsage = {};
            room._sources.forEach((_, i) => {
              sourceUsage[i] = 0;
            });
            roomCreeps.forEach(c => {
              if (
                c.memory.sourceIndex !== undefined &&
                sourceUsage[c.memory.sourceIndex] !== undefined
              ) {
                sourceUsage[c.memory.sourceIndex]++;
              }
            });
            bestIndex = Number(
              Object.entries(sourceUsage).sort((a, b) => a[1] - b[1])[0][0],
            );
          }

          // Для удалённых ролей — назначаем целевую комнату
          // Берём комнату которая ещё не занята другим крипом этой роли
          if (REMOTE_ROLES.has(roleData.role)) {
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
          if (result === OK) break; // спавним только одного крипа за тик
        }
      }
    }

    // ── Продажа ресурсов и балансировка между комнатами ───────────────────
    terminalManager.run(room);

    // -- Запуск фабрик-----------------------------------------------------
    factoryController.run(room);

    // ── Передача энергии через линки ──────────────────────────────────────
    linkManager.run(room);

    // ── Варка бустов в лабораториях ───────────────────────────────────────
    labManager.run(room);

    // ── Observer — сканируем соседние комнаты (только E36S38) ────────────
    if (room.name === OBSERVER_ROOM) {
      runObserver(room);
    }

    // ── Башни — атакуем врагов, лечим союзников ───────────────────────────
    room._towers.forEach(tower => roleTower.run(tower));
  },
};

module.exports = roomManager;
