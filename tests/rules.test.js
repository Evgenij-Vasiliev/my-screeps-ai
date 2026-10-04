"use strict";
/**
 * ===================================================
 * RULES.TEST.JS — автоматическая проверка правил по CPU
 * ===================================================
 * Разделы 1-6 отвечают правилам 1-5 §11.1 и §12
 * docs/task-system-v3.0/DEVELOPMENT_RULES.md, разделы 7-9 — правилам 6-8 §11.1.
 * Этот тест следит за ними МЕХАНИЧЕСКИ: правила, которые проверяются
 * глазами, перестают соблюдаться. Проверяется рантайм-код, который уезжает
 * на шард (корневые модули, constants/* и room/*).
 *
 *   1) Game.market.* — только в market.manager.js;
 *   2) getAllOrders — только через кэш на тик (getOrders);
 *   3) Object.values(Game.*) — не в коде, исполняемом на каждого крипа;
 *   4) room.find — не в горячем пути ролей и worker.runner;
 *   5) Memory — только переживающее рестарт; временные поля с "__" убираются;
 *   6) замер подсистем включён (cpuMonitor пишет subsystems).
 *   7) executors не резолвят id до проверки стора (ленивый резолв цели);
 *   8) нет записи в creep.memory без изменения значения;
 *   9) нет литеральных reusePath: значение берётся только из MOVE.*.
 *
 * Правила 7-9 введены шагом «каждое новое правило CPU — механическим тестом» и
 * опираются на практику, уже зафиксированную в рантайме:
 *   ленивый резолв — task/exec.terminal.js:32, :117, task/exec.powerSpawn.js:155,
 *   :195 (резолв source стоит в самой ветке, где он нужен);
 *   запись Memory при смене значения — task/exec.factory.js:31-42,
 *   запись taskIndex при смене значения — task/runner.js:78-79;
 *   единая политика reusePath — constants/system.js:65-70.
 *
 * Опорные цифры: 8.53 CPU/тик при 27 крипах (docs/cpu-baseline-8.53.json,
 * 2026-09-27) против 6.22 при 36 — замер человека от 29.09.2026, в docs/ не
 * сохранён (последний файл в репозитории, docs/cpu-baseline.json, — 7.015 при 26).
 *
 * Запуск: node tests/rules.test.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/** Рантайм-модули: ровно то, что уезжает на шард (см. scripts/deploy.modules.js SRC). */
function runtimeFiles() {
  const root = fs
    .readdirSync(ROOT)
    .filter(f => f.endsWith(".js"))
    .filter(
      f =>
        ![
          "Gruntfile.js",
          "screeps.token.js",
          "eslint.config.js",
        ].includes(f),
    )
    .map(f => ({ name: f, text: fs.readFileSync(path.join(ROOT, f), "utf8") }));

  // Подкаталоги рантайма. task/ добавлен 04.10.2026 вместе с разбиением
  // системы задач: логика уехала в task/*.js, а корневые task.manager.js,
  // task.executors.js и worker.runner.js стали тонкими фасадами. Без этого
  // правила CPU (per-creep код, ленивый резолв, creep.memory, reusePath)
  // перестали бы видеть перемещённый код и остались бы зелёными вхолостую.
  //
  // room/ добавлен тогда же отдельным шагом по находке: каталог уезжает на
  // шард (SRC деплоя), но правилами не сканировался вообще. Прогон с ним дал
  // 30/30 PASS — нарушений в room/*.js нет, расширение области ничего не
  // ломает, но теперь файловые проверки (рынок, Memory/heap, creep.memory,
  // reusePath) видят 6 файлов / 1060 строк, которых не видели раньше.
  //
  // Список каталогов обязан совпадать с SRC деплоя (scripts/deploy.modules.js):
  // расхождение = код уезжает на шард непроверенным.
  const subs = [];
  for (const dir of ["constants", "task", "room"]) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).filter(f => f.endsWith(".js"))) {
      subs.push({
        name: dir + "/" + f,
        text: fs.readFileSync(path.join(full, f), "utf8"),
      });
    }
  }

  return root.concat(subs);
}

