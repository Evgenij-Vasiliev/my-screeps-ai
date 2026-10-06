// ===================================================
// ROOM/RUN.JS — запуск подсистем комнаты за тик
// ===================================================
// Часть разбиения room.manager.js (960 строк, 04.10.2026).
// Публичный API не изменился: наружу его отдаёт фасад room.manager.js
// (empire.js и консольные замеры зовут require("room.manager")).
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "room/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const taskGenerators = require("task.generators");
const spawnManager = require("spawn.manager");
const factoryManager = require("factory.manager");
const powerSpawnManager = require("powerSpawn.manager");
const labManager = require("lab.manager");
const cpuMonitor = require("cpuMonitor");
const econ = require("econ");
const { TOWER } = require("../constants");
const loadShed = require("loadShed");
const systems = require("systems");

const { runCreepLogic } = require("./creeps");
const { runTowerLogic } = require("./towers");
const { runLinkLogic } = require("./links");

module.exports = {
  /**
   * Запускает все комнатные подсистемы для одной комнаты:
   * спавн, задачи воркеров, крипы, башни, линки, фабрика.
   * @param {Object} roomState
   */
  runRoom: function (roomState) {
    // ── ХРАПОВИК ЗАПАСОВ (econ) — ПЕРВЫМ ДЕЛОМ ──────────────────────────
    // Обновляет достигнутые максимумы склада и терминала ДО того, как
    // подсистемы начнут тратить: пол склада этого тика считается по
    // максимуму, включающему текущее значение. Если позвать позже, первый
    // тик после нового пика прошёл бы со старым (меньшим) полом.
    // Цена — два чтения store и сравнение (econ.js:observe); запись в Memory
    // только при превышении WRITE_QUANTUM.
    // Тумблера в systems.js у политики нет намеренно: у неё свои точки отката
    // (Memory.econOff без перевыгрузки и ECON.ENABLED), а число гейтов
    // systems.js механически зафиксировано в tests/systems.test.js:146.
    econ.observe(roomState);

    // Уровень нагрузки читается ОДИН раз на комнату, а не в каждом условии:
    // уровни только повышаются, поэтому кэш внутри тика безопасен (сам
    // loadShed уровень не кэширует — переключение из консоли действует
    // со следующего обращения).
    const shed = loadShed.effectiveLevel();
    const shedLite = shed >= 1;
    const shedHard = shed >= 2;

    // Тумблеры систем — в systems.js. Выключатель и loadShed складываются
    // по ИЛИ: выключенную систему loadShed не включает.

    // ── ЛАБОРАТОРИИ ИДУТ ПЕРВЫМИ В ТИКЕ ──────────────────────────────────
    // labManager делает три вещи, от которых зависят ОСТАЛЬНЫЕ подсистемы
    // этого же тика: чинит привязку троек по LAB_BINDING (ensureTriples),
    // восстанавливает Memory.rooms[room].boostLab (ensureBoostLab) и дописывает
    // план реакций в конфиги троек (sync). Порядок важен: reagentList
    // терминальной сети строится из этих конфигов, поэтому сеть, рынок и
    // буст-менеджер обязаны увидеть их уже заполненными.
    // Гейта loadShed здесь нет намеренно: это производство, а не фоновая
    // уборка; в установившемся тике стоимость — проверки по tick-кэшу.
    // Выключатель `labManager: { scope: "room", on: false }` (systems.js)
    // гасит блок целиком: тройки не перепривязываются, boostLab не
    // восстанавливается, план реакций не дописывается — конфиги в Memory
    // остаются в последнем состоянии, и terminalNetwork продолжает работать
    // по ним (порядок шагов не меняется).
    if (systems.labManager !== false) {
      cpuMonitor.trackRole("labManager", () => labManager.run(roomState.room));
    }

    if (systems.spawnManager !== false) {
      cpuMonitor.trackRole("spawnManager", () => spawnManager.run(roomState));
    }
    cpuMonitor.trackRole("taskManager", () => {
      // ── Замер цены КАЖДОГО генератора задач ──────────────────────────
      // Включается флагом Memory.cpuGenProfile = true (снять —
      // `delete Memory.cpuGenProfile`). Пока флаг не задан, генераторы
      // вызываются напрямую, одним вызовом функции — накладных расходов нет.
      //
      // Почему по флагу, а не всегда: 6 генераторов × 5 комнат = 30 вызовов за
      // тик, а trackRole стоит 0.0007-0.0017 CPU за вызов
      // (docs/PROFILING-ON-DEMAND.md:83), то есть включённый замер добавляет
      // 0.02-0.05 CPU/тик. Тот же приём, что у поролевого профиля крипов:
      // подробный замер — по требованию, а не постоянно.
      //
      // Имена с префиксом "gen." не сталкиваются ни с именами ролей
      // (worker, miner, linkWorker), ни с именами подсистем: и то и другое
      // пишется в один объект Memory.cpuStats.subsystems (cpuMonitor.js:70-73).
      const genProfile = Memory.cpuGenProfile === true;
      const gen = genProfile
        ? (name, fn) => cpuMonitor.trackRole("gen." + name, () => fn(roomState))
        : (name, fn) => fn(roomState);

      // ── ЕДИНЫЙ ТУМБЛЕР ГЕНЕРАТОРОВ — systems.js (правка 05.10.2026) ──
      // Раньше каждый гейт требовал ЕЩЁ И флаг TASK_CONFIG из
      // constants/tasks.js, причём значения расходились: в systems.js
      // fillPowerSpawnPower/Energy, fillFactoryEnergy, collectFactoryBattery и
      // fillTerminalResources стояли true, а в TASK_CONFIG — false. Решало
      // более строгое (TASK_CONFIG), поэтому пять систем были выключены, хотя
      // тумблер показывал «включено»: фабрики стояли с 32-452 энергии при
      // требуемых 600 (COMMODITIES: battery = 600 energy -> 50), powerSpawn —
      // с power 11-88 и энергией 6-38 при требуемых 50
      // (engine power-spawns/process-power.js, POWER_SPAWN_ENERGY_RATIO = 50).
      // Живой замер tick 83451761. Теперь источник один: systems.js.
      //
      // Выключенный генератор не вызывается ВООБЩЕ: вызов, замыкание и чтение
      // roomState не оплачиваются. Набор задач и их порядок в очереди при этом
      // НЕ меняются: выключенный генератор и раньше ничего не создавал.
      //
      // Тумблер генератора: upgradeController: false перестаёт ставить НОВЫЕ
      // задачи этого типа, стоящие в очереди доигрываются.
      //
      // ── loadShed ─────────────────────────────────────────────────────
      // Понижение нагрузки НЕ удаляет уже стоящие задачи и не меняет их
      // порядок: оно лишь перестаёт СТАВИТЬ новые фоновые задачи. Поэтому
      // при lite/hard воркеры дорабатывают то, что уже в очереди (и FIFO
      // сохраняется), а срочное (спавны, башни, терминал на hard) ставится
      // всегда. При max срочное тоже продолжает ставиться — бот должен
      // выжить, а не остановиться.
      if (systems.fillSpawnsExtensions !== false) {
        gen("fillSpawnsExtensions", taskGenerators.generateFillSpawnsExtensions);
      }
      if (
        !shedHard &&
        systems.fillPowerSpawnPower !== false
      ) {
        gen("fillPowerSpawnPower", taskGenerators.generateFillPowerSpawnPower);
      }
      if (
        !shedHard &&
        systems.fillPowerSpawnEnergy !== false
      ) {
        gen("fillPowerSpawnEnergy", taskGenerators.generateFillPowerSpawnEnergy);
      }
      if (
        !shedHard &&
        systems.fillFactoryEnergy !== false
      ) {
        gen("fillFactoryEnergy", taskGenerators.generateFillFactoryEnergy);
      }
      if (
        !shedHard &&
        systems.collectFactoryBattery !== false
      ) {
        gen(
          "collectFactoryBattery",
          taskGenerators.generateCollectFactoryBattery,
        );
      }
      if (
        !shedHard &&
        systems.fillTerminalEnergy !== false
      ) {
        gen("fillTerminalEnergy", taskGenerators.generateFillTerminalEnergy);
      }
      if (
        !shedHard &&
        systems.fillTerminalResources !== false
      ) {
        gen(
          "fillTerminalResources",
          taskGenerators.generateFillTerminalResources,
        );
      }
      if (systems.fillTowers !== false) {
        gen("fillTowers", taskGenerators.generateFillTowers);
      }
      // Фоновое: апгрейд, стройка, ремонт — только в обычном режиме.
      if (
        !shedLite &&
        systems.repairStructures !== false
      ) {
        gen("repairStructures", taskGenerators.generateRepairStructures);
      }
      if (
        !shedLite &&
        systems.buildStructures !== false
      ) {
        gen("buildStructures", taskGenerators.generateBuildStructures);
      }
      if (
        !shedLite &&
        systems.upgradeController !== false
      ) {
        gen("upgradeController", taskGenerators.generateUpgradeController);
      }
    });
    // Рубильники систем комнаты. Выключенная система не вызывается вовсе —
    // это не «пустой вызов», а отсутствие вызова и его замыкания.
    if (systems.creeps !== false) runCreepLogic(roomState);
    if (systems.towers !== false) runTowerLogic(roomState);
    if (systems.linkManager !== false) runLinkLogic(roomState);
    // Шаг 8: проверка читается В ТОЧКЕ ВЫЗОВА, а не из `shed` выше (он прочитан
    // в начале комнаты, room/run.js:50). Фабрика и powerSpawn идут ПОСЛЕ
    // ролевой логики и башен, поэтому пик внутри этой же комнаты иначе в гейт не
    // попадёт. Цена — один Game.cpu.getUsed() на комнату за тик
    // (0.000256–0.000310 CPU за вызов, docs/PROFILING-ON-DEMAND.md:82).
    if (!shedHard && !loadShed.overBudget()) {
      if (systems.factoryManager !== false) {
        cpuMonitor.trackRole("factoryManager", () =>
          factoryManager.run(roomState),
        );
      }
      if (systems.powerSpawnManager !== false) {
        cpuMonitor.trackRole("powerSpawnManager", () =>
          powerSpawnManager.run(roomState),
        );
      }
    }
  },

  /**
   * Главный метод уровня комнат: строит состояния и запускает
   * логику для каждой собственной комнаты.
   *
   * ── Тумблер комнаты (systems.js) ────────────────────────────────────
   * Комната с тумблером false (`E35S37: false`) теряет ВСЮ логику: спавн,
   * задачи, роли, башни, линки, лабы, фабрику. Её крипы перестают получать
   * команды, задачи в очереди замирают. Уборка памяти мёртвых крипов в
   * empire.js работает независимо и продолжает убирать.
   *
   * Сборка roomState для выключенной комнаты пока оплачивается (scanner +
   * резолвы): фильтр стоит здесь, а не в buildAllRoomStates, чтобы контракт
   * «состояние всех комнат» не зависел от тумблера.
   *
   * @returns {Object[]} массив roomState
   */
  run: function () {
    const roomStates = this.buildAllRoomStates();

    for (const roomState of roomStates) {
      if (systems[roomState.roomName] === false) continue;
      this.runRoom(roomState);
    }

    return roomStates;
  },
};
