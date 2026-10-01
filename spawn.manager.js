/**
 * SPAWN MANAGER (ТЗ №3)
 * Отвечает на вопрос: "Кого создать?"
 * Хранит очередь/приоритеты ролей, считает текущее количество крипов,
 * вызывает creep.factory для реального спавна.
 *
 * ШЛЮЗ ПРОВЕРОК (правка 30.09.2026). Замер in-loop (профиль ниже, shard3
 * 30.09.2026) показал, что комната платила 0.069 CPU/тик на проверку, которая
 * ничего не находила: 0.0378 — счёт ролей, 0.0223 — поиск свободного спавна,
 * 0.0082 — обход квот. Теперь:
 *   - комната без недобора перепроверяется раз в SPAWN.SCAN_INTERVAL тиков
 *     (constants.js), со сдвигом фазы по имени комнаты;
 *   - комнате, у которой недобор есть (или спавн занят, или не хватило
 *     энергии), проверка идёт каждый тик, как и раньше;
 *   - свободный спавн ищется ЛЕНИВО — только когда роль действительно
 *     недобрана и прошла проверки upgrader/mineralMiner.
 * Цена шлюза: решение о спавне может опоздать до SCAN_INTERVAL тиков после
 * неожиданной смерти крипа. Откат поведения — SPAWN.SCAN_INTERVAL: 1.
 *
 * ПРОФИЛЬ ПО ТРЕБОВАНИЮ (флаг Memory.cpuSpawnProfile = true, снять —
 * `delete Memory.cpuSpawnProfile`): run() делится на части и пишет их
 * стоимость в Memory.cpuStats.subsystems под ключами "spawn.countRoles",
 * "spawn.find", "spawn.quotaLoop" — тем же механизмом, что поролевой профиль
 * крипов и "gen.*" у генераторов задач (room.manager.js:757-774). На тиках,
 * где шлюз комнату пропустил, части не пишутся вовсе, поэтому средние
 * остаются «CPU за тик».
 *
 * Зачем флаг, а не постоянный замер: замер стоит Game.cpu.getUsed() на часть
 * на комнату, а измеренный профиль сам стоил 0.0205 CPU/тик (23 % от того,
 * что показывал). Пока флаг не задан, цена профиля — одно чтение Memory на
 * проверяемую комнату.
 *
 * ВНИМАНИЕ: "spawn.quotaLoop" включает и вызов creep.factory, если он был
 * (в тик спавна там окажется интент 0.2 CPU) — по величине это видно сразу.
 */
const creepFactory = require("creep.factory");
const cpuMonitor = require("cpuMonitor");
const {
  SPAWN_QUOTA,
  SPAWN,
  MINERAL_MIN_AMOUNT_TO_SPAWN,
  PRESPAWN_THRESHOLD,
} = require("./constants");

/**
 * Счётчики крипов по ролям — ОДИН проход по списку (задание 8 плана).
 *
 * Раньше countRole(creeps, role) вызывался на каждую роль из SPAWN_QUOTA,
 * то есть список крипов проходился девять раз с созданием массива и
 * замыкания на каждый проход. При этом у пяти ролей квота равна нулю —
 * их счёт не нужен вовсе.
 *
 * Правила счёта сохранены прежние:
 * - роль не из SPAWN_QUOTA или с нулевой квотой не считается;
 * - крип, чей ticksToLive ниже PRESPAWN_THRESHOLD[role], не считается:
 *   он «уже уходящий», вместо него нужен новый (иначе спавн опоздает).
 *
 * @param {Array} creeps
 * @returns {Object} role -> количество
 */
function countRoles(creeps) {
  const counts = {};

  for (let i = 0; i < creeps.length; i++) {
    const creep = creeps[i];
    if (!creep) continue;

    const role = creep.memory.role;

    // !quota отсекает и 0, и роли вне таблицы квот.
    if (!SPAWN_QUOTA[role]) continue;

    const threshold = PRESPAWN_THRESHOLD[role];
    if (
      threshold !== undefined &&
      creep.ticksToLive !== undefined &&
      creep.ticksToLive < threshold
    ) {
      continue;
    }

    counts[role] = (counts[role] || 0) + 1;
  }

  return counts;
}

/**
 * Первый свободный спавн комнаты.
 *
 * Раньше здесь был `spawns.find(s => !s.spawning)` — замыкание на каждую
 * комнату каждый тик ради обхода массива из 1-3 спавнов. Цикл даёт тот же
 * результат без аллокации: микробенчмарк scripts/spawn.ab.bench.js (Node,
 * 30.09.2026) показал 366.9 нс/вызов против 368.1 у `find`, то есть разница
 * в пределах шума — правка берётся не за скорость, а за отсутствие мусора.
 * Проверка `spawn &&` — защита от null: сейчас таких элементов не бывает
 * (resolveByIds их отсекает, room.manager.js:178-186), но `find` на
 * null-элементе упал бы, а цикл просто идёт дальше.
 *
 * @param {Array} spawns
 * @returns {StructureSpawn|null}
 */
function findFreeSpawn(spawns) {
  for (let i = 0; i < spawns.length; i++) {
    const spawn = spawns[i];
    if (spawn && !spawn.spawning) return spawn;
  }
  return null;
}

/**
 * Шлюз проверок: до какого тика комнате нечего перепроверять.
 *
 * Живёт в heap: рестарт VM его теряет, и первая же проверка проходит как
 * обычно — отсутствие записи означает «проверять сейчас». Ключей ровно по
 * числу своих комнат (мёртвых комнат в империи не бывает), поэтому чистка,
 * о которой предупреждает скилл для кэшей по имени крипа, здесь не нужна.
 */
