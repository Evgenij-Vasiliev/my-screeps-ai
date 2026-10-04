"use strict";
/**
 * ===================================================
 * LOAD.SHED.TEST.JS — офлайн-проверка переключателя нагрузки
 * ===================================================
 * Проверяем ровно то, от чего зависит поведение бота в проде:
 *   1) отсутствие флага — обычный режим;
 *   2) три уровня и их порядок (lite < hard < max);
 *   3) `true` читается как "lite" (булево «включить»);
 *   4) неизвестное значение НЕ глушит подсистемы (опечатка безопасна);
 *   5) atLeast с неизвестным именем уровня — false, а не исключение;
 *   6) name() возвращает имя текущего уровня.
 *
 * Запуск: node tests/load.shed.test.js
 */

global.Memory = {};

const loadShed = require("../loadShed");
const { MARKET } = require("../constants");

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra === undefined ? "" : " — " + extra}`);
  }
}

console.log("1. Флаг не задан — обычный режим");
delete global.Memory.loadShed;
check("level() === 0", loadShed.level() === 0, String(loadShed.level()));
check("name() === off", loadShed.name() === "off", loadShed.name());
check("atLeast('lite') === false", loadShed.atLeast("lite") === false);
check("atLeast('off') === true", loadShed.atLeast("off") === true);

console.log("\n2. Уровни и их порядок");
global.Memory.loadShed = "lite";
check("lite: atLeast(off)", loadShed.atLeast("off") === true);
check("lite: atLeast(lite)", loadShed.atLeast("lite") === true);
check("lite: !atLeast(hard)", loadShed.atLeast("hard") === false);
check("lite: !atLeast(max)", loadShed.atLeast("max") === false);

global.Memory.loadShed = "hard";
check("hard: atLeast(lite)", loadShed.atLeast("lite") === true);
check("hard: atLeast(hard)", loadShed.atLeast("hard") === true);
check("hard: !atLeast(max)", loadShed.atLeast("max") === false);

global.Memory.loadShed = "max";
check("max: atLeast(hard)", loadShed.atLeast("hard") === true);
check("max: atLeast(max)", loadShed.atLeast("max") === true);
check("max: name() === max", loadShed.name() === "max", loadShed.name());

console.log("\n3. Булево true — это lite");
global.Memory.loadShed = true;
check("true: level() === 1", loadShed.level() === 1, String(loadShed.level()));
check("true: !atLeast(hard)", loadShed.atLeast("hard") === false);

console.log("\n4-5. Неизвестное значение безопасно");
global.Memory.loadShed = "HARD"; // регистр не тот
check("неизвестное значение: level() === 0", loadShed.level() === 0);
check("неизвестное значение: name() === off", loadShed.name() === "off");
check("atLeast('нет такого') === false", loadShed.atLeast("нет такого") === false);
check("atLeast(undefined) === false", loadShed.atLeast(undefined) === false);

console.log("\n6. Пустая/битая Memory не роняет модуль");
global.Memory.loadShed = null;
check("null → уровень 0", loadShed.atLeast("lite") === false);
delete global.Memory.loadShed;
check("после delete → уровень 0", loadShed.level() === 0);

console.log("\n7. Автоматические пороги по бакету (настраиваемые)");
// По умолчанию: lite 9000, hard 7000, max 5000.
global.Game = { cpu: { bucket: 10000 } };
check("полный бакет → off", loadShed.bucketLevel() === 0, loadShed.name());
global.Game.cpu.bucket = 9500;
check("9500 → off", loadShed.bucketLevel() === 0);
global.Game.cpu.bucket = 8999;
check("8999 → lite", loadShed.bucketLevel() === 1, String(loadShed.bucketLevel()));
global.Game.cpu.bucket = 7000;
check("7000 → lite (порог hard строгий)", loadShed.bucketLevel() === 1);
global.Game.cpu.bucket = 6999;
check("6999 → hard", loadShed.bucketLevel() === 2);
global.Game.cpu.bucket = 5000;
check("5000 → hard", loadShed.bucketLevel() === 2);
global.Game.cpu.bucket = 4999;
check("4999 → max", loadShed.bucketLevel() === 3);
global.Game.cpu.bucket = 0;
check("0 → max", loadShed.bucketLevel() === 3);

console.log("\n8. Пороги переопределяются из Memory");
global.Memory.loadShedThresholds = { lite: 9900, hard: 9800, max: 9700 };
global.Game.cpu.bucket = 9500;
check("свои пороги: 9500 → max", loadShed.bucketLevel() === 3);
check("thresholds() отдаёт свои", loadShed.thresholds().lite === 9900);
global.Memory.loadShedThresholds = { hard: 8500 };
global.Game.cpu.bucket = 8600;
check("частичное переопределение: 8600 → lite", loadShed.bucketLevel() === 1);
global.Game.cpu.bucket = 8400;
check("частичное: 8400 → hard", loadShed.bucketLevel() === 2);

console.log("\n9. Битая настройка порогов не глушит Империю");
global.Memory.loadShedThresholds = { lite: "9000", hard: null, max: NaN };
global.Game.cpu.bucket = 10000;
check("мусор в порогах → off", loadShed.bucketLevel() === 0);
check("мусор → берутся значения по умолчанию", loadShed.thresholds().max === 5000);
global.Memory.loadShedThresholds = { lite: 6000, hard: 9000, max: 3000 };
global.Game.cpu.bucket = 5000;
// 5000 < lite(6000) → да, 5000 < hard(9000) → да, 5000 < max(3000) → нет.
// Строгий ИЗ ПОДХОДЯЩИХ = hard. Бот не «мигает» между уровнями.
check("перепутанные пороги → строгий из подходящих (hard)", loadShed.bucketLevel() === 2);
global.Game.cpu.bucket = 2000;
// Теперь подходят все три — побеждает самый строгий.
check("все пороги сработали → max", loadShed.bucketLevel() === 3);

console.log("\n10. Итоговый уровень = строже из ручного и авто");
delete global.Memory.loadShedThresholds;
global.Game.cpu.bucket = 10000;
global.Memory.loadShed = "hard";
check("ручной hard при полном бакете", loadShed.effectiveLevel() === 2);
delete global.Memory.loadShed;
global.Game.cpu.bucket = 4500;
check("авто max без ручного", loadShed.effectiveLevel() === 3);
check("effectiveAtLeast('max')", loadShed.effectiveAtLeast("max") === true);
global.Game.cpu.bucket = 10000;
check("полный бакет и нет флага → off", loadShed.effectiveLevel() === 0);
check("effectiveAtLeast('lite') === false", loadShed.effectiveAtLeast("lite") === false);

console.log("\n11. Без Game (офлайн) авторежим молчит");
global.Game.cpu.bucket = 8000;
delete global.Game;
check("нет Game → bucketLevel 0", loadShed.bucketLevel() === 0);
check("debug() не падает без Game", loadShed.debug().bucket === null);
global.Game = { cpu: { bucket: 8000 } };
check("debug() показывает причину", loadShed.debug().bucketLevel === 1);

console.log("\n12. Внутритиковый гейт по остатку бюджета (Шаг 8)");
// Полный снимок Game, как на шарде: лимит 20, полный bucket, ручного флага нет.
delete global.Memory.loadShed;
global.Game = {
  time: 900001,
  cpu: { bucket: 10000, limit: 20, getUsed: () => 0 },
};
check("использовано 0 → !overBudget()", loadShed.overBudget() === false);
check("использовано 0 → уровень off", loadShed.effectiveLevel() === 0, String(loadShed.effectiveLevel()));

global.Game.cpu.getUsed = () => 16; // ровно 0.8 × 20
check("used == limit × 0.8 → false (сравнение строгое)", loadShed.overBudget() === false);
global.Game.cpu.getUsed = () => 16.001;
check("used > limit × 0.8 → true", loadShed.overBudget() === true);
check("гейт → effectiveLevel() = hard (2)", loadShed.effectiveLevel() === 2, String(loadShed.effectiveLevel()));
check("гейт → effectiveAtLeast('hard')", loadShed.effectiveAtLeast("hard") === true);
check("гейт → НЕ max: effectiveAtLeast('max') === false", loadShed.effectiveAtLeast("max") === false);
check("гейт сработал при полном bucket", loadShed.bucketLevel() === 0 && loadShed.effectiveLevel() === 2);
check("гейт не трогает ручной уровень", loadShed.level() === 0);

console.log("\n13. Без данных гейт молчит (офлайн, симулятор)");
delete global.Game.cpu.getUsed;
check("нет getUsed → false", loadShed.overBudget() === false);
check("нет getUsed → уровень off", loadShed.effectiveLevel() === 0);
global.Game.cpu.getUsed = () => 19;
delete global.Game.cpu.limit;
check("нет limit → false", loadShed.overBudget() === false);
global.Game.cpu.limit = 0;
check("limit = 0 → false", loadShed.overBudget() === false);
global.Game.cpu.limit = NaN;
check("limit = NaN → false", loadShed.overBudget() === false);
global.Game.cpu.limit = 20;
global.Game.cpu.getUsed = () => NaN;
check("getUsed() = NaN → false", loadShed.overBudget() === false);
delete global.Game;
check("нет Game → false", loadShed.overBudget() === false);
check("debug() не падает без Game", loadShed.debug().overBudget === false);

console.log("\n14. Порог настраивается из консоли, мусор безопасен");
global.Game = {
  time: 900002,
  cpu: { bucket: 10000, limit: 20, getUsed: () => 11 },
};
check("порог по умолчанию 0.8", loadShed.budgetRatio() === 0.8);
check("11 CPU при пороге 0.8 (16) → false", loadShed.overBudget() === false);
global.Memory.loadShedBudgetRatio = 0.5;
check("свой порог 0.5 → budgetRatio() = 0.5", loadShed.budgetRatio() === 0.5);
check("11 CPU при пороге 0.5 (10) → true", loadShed.overBudget() === true);
check("свой порог → уровень hard", loadShed.effectiveLevel() === 2);
global.Memory.loadShedBudgetRatio = "0.5";
check("строка игнорируется → 0.8", loadShed.budgetRatio() === 0.8);
global.Memory.loadShedBudgetRatio = 0;
check("0 игнорируется → 0.8 (0 не «глушит всегда»)", loadShed.budgetRatio() === 0.8);
global.Memory.loadShedBudgetRatio = -2;
check("отрицательное игнорируется → 0.8", loadShed.budgetRatio() === 0.8);
global.Memory.loadShedBudgetRatio = NaN;
check("NaN игнорируется → 0.8", loadShed.budgetRatio() === 0.8);
global.Memory.loadShedBudgetRatio = Infinity;
check("Infinity игнорируется → 0.8", loadShed.budgetRatio() === 0.8);
global.Memory.loadShedBudgetRatio = 100;
check("100 → гейт выключен без выгрузки (11 < 2000)", loadShed.overBudget() === false);
check("100 → уровень снова off", loadShed.effectiveLevel() === 0);
delete global.Memory.loadShedBudgetRatio;

console.log("\n15. Наблюдаемость: счётчик срабатываний в heap");
delete global.__loadShedGate;
global.Game = {
  time: 900010,
  cpu: { bucket: 10000, limit: 20, getUsed: () => 16.5 },
};
loadShed.overBudget();
loadShed.overBudget();
check(
  "2 вызова, 2 срабатывания",
  global.__loadShedGate.calls === 2 && global.__loadShedGate.over === 2,
  JSON.stringify(global.__loadShedGate),
);
check("lastUsed = 16.5", global.__loadShedGate.lastUsed === 16.5);
global.Game.cpu.getUsed = () => 1;
loadShed.overBudget();
check(
  "в том же тике вызовов 3, срабатываний 2",
  global.__loadShedGate.calls === 3 && global.__loadShedGate.over === 2,
  JSON.stringify(global.__loadShedGate),
);
global.Game.time = 900011;
loadShed.overBudget();
check(
  "новый тик сбрасывает счётчики",
  global.__loadShedGate.calls === 1 && global.__loadShedGate.over === 0,
  JSON.stringify(global.__loadShedGate),
);
check("lastUsed обновился", global.__loadShedGate.lastUsed === 1);
global.Game.cpu.getUsed = () => 17;
const dbg = loadShed.debug();
check(
  "debug(): used / limit / ratio",
  dbg.used === 17 && dbg.limit === 20 && dbg.ratio === 0.8,
  JSON.stringify(dbg),
);
check("debug(): overBudget и effective = hard", dbg.overBudget === true && dbg.effective === "hard");
check("debug(): отдаёт срез heap-счётчика", dbg.gate !== null && typeof dbg.gate.calls === "number");

console.log("\n16. Поведение рынка при исчерпанном бюджете (market.manager.run)");
// Шим разрешения модулей: на шарде require("loadShed") резолвится от корня,
// в Node — нет (тот же приём, что в tests/spawn.count.test.js:19-30).
const Module = require("module");
const fs = require("fs");
const path = require("path");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

// Глобалы движка, нужные market.manager.js на этапе загрузки (в рантайме их
// даёт движок: модуль строит BASE_MINERALS/COMPOUNDS прямо в теле файла).
global.RESOURCE_HYDROGEN = "H";
global.RESOURCE_OXYGEN = "O";
global.RESOURCE_UTRIUM = "U";
global.RESOURCE_LEMERGIUM = "L";
global.RESOURCE_KEANIUM = "K";
global.RESOURCE_ZYNTHIUM = "Z";
global.RESOURCE_CATALYST = "X";
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_BATTERY = "battery";
global.RESOURCES_ALL = [
  "energy",
  "battery",
  "H",
  "O",
  "U",
  "L",
  "K",
  "Z",
  "X",
  "GHODIUM",
];
global.ORDER_SELL = "sell";
global.ORDER_BUY = "buy";

const market = require("../market.manager");

/** Game со счётчиком обращений к Game.rooms: гейт должен остановить run() ДО обхода комнат. */
function gameWith(used) {
  let touched = 0;
  const game = {
    // Кратно MARKET.INTERVAL — иначе throttle рынка вернётся раньше гейта по
    // бюджету и проверка перестанет что-либо показывать. Значение берётся из
    // constants, а не числом: интервал меняется (10 -> 30, батч 1 снижения CPU).
    time: MARKET.INTERVAL * 3,
    market: {},
    cpu: { bucket: 10000, limit: 20, getUsed: () => used },
  };
  Object.defineProperty(game, "rooms", {
    get() {
      touched++;
      return {};
    },
    enumerable: true,
    configurable: true,
  });
  return { game, touched: () => touched };
}

const hot = gameWith(17); // 17 > 0.8 × 20 = 16
global.Game = hot.game;
delete global.__marketTerminalRooms; // кэш имён комнат не должен переносить результат
market.run();
check("бюджет исчерпан → рынок не обошёл комнаты", hot.touched() === 0, String(hot.touched()));

const cold = gameWith(1);
global.Game = cold.game;
delete global.__marketTerminalRooms;
market.run();
check("бюджет в норме → рынок дошёл до комнат", cold.touched() > 0, String(cold.touched()));

const off = gameWith(17);
global.Game = off.game;
global.Memory.loadShedBudgetRatio = 100; // гейт выключен из консоли, без выгрузки
delete global.__marketTerminalRooms;
market.run();
check("порог 100 из консоли → рынок работает как раньше", off.touched() > 0, String(off.touched()));
delete global.Memory.loadShedBudgetRatio;

console.log("\n17. Гейт подключён в точках использования (механически)");
// Приём тот же, что в tests/rules.test.js:103-108: комментарии и строковые
// литералы убираются, чтобы проверка не срабатывала на текст.
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}
/**
 * Слой комнаты целиком: фасад room.manager.js и каталог room/*.js (разбиение
 * 04.10.2026). Проверка идёт по слою, а не по одному файлу: гейт фабрики и
 * powerSpawn переехал в room/run.js, и проверка одного фасада стала бы
 * ложно-зелёной (в фасаде нет этого кода — значит и нарушения нет).
 */
const roomLayer = (() => {
  const root = path.join(__dirname, "..");
  const dir = path.join(root, "room");
  const files = ["room.manager.js"].concat(
    fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort().map(f => path.join("room", f))
      : [],
  );
  return files.map(rel => stripComments(fs.readFileSync(path.join(root, rel), "utf8"))).join("\n");
})();
const roomSrc = roomLayer;
const marketSrc = stripComments(
  fs.readFileSync(path.join(__dirname, "..", "market.manager.js"), "utf8"),
);
// Страховка от ложной зелени: если слой прочитан не полностью (каталог room/
// не найден, файлы переименованы), проверка «нет своего порога CPU» ниже
// пройдёт на пустой строке и ничего не проверит.
check(
  "слой комнаты прочитан целиком",
  /runRoom/.test(roomSrc) && /shedHard/.test(roomSrc) && /pickRepairTarget/.test(roomSrc),
);
check(
  "room.manager: фабрика и powerSpawn за гейтом",
  /if \(!shedHard && !loadShed\.overBudget\(\)\)/.test(roomSrc),
);
check("room.manager: нет своего порога CPU (гейт централизован)", !/Game\.cpu\.getUsed/.test(roomSrc));
check(
  "market.manager: рынок за внутритиковым гейтом",
  /if \(loadShed\.overBudget\(\)\) return;/.test(marketSrc),
);
check("market.manager: bucket-гейт не заменён, а дополнен", /bucketLevel\(\) > 0/.test(marketSrc));

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