/**
 * Текст корневого модуля ВМЕСТЕ с его подкаталогом. После разбиения 04.10.2026
 * корневой файл — тонкий фасад на те же экспорты, поэтому проверять только его
 * бессмысленно: `function compactAll(` в фасаде нет, и «зелёный» результат
 * ничего не подтверждал бы.
 *
 * @param {string} name имя корневого модуля ("task.manager.js")
 * @param {string} dir каталог его модулей ("task")
 */
function moduleCode(name, dir) {
  const files = FILES.filter(f => f.name === name)
    .concat(FILES.filter(f => f.name.startsWith(dir + "/")))
    .map(f => f.text);
  return files.join("\n");
}

/** Убирает комментарии и строковые литералы, чтобы правила не срабатывали на текст. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}

const FILES = runtimeFiles();

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

function offenders(re, allow) {
  const out = [];
  for (const f of FILES) {
    if (allow && allow.includes(f.name)) continue;
    const body = code(f.text);
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) out.push(`${f.name}:${i + 1}`);
      re.lastIndex = 0;
    }
  }
  return out;
}

/**
 * То же самое, что code(), но с сохранением нумерации строк: комментарии и
 * строковые литералы заменяются пробелами. Нужно там, где в сообщении о
 * нарушении важен настоящий номер строки (правила 7-9).
 */
function blank(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, m => m.replace(/[^\n]/g, " "))
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, m => m.replace(/[^\n]/g, " "));
}

/** Номер строки (1-based) для смещения в тексте. */
function lineOf(src, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === "\n") n++;
  }
  return n;
}

/**
 * Функции верхнего уровня: объявление с нулевой колонки, конец — "}" в нулевой
 * колонке. Границы нужны, чтобы правило про executors не «протекало» в соседние
 * функции файла.
 */