function spawnGate() {
  return global.__spawnGate || (global.__spawnGate = {});
}

/**
 * Сдвиг фазы проверок для комнаты — тот же приём, что rebuildStagger
 * (scanner.js:106-112): без него все комнаты проверяются в один тик
 * и дают периодический пик на всю империю.
 *
 * @param {string} roomName
 * @returns {number} 0 .. SPAWN.SCAN_INTERVAL-1
 */
function scanStagger(roomName) {
  let h = 0;
  for (let i = 0; i < roomName.length; i++) {
    h = (h * 31 + roomName.charCodeAt(i)) % 9973;
  }
  return h % SPAWN.SCAN_INTERVAL;
}

/** Следующий тик проверки для комнаты, которой сейчас ничего не нужно. */
function idleDue(roomName, now, firstScan) {
  return (
    now + SPAWN.SCAN_INTERVAL - (firstScan ? scanStagger(roomName) : 0)
  );
}

/**
 * @param {Object} roomState
 */
function run(roomState) {
  const roomName = roomState.roomName;
  const now = Game.time;
  const gate = spawnGate();
  const due = gate[roomName];

  // Шлюз: пока не наступил срок, комната не делает НИЧЕГО — ни счёта ролей,
  // ни поиска спавна. Проверка — одно чтение heap и сравнение чисел.
  if (due !== undefined && now < due) return;

  // Комнате нечем спавнить: считать роли незачем. Длина массива читается без
  // геттеров движка и дешевле, чем .spawning у каждого спавна.
  if (roomState.spawns.length === 0) {
    gate[roomName] = idleDue(roomName, now, due === undefined);
    return;
  }

  // Профиль по требованию: пока флаг не задан, лишних Game.cpu.getUsed нет.
  const prof = Memory.cpuSpawnProfile === true;
  let mark = prof ? Game.cpu.getUsed() : 0;

  // Один проход вместо девяти.
  const counts = countRoles(roomState.creeps);

  if (prof) {
    cpuMonitor.acc("spawn.countRoles", Game.cpu.getUsed() - mark);
    mark = Game.cpu.getUsed();
  }

  let spawn = null;
  let findCPU = 0;
  // Нужен ли комнате хоть один крип: роль ниже квоты, прошедшая проверки.
  let roomWants = false;

  // Обход остался `for...in` по SPAWN_QUOTA: вариант с предвычисленным
  // массивом ролей с квотой > 0 проверен локальным микробенчмарком 30.09.2026
  // (scripts/spawn.ab.bench.js, Node) и оказался на ~16 нс/вызов ДОРОЖЕ — обход
  // девяти ключей с отсечением пяти нулевых дешевле массива из четырёх, где
  // роль всё равно ищется в SPAWN_QUOTA. Не возвращать без нового замера.
  for (const role in SPAWN_QUOTA) {
    const quota = SPAWN_QUOTA[role];

    // Роль с нулевой квотой не спавнится — незачем её считать и проверять.
    if (!quota) continue;

    // Квота уже набрана. Проверка идёт ДО дорогих условий ниже: например,
    // для mineralMiner это экономит Game.getObjectById на каждом тике.
    if ((counts[role] || 0) >= quota) continue;

    if (
      role === "upgrader" &&
      roomState.room.controller.ticksToDowngrade > 100000
    )
      continue;

    if (role === "mineralMiner") {
      // amount уже в состоянии — резолвить минерал заново не нужно.
      if (!roomState.mineral || !roomState.mineral.extractorId) continue;
      if (roomState.mineral.amount < MINERAL_MIN_AMOUNT_TO_SPAWN) continue;
    }

    roomWants = true;

    // ЛЕНИВЫЙ ПОИСК спавна: до этой строки доходит только комната, которой крип
    // действительно нужен. Раньше `find` платился в каждой комнате каждый тик —
    // замер 30.09.2026: 0.0223 CPU/тик, 36 % расхода подсистемы, при том что
    // империя ничего не спавнила (все спавны свободны, недоборов нет).
    if (!spawn) {
      if (prof) {
        const findStart = Game.cpu.getUsed();
        spawn = findFreeSpawn(roomState.spawns);
        findCPU += Game.cpu.getUsed() - findStart;
      } else {
        spawn = findFreeSpawn(roomState.spawns);
      }
      // Спавнить некуда (все заняты) — проверим снова на следующем тике.
      if (!spawn) break;
    }

    const result = creepFactory.run(
      spawn,
      role,
      roomName,
      PRESPAWN_THRESHOLD[role],
    );
    // break, а не return: выход ровно тот же (после цикла в функции ничего
    // нет, кроме шлюза и профиля), но шлюз успевает записать следующий срок.
    if (result === OK) break;
  }

  // Следующая проверка. Недобор есть — каждый тик, как и раньше: крип не
  // появляется мгновенно (тело строится десятки тиков), спавн может быть занят,
  // энергии может не хватить, а роль может остаться недобранной и после
  // успешного спавна (квота 2, а в очереди был один). Недобора нет — интервал
  // со сдвигом по имени комнаты: первый срок сокращён сдвигом, дальше фазы
  // комнат разнесены по тикам.
  gate[roomName] = roomWants
    ? now + 1
    : idleDue(roomName, now, due === undefined);

  if (prof) {
    cpuMonitor.acc("spawn.find", findCPU);
    cpuMonitor.acc("spawn.quotaLoop", Game.cpu.getUsed() - mark - findCPU);
  }
}

module.exports.run = run;
// Экспортируется для офлайн-тестов (tests/spawn.count.test.js).
module.exports.countRoles = countRoles;
