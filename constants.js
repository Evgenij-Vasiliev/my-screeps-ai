// ===================================================
// CONSTANTS.JS — единый модуль констант проекта
// ===================================================
// Сюда переносим все "магические числа" по мере рефакторинга файлов.
// Ничего, что относится к конкретной роли/менеджеру, не должно
// жить россыпью в других файлах — все настраиваемые значения стягиваются сюда.
// ===================================================

// ── STORAGE ──────────────────────────────────────────────────────────────
// Резерв энергии в Storage комнаты.
const STORAGE = {
  ENERGY_MIN: 150000, // не опускаться ниже — резерв комнаты
};

// ── TERMINAL_SUPPLY ──────────────────────────────────────────────────────
// Пороги пополнения терминала энергией/ресурсами из Storage.
// Единый источник порогов — market.manager.js продаёт всё, что превышает
// эти же значения, чтобы не было двух разных источников правды.
const TERMINAL_SUPPLY = {
  ENERGY_MIN: 100000, // ниже этого — терминал нуждается в подвозе энергии
  ENERGY_TARGET: 150000, // цель пополнения энергии терминала
  MINERAL_MAX: 0, // терминал не должен копить минералы сверх этого
  BATTERY_MAX: 0, // терминал не должен копить battery сверх этого
  COMPOUND_MAX: 0, // терминал не должен копить compounds сверх этого
  STORAGE_RESERVE_MULTIPLIER: 1.3, // множитель к STORAGE.ENERGY_MIN — ниже этого уровня терминал не забирает энергию из хранилища
};

// ── TERMINAL_NETWORK ─────────────────────────────────────────────────────
// Межкомнатная балансировка через Terminal.send().
// Энергию считаем по Storage (им живёт экономика), прочие ресурсы —
// по сумме Storage + Terminal (добыть можно только то, что уже в терминале).
const TERMINAL_NETWORK = {
  MIN_SEND_AMOUNT: 1000, // меньше не шлём — комиссия не окупается
  RESOURCE_SURPLUS_ABOVE: 10000, // суммарный запас ресурса выше этого — донор
  RESOURCE_DEFICIT_BELOW: 2000, // суммарный запас ниже этого — получатель
  RESOURCE_TARGET: 5000, // до какого суммарного уровня докидываем получателю
  LAB_REQUEST_BELOW: 3000, // ниже этого локального запаса реагента комната запрашивает сеть
  LAB_KEEP: 3000, // донор, у которого та же реакция, столько оставляет себе
  LAB_SHIP_AMOUNT: 3000, // объём одной поставки реагента
  STATUS_INTERVAL: 50, // раз в сколько тиков писать статус, если send не было
};

// ── FACTORY ──────────────────────────────────────────────────────────────
// Порог, ниже которого фабрика не имеет права забирать энергию из Storage.
const FACTORY = {
  ENERGY_RESERVE_MULTIPLIER: 1.1, // множитель к STORAGE.ENERGY_MIN
};

// ── TOWER ────────────────────────────────────────────────────────────────
// Пороги и интервалы поведения башен (ремонт стен, атака, подпитка).
const TOWER = {
  REPAIR_ENERGY_MIN: 700, // минимум энергии в башне, чтобы начать ремонт
  REPAIR_INTERVAL: 15, // раз в сколько тиков проверяем повреждённые структуры
  // Период скана стен/валов. Сознательно совпадает с REPAIR_INTERVAL: в этот
  // же тик башни ремонтируют, поэтому цели ремонта (самая слабая стена, самое
  // повреждённое здание) считаются ровно тогда, когда нужны, и ни один интент
  // ремонта не теряется. Между сканами тяжёлая работа (разыменование стен по
  // id + проход по ним) не выполняется вообще.
  WALL_SCAN_INTERVAL: 15,
  WALL_THRESHOLD_DEFAULT: 1000, // стартовый порог прочности стен для ремонта
  WALL_THRESHOLD_STEP: 1000, // на сколько поднимаем порог с каждым уровнем
  HITS_DROP_THRESHOLD: 1500, // падение суммарных хитов стен за 1 тик = атака
  SUPPLY_THRESHOLD: 750, // ниже этого — башне нужна подпитка энергией
  // Интервала скана врагов здесь нет намеренно: комнаты с башнями ищут
  // FIND_HOSTILE_CREEPS каждый тик (room.manager.runTowerLogic) — иначе
  // башни запаздывают с реакцией на нападение и не лечат своих. Просадка
  // хитов стен (HITS_DROP_THRESHOLD) — только дополнительный сигнал тревоги,
  // поэтому проверяется раз в WALL_SCAN_INTERVAL тиков.
};