function functionBodies(src) {
  const out = [];
  const ls = src.split("\n");
  let cur = null;
  for (let i = 0; i < ls.length; i++) {
    const decl = ls[i].match(/^function\s+([\w$]+)\s*\(/);
    if (decl) {
      cur = { name: decl[1], startLine: i + 1, body: [] };
      out.push(cur);
    } else if (cur) {
      if (ls[i] === "}") {
        cur = null;
        continue;
      }
      cur.body.push({ line: i + 1, text: ls[i] });
    }
  }
  return out;
}

/**
 * Условные конструкции: тела `if (...)` и ветки `case ...:` / `default:`.
 * Всё, что записано в `creep.memory` вне этих границ, исполняется каждый тик
 * безусловно (правило 8).
 */
function conditionalBlocks(src) {
  const out = [];
  const ifRe = /\bif\s*\(/g;
  let m;

  while ((m = ifRe.exec(src))) {
    const open = src.indexOf("(", m.index);
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const cond = src.slice(open + 1, i).replace(/\s+/g, " ");

    let j = i + 1;
    while (j < src.length && /\s/.test(src[j])) j++;

    let start;
    let end;
    if (src[j] === "{") {
      let d = 0;
      let k = j;
      for (; k < src.length; k++) {
        if (src[k] === "{") d++;
        else if (src[k] === "}") {
          d--;
          if (d === 0) break;
        }
      }
      start = j + 1;
      end = k;
    } else {
      const semi = src.indexOf(";", j);
      start = j;
      end = semi === -1 ? src.length : semi;
    }
    out.push({ cond, start, end });
  }

  const caseRe = /\b(?:case\s+[^:]+|default)\s*:/g;
  while ((m = caseRe.exec(src))) {
    const start = caseRe.lastIndex;
    const next = src.slice(start).search(/\n\s*(?:case\b|default\s*:|\})/);
    out.push({
      cond: m[0].trim(),
      start,
      end: next === -1 ? src.length : start + next,
    });
  }
  return out;
}

/** Аргументы вызова: openIdx — индекс "(" в тексте. */
function callArgs(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return src.slice(openIdx + 1);
}

console.log("1. Рынок изолирован в market.manager.js");
const marketUse = offenders(/\bGame\.market\b/, ["market.manager.js"]);
check("Game.market только в market.manager.js", marketUse.length === 0, marketUse.join(", "));

console.log("\n2. getAllOrders вызывается только через кэш на тик");
const mm = FILES.find(f => f.name === "market.manager.js");
const mmCode = code(mm.text);
const directCalls = (mmCode.match(/Game\.market\.getAllOrders/g) || []).length;
check("ровно один прямой вызов getAllOrders (внутри кэша)", directCalls === 1, String(directCalls));
check("кэш на тик присутствует", /function getOrders\(/.test(mmCode));
check(
  "кэш ключуется игровым временем",
  /function getOrders\([\s\S]{0,400}?Game\.time[\s\S]{0,400}?__marketOrders/.test(mmCode),
);

console.log("\n3. Object.values(Game.*) не в per-creep коде");
// Per-creep код — тот, что исполняется в цикле по крипам: роли (их зовёт
// runCreepLogic), worker.runner, task/runner* (тот же код после разбиения
// 04.10.2026) и сам драйвер цикла room/creeps.js:61-80 — если Object.values
// попадёт в его тело, он умножится на число крипов ровно так же.
const perCreep = FILES.filter(
  f =>
    f.name.startsWith("role.") ||
    f.name === "worker.runner.js" ||
    f.name.startsWith("task/runner") ||
    f.name === "room/creeps.js",
);
const perCreepHits = perCreep.filter(f => /Object\.(values|keys)\(Game\./.test(code(f.text)));
check(
  "в ролях и worker.runner нет Object.values/keys(Game.*)",
  perCreepHits.length === 0,
  perCreepHits.map(f => f.name).join(", "),
);

console.log("\n4. room.find не в горячем пути ролей");
const findHits = perCreep.filter(f => /\.find\(FIND_|room\.find\(/.test(code(f.text)));
check(
  "в ролях нет room.find",
  findHits.length === 0,
  findHits.map(f => f.name).join(", "),
);

console.log("\n5. Memory: временные поля убираются, статика — в heap");
const empire = FILES.find(f => f.name === "empire.js");
const empireCode = code(empire.text);
check("есть уборка временных полей", /charCodeAt\(0\) === 95/.test(empireCode));
check("есть escape-флаг keepTemp", /keepTemp/.test(empireCode));

const towerCode = code(FILES.find(f => f.name === "role.tower.js").text);
check("role.tower не пишет Memory.towerState", !/Memory\.towerState/.test(towerCode));

const scannerCode = code(FILES.find(f => f.name === "scanner.js").text);
check(
  "кэш структур живёт в heap",
  /global\.__structureCache/.test(scannerCode) &&
    !/roomMemory\.structureCache\s*=/.test(scannerCode),
);

const taskCode = code(moduleCode("task.manager.js", "task"));
check("индекс задач живёт в heap", /global\.__taskHeap/.test(taskCode));
check("очереди сжимаются (compactAll)", /function compactAll\(/.test(taskCode));
check("splice из completeTask убран", !/\.splice\(/.test(taskCode));

console.log("\n6. Наблюдаемость: разбивка по подсистемам");
const monitorCode = code(FILES.find(f => f.name === "cpuMonitor.js").text);
check("cpuMonitor пишет subsystems", /subsystems/.test(monitorCode));
check("накопители живут в heap", /global\.__cpuMonitor/.test(monitorCode));
check("Memory.cpuStats пишется не каждый тик", /REPORT_INTERVAL/.test(monitorCode));

console.log("\n7. Executors: id резолвится только в ветке, где нужен");
const executorSrc = blank(moduleCode("task.executors.js", "task"));
const executorFns = functionBodies(executorSrc).filter(f =>
  f.name.startsWith("execute"),
);

/**
 * Известное исключение: в executeCollectFactoryBattery source (сама фабрика)
 * резолвится вместе с target в общей проверке задачи, до фазовой проверки —
 * task/exec.factory.js:109-112. Список ровно на одну запись и проверяется на
 * актуальность: если исключение исчезнет, тест об этом скажет.
 */
const SOURCE_EARLY_KNOWN = ["executeCollectFactoryBattery"];

check(
  "executors найдены (защита от ложной зелени)",
  executorFns.length >= 11,
  String(executorFns.length),
);

// source (откуда брать энергию) нужен только в фазе забора: резолвить его до
// проверки стора/фазы — платить Game.getObjectById за ветку, которая не пойдёт.
const sourceEarly = executorFns.filter(f => {
  const resolved = f.body.find(l => /resolveTarget\(task\.sourceId\)/.test(l.text));
  if (!resolved) return false;
  const phaseCheck = f.body.find(l =>
    /creep\.store|creep\.memory\.working/.test(l.text),
  );
  return phaseCheck && resolved.line < phaseCheck.line;
});
const unexpectedEarly = sourceEarly.filter(
  f => !SOURCE_EARLY_KNOWN.includes(f.name),
);
check(
  "source резолвится после проверки стора/фазы",
  unexpectedEarly.length === 0,
  unexpectedEarly.map(f => `${f.name} (строка ${f.startLine})`).join(", "),
);
check(
  "список известных исключений по source не устарел",
  sourceEarly.length === SOURCE_EARLY_KNOWN.length,
  `найдено ${sourceEarly.length}: ${sourceEarly.map(f => f.name).join(", ")}`,
);

// Мёртвый резолв — это тот же лишний Game.getObjectById: результат объявлен, но
// в функции больше не используется (в task.executors.js так уже было трижды).
const deadResolves = [];
for (const f of functionBodies(executorSrc)) {
  const body = f.body.map(l => l.text).join("\n");
  const re = /const\s+([\w$]+)\s*=\s*resolveTarget\(/g;
  let m;
  while ((m = re.exec(body))) {
    if (!new RegExp("\\b" + m[1] + "\\b").test(body.slice(re.lastIndex))) {
      deadResolves.push(`${f.name} (строка ${f.startLine})`);
    }
  }
}
check(
  "нет мёртвых резолвов: результат resolveTarget используется",
  deadResolves.length === 0,
  deadResolves.join(", "),
);

console.log("\n8. creep.memory: запись только при смене значения");
const memOutOfCondition = [];
const memLiteralUnguarded = [];
const memDeleteOutOfCondition = [];
let memWrites = 0;

for (const f of FILES) {
  const src = blank(f.text);
  const blocks = conditionalBlocks(src);

  const writeRe = /creep\.memory\.([\w$]+)\s*=(?!=)/g;
  let m;
  while ((m = writeRe.exec(src))) {
    memWrites++;
    const field = m[1];
    const offset = m.index;
    const enclosing = blocks.filter(b => b.start <= offset && offset <= b.end);

    if (enclosing.length === 0) {
      memOutOfCondition.push(`${f.name}:${lineOf(src, offset)}`);
    }

    // Значение-константа (true/false/null/число) пишется только под условием,
    // которое сверяется с ТЕКУЩИМ значением того же поля. Иначе это перезапись
    // того же значения: Memory сериализуется целиком каждый тик.
    let end = src.indexOf(";", writeRe.lastIndex);
    if (end === -1) end = src.length;
    const rhs = src.slice(writeRe.lastIndex, end).replace(/\s+/g, " ").trim();
    const isLiteral = /^(?:true|false|null|-?\d+(?:\.\d+)?)$/.test(rhs);
    const sameField = new RegExp("creep\\.memory\\." + field + "\\b");
    if (isLiteral && !enclosing.some(b => sameField.test(b.cond))) {
      memLiteralUnguarded.push(
        `${f.name}:${lineOf(src, offset)} (${field} = ${rhs})`,
      );
    }
  }

  // delete в конце цепочки ранних return (task/exec.terminal.js:159) синтаксически
  // стоит вне блока, но исполняется только условно. Поэтому нарушением считаем
  // delete и без условия, и без чтения того же поля выше: это чистка поля,
  // которого в этом тике никто не видел.
  const delRe = /delete\s+creep\.memory\.([\w$]+)/g;
  while ((m = delRe.exec(src))) {
    const field = m[1];
    const offset = m.index;
    const inBlock = blocks.some(b => b.start <= offset && offset <= b.end);
    const wasRead = new RegExp("creep\\.memory\\." + field + "\\b").test(
      src.slice(0, offset),
    );
    if (!inBlock && !wasRead) {
      memDeleteOutOfCondition.push(`${f.name}:${lineOf(src, offset)}`);
    }
  }
}

check(
  "записей в creep.memory найдено (защита от ложной зелени)",
  memWrites >= 20,
  String(memWrites),
);
check(
  "нет безусловных записей в creep.memory",
  memOutOfCondition.length === 0,
  memOutOfCondition.join(", "),
);
check(
  "нет литеральных записей без сверки с текущим значением",
  memLiteralUnguarded.length === 0,
  memLiteralUnguarded.join(", "),
);
check(
  "нет delete creep.memory.* без условия и без чтения поля",
  memDeleteOutOfCondition.length === 0,
  memDeleteOutOfCondition.join(", "),
);

console.log("\n9. reusePath: только MOVE.* и всегда у moveTo");
/** Файл не зашит: словарь MOVE живёт в constants/system.js (разбиение 04.10.2026). */
const moveFile = FILES.map(f => ({ name: f.name, code: blank(f.text) })).find(f =>
  /(^|\n)const MOVE = \{/.test(f.code),
);
const moveDecl = moveFile
  ? moveFile.code.match(/MOVE\s*=\s*\{([\s\S]*?)\}/)
  : null;
const declaredMove = new Set(
  (moveDecl ? moveDecl[1].match(/[A-Z_]+\s*:/g) || [] : []).map(s =>
    s.replace(/\s*:$/, ""),
  ),
);

const reuseLiterals = [];
const reuseUnknown = [];
const missingReuse = [];
let reuseSites = 0;
let moveCalls = 0;

for (const f of FILES) {
  const src = blank(f.text);

  const reuseRe = /reusePath\s*:\s*([\w$.]+)/g;
  let m;
  while ((m = reuseRe.exec(src))) {
    reuseSites++;
    const value = m[1];
    const where = `${f.name}:${lineOf(src, m.index)}`;
    if (!/^MOVE\.[A-Z_]+$/.test(value)) reuseLiterals.push(`${where} (${value})`);
    else if (!declaredMove.has(value.slice(5))) {
      reuseUnknown.push(`${where} (${value})`);
    }
  }

  const moveRe = /\.moveTo\s*\(/g;
  while ((m = moveRe.exec(src))) {
    moveCalls++;
    const args = callArgs(src, moveRe.lastIndex - 1);
    if (!/reusePath\s*:/.test(args)) missingReuse.push(`${f.name}:${lineOf(src, m.index)}`);
  }
}

check(
  `политика MOVE объявлена в ${moveFile ? moveFile.name : "constants"}`,
  declaredMove.size >= 4,
  [...declaredMove].join(","),
);
check(
  // Порог опущен до 0 после порта Traveler (04.10.2026): вызовов creep.moveTo
  // в рантайме не осталось, движение ведёт creep.travelTo, и reusePath в нём не
  // применяется. Проверки ниже остаются в силе для любого вызова moveTo, который
  // появится снова: значение обязано быть из MOVE.*, не числовым литералом и
  // задаваться явно. Инвариант самого порта держит tests/role.micro.test.js
  // («вызовов creep.moveTo в рантайме не осталось»).
  "reusePath-опций найдено (защита от ложной зелени)",
  reuseSites >= 0,
  String(reuseSites),
);
check("нет литеральных reusePath", reuseLiterals.length === 0, reuseLiterals.join(", "));
check("reusePath берётся только из MOVE.*", reuseUnknown.length === 0, reuseUnknown.join(", "));
check(
  "moveTo-вызовов найдено (защита от ложной зелени)",
  moveCalls >= 0,
  String(moveCalls),
);
check("каждый moveTo задаёт reusePath", missingReuse.length === 0, missingReuse.join(", "));

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