// ── TASK_CONFIG ──────────────────────────────────────────────────────────
// Какие категории задач вообще генерируются для воркеров этой комнаты.
// true/false — вкл/выкл конкретной категории задач.
const TASK_CONFIG = {
  fillSpawnsExtensions: true, // подвоз энергии в спавны/расширения
  fillPowerSpawnPower: false, // подвоз POWER в PowerSpawn
  fillPowerSpawnEnergy: false, // подвоз энергии в PowerSpawn
  fillTerminalEnergy: true, // подвоз энергии в терминал
  fillTerminalResources: true, // подвоз прочих ресурсов в терминал
  fillFactoryEnergy: false, // подвоз энергии в фабрику
  collectFactoryBattery: false, // забор battery из фабрики
  repairStructures: true, // ремонт повреждённых структур
  buildStructures: true, // стройка по construction site
  fillTowers: true, // подвоз энергии в башни
  upgradeController: true, // прокачка контроллера
};

// ── POWER_SPAWN ──────────────────────────────────────────────────────────
// Минимумы для запуска processPower() в PowerSpawn.
const POWER_SPAWN = {
  POWER_MIN: 10, // минимум POWER в PowerSpawn для обработки
  ENERGY_MIN: 500, // минимум энергии в PowerSpawn для обработки
};

// ── PRESPAWN_THRESHOLD ───────────────────────────────────────────────────
// За сколько тиков до смерти крипа (по ticksToLive) роль считается
// "скоро освободится" и заранее запускается пре-спавн замены.
const PRESPAWN_THRESHOLD = {
  miner: 100,
  remoteMiner: 150,
  linkWorker: 30,
};

// ── SPAWN_QUOTA ──────────────────────────────────────────────────────────
// Сколько крипов каждой роли должно поддерживаться одновременно,
// по умолчанию — во ВСЕХ комнатах. Переопределяется для конкретной
// комнаты через ROOM_SPAWN_QUOTA_OVERRIDES ниже.
const SPAWN_QUOTA = {
  harvester: 0,
  linkWorker: 1,
  miner: 2,
  towerSupplier: 0,
  repairer: 0,
  builder: 0,
  upgrader: 0,
  worker: 2,
  mineralMiner: 1,
  attacker: 1,
  reserver: 2,
  remoteMiner: 2,
  remoteHauler: 2,
  labWorker: 1,
};

// ── ROOM_SPAWN_QUOTA_OVERRIDES ───────────────────────────────────────────
// Точечные переопределения SPAWN_QUOTA для конкретных комнат.
// Если роль для комнаты не указана здесь — берётся значение из SPAWN_QUOTA.
const ROOM_SPAWN_QUOTA_OVERRIDES = {
  E35S37: { harvester: 1 },
  E35S39: { harvester: 1 },
  E36S38: { harvester: 1 },
};

// ── MINERAL_MIN_AMOUNT_TO_SPAWN ──────────────────────────────────────────
// Минимальный остаток минерала в месторождении, ниже которого
// mineralMiner не спавнится (нет смысла добывать крохи).
const MINERAL_MIN_AMOUNT_TO_SPAWN = 500;

// ── HARVESTER ────────────────────────────────────────────────────────────
// Роль-страховка (пока Task System не справляется с подвозом энергии в
// спавны/расширения). Тело двухуровневое:
//   - штатное (CREEP_BODIES.harvester, 400 энергии) — когда в спавнах и
//     расширениях энергии хватает. Батарея в 4 раза больше → в 4 раза меньше
//     рейсов storage ↔ расширения, а каждый рейс — это вызовы PathFinder.search
//     (0.04–0.11 CPU за вызов, замер 17.09.2026);
//   - аварийное (CREEP_BODIES.harvesterEmergency, 200 энергии) — когда энергии
//     в спавнах/расширениях нет, чтобы крип мог встать и поднять комнату.
const HARVESTER = {
  NORMAL_BODY_ENERGY: 400, // = стоимость штатного тела {work:1,carry:4,move:3}
};

// ── CREEP_BODIES ─────────────────────────────────────────────────────────
// Тело (набор частей) для каждой роли. Порядок частей в самом крипе
// задаёт prepareBody() в creep.factory.js: TOUGH → WORK → CARRY → MOVE.
const CREEP_BODIES = {
  miner: { work: 5, carry: 12, move: 5 },
  towerSupplier: { carry: 4, move: 2 },
  linkWorker: { carry: 4, move: 2 },
  harvester: { work: 1, carry: 4, move: 3 },
  harvesterEmergency: { work: 1, carry: 1, move: 1 },
  upgrader: { work: 3, carry: 2, move: 3 },
  builder: { work: 5, carry: 5, move: 5 },
  repairer: { work: 3, carry: 2, move: 3 },
  worker: { work: 10, carry: 10, move: 20 },
  mineralMiner: { work: 5, carry: 5, move: 5 },
  attacker: { tough: 0, move: 10, heal: 0, ranged_attack: 10 },
  reserver: { claim: 2, move: 4 },
  remoteMiner: { work: 5, carry: 1, move: 6 },
  remoteHauler: { carry: 20, move: 20 },
  labWorker: { carry: 10, move: 10 },
};

// ── CONTROLLER ───────────────────────────────────────────────────────────
// Пороги деградации контроллера (ticksToDowngrade), на которые
// ориентируется upgrader и логика тревоги по контроллеру.
const CONTROLLER = {
  DOWNGRADE_MAX: 150000,
  DOWNGRADE_MIN: 50000,
};

// ── CACHE ────────────────────────────────────────────────────────────────
// Интервал обновления кэшей сканера (scanner.js) и подобных структур.
const CACHE = {
  REFRESH_INTERVAL: 20,
};

// ── CPU ──────────────────────────────────────────────────────────────────
// Настройки мониторинга CPU (cpuMonitor.js): как часто отчитываться,
// на каком окне усреднять, при каком уровне bucket считать критичным.
const CPU = {
  REPORT_INTERVAL: 10,
  AVERAGE_WINDOW: 100,
  BUCKET_CRITICAL: 500,

  // ── Профилирование Room Manager (ТЗ №0, временный блок) ────────────────
  // PROFILE_ENABLED: false — полностью выключает измерительный слой
  // (замеры не копятся, Memory.cpuStats.profile не обновляется).
  // PROFILE_REPORT_INTERVAL: раз в сколько тиков накопленное окно замеров
  // сбрасывается в Memory.cpuStats.profile и печатается сводка в консоль.
  // Сами замеры копятся в heap каждый тик (без обращений к Memory), так что
  // сбор не создаёт заметной нагрузки; Memory пишется 1 раз в N тиков.
  PROFILE_ENABLED: true,
  PROFILE_REPORT_INTERVAL: 100,
};

// ── MARKET ───────────────────────────────────────────────────────────────
// Настройки менеджера рынка (market.manager.js).
const MARKET = {
  // Ресурсы, которые нужно ЗАКУПАТЬ на рынке.
  // Чтобы включить/выключить закупку ресурса — просто добавь/убери строку.
  BUY_RESOURCES: [], //"X", "O", "H"

  // Ресурсы, которые нужно ПРОДАВАТЬ на рынке.
  // Чтобы включить/выключить продажу ресурса — просто добавь/убери строку.
  SELL_RESOURCES: [], //RESOURCE_ENERGY

  // Максимум сделок (покупок + продаж суммарно) за один тик —
  // защита от избыточного расхода CPU за один тик.
  MAX_DEALS_PER_TICK: 3,

  // Минимальный порог цены при продаже: не продавать дешевле,
  // чем (лучшая цена на рынке) × этот коэффициент.
  MIN_SELL_PRICE_RATIO: 0.8,

  // Максимальный порог цены при покупке: не покупать дороже,
  // чем (минимальная цена на рынке) × этот коэффициент.
  MAX_BUY_PRICE_RATIO: 1.2,
};

module.exports = {
  STORAGE,
  TERMINAL_SUPPLY,
  TERMINAL_NETWORK,
  FACTORY,
  PRESPAWN_THRESHOLD,
  CREEP_BODIES,
  TOWER,
  TASK_CONFIG,
  POWER_SPAWN,
  HARVESTER,
  SPAWN_QUOTA,
  ROOM_SPAWN_QUOTA_OVERRIDES,
  MINERAL_MIN_AMOUNT_TO_SPAWN,
  CONTROLLER,
  CACHE,
  CPU,
  MARKET,
};
