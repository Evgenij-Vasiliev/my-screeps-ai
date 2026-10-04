"use strict";
/**
 * ===================================================
 * CITATIONS.TEST.JS — механическая проверка ссылок file:line
 * ===================================================
 * Зачем: правило проекта требует, чтобы каждое утверждение опиралось на
 * файл:строку, но сами ссылки никто не проверяет. Правка 03.10.2026 (удаление
 * пяти ролей) показала цену: 160 ссылок попали в зоны сдвига, а часть ссылок
 * указывала на уже удалённые файлы (role.upgrader.js:17,20 в
 * docs/task-system-v3.0/DEVELOPMENT_RULES.md и tests/rules.test.js,
 * creep.factory.js:220 в scripts/spawn.probe.js). Глазами это не ловится.
 *
 * Что проверяется (только механически проверяемое):
 *   1) файл, на который ссылаются, существует в репозитории, и НОМЕР СТРОКИ
 *      (а для диапазона — и его конец) не выходит за конец файла;
 *   2) ссылка не указывает на имя из реестра удалённых модулей
 *      (REMOVED_MODULES, см. ниже): такое имя не разрешается ни в какой файл,
 *      поэтому п.1 его не ловит.
 *
 * Чего тест НЕ делает и почему:
 *   - не проверяет, что на указанной строке лежит именно то, о чём говорит
 *     текст: в строке цитаты обычно несколько символов, часть — из прозы, и
 *     такая проверка даёт ложные срабатывания. «Ссылка верна по смыслу»
 *     остаётся делом человека, тест гарантирует только, что она НЕ битая;
 *   - не проверяет произвольные неразрешимые ссылки: по basename имя движка
 *     (`src/game/creeps.js`, `utils.js:623`) неотличимо от файла прошлой ветки
 *     (`constants/spawn.js`). Такие ссылки считаются внешними и печатаются
 *     числом — запрещать ссылки на движок нельзя.
 *
 * Два режима строгости. Верхнеуровневые `docs/*.md` — датированные отчёты и
 * планы (docs/CPU-BASELINE.md, docs/CPU-ROLES-ASSESSMENT.md, ...), их номера
 * строк отражают состояние репозитория на дату замера, и переписывать историю
 * задним числом нельзя. Для них нарушения печатаются как ПРЕДУПРЕЖДЕНИЯ и на
 * код возврата не влияют. Всё остальное — код, тесты, скрипты, AGENTS.md,
 * docs/task-system-v3.0/* и скиллы .dsh — проверяется СТРОГО.
 *
 * Запуск: node tests/citations.test.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

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

/* ── Индекс файлов репозитория ────────────────────────────────────────── */
/** @param {string} dir @param {string[]} out */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|md)$/.test(e.name)) out.push(path.relative(ROOT, p));
  }
  return out;
}

const repoFiles = walk(ROOT);

/**
 * Имя файла → пути. Basename НЕ уникален (SKILL.md есть у каждого из 9 скиллов,
 * и в docs/ есть одноимённые файлы), поэтому разрешение идёт по трём ступеням:
 *   1) путь как есть (в репозитории есть каталоги: docs/, scripts/, ...);
 *   2) относительно каталога цитирующего файла (SKILL.md:12 внутри скилла);
 *   3) basename — только если он один в репозитории.
 */
const byName = new Map();
for (const p of repoFiles) {
  const base = path.basename(p);
  if (!byName.has(base)) byName.set(base, []);
  byName.get(base).push(p);
}

/**
 * @param {string} name имя из ссылки
 * @param {string} fromFile файл, в котором стоит ссылка
 * @returns {string|null} путь относительно корня репозитория
 */
function resolveRef(name, fromFile) {
  if (fs.existsSync(path.join(ROOT, name))) return name;
  const near = path.join(path.dirname(fromFile), name);
  if (fs.existsSync(path.join(ROOT, near))) return near;
  const candidates = byName.get(path.basename(name));
  if (candidates && candidates.length === 1) {
    // Ссылка с каталогом впереди, которого в репозитории нет, — это ДРУГОЕ
    // дерево (исходники движка: src/game/creeps.js, lib/constants.js). По
    // basename она разрешается в нашего однофамильца (после разбиения
    // 04.10.2026 появился constants/creeps.js, а constants.js стал баррелем
    // на 64 строки) и даёт ложное «ссылка за конец файла». Поэтому каталог
    // ссылки обязан совпадать с каталогом найденного файла: не совпал —
    // ссылка внешняя, как и было, пока однофамильца в репозитории не было.
    const prefix = path.dirname(name);
    if (prefix !== "." && prefix !== path.dirname(candidates[0])) return null;
    return candidates[0];
  }
  return null;
}

/**
 * Файлы, которые тест читает как источники ссылок. Себя не читает: в тексте
 * этого файла есть примеры вида `file.js:N`, они не являются ссылками.
 */
const SELF = path.join("tests", "citations.test.js");
const sources = repoFiles.filter(p => {
  if (p === SELF) return false;
  if (/^AGENTS\.md$/.test(p)) return true;
  if (/^docs\//.test(p)) return true;
  if (/^\.dsh\/skills\//.test(p)) return true;
  if (/^tests\/[\w.]+\.js$/.test(p)) return true;
  if (/^scripts\/[\w.]+\.js$/.test(p)) return true;
  // task/*.js добавлен 04.10.2026 вместе с разбиением системы задач: ссылки
  // file:line переехали из корневых task.executors.js/task.generators.js в
  // подкаталог, и без этой строки страж перестал бы их видеть (корневая
  // маска /^[\w.]+\.js$/ подкаталоги не покрывает).
  if (/^task\/[\w.]+\.js$/.test(p)) return true;
  // room/*.js — тот же аргумент, что у task/*.js: каталог уезжает на шард
  // (SRC деплоя) и содержит ссылки file:line, а корневая маска /^[\w.]+\.js$/
  // подкаталоги не покрывает. Добавлено 04.10.2026 вместе с аудитом ссылок.
  if (/^room\/[\w.]+\.js$/.test(p)) return true;
  if (/^[\w.]+\.js$/.test(p)) return true;
  return false;
});

/**
 * Датированные отчёты и планы: их ссылки отражают состояние на дату замера.
 * Живые правила проекта (docs/task-system-v3.0/*) сюда НЕ попадают.
 */
function isHistorical(p) {
  return /^docs\//.test(p) && !/^docs\/task-system-v3\.0\//.test(p);
}

/* ── Реестр удалённых модулей ─────────────────────────────────────────── */
/**
 * Корневые модули, удалённые из репозитория. Ссылка на такое имя в любом
 * источнике — ошибка: файла нет, проверить строку невозможно, а читатель
 * уйдёт искать модуль, которого не существует (ровно это случилось 03.10.2026:
 * `role.upgrader.js:17,20` в DEVELOPMENT_RULES.md и tests/rules.test.js).
 *
 * Почему явный список, а не история git: по basename история неотличима от
 * ссылок на ИСХОДНИКИ ДВИЖКА (`src/game/creeps.js`, `utils.js:623`) и на файлы
 * прошлых веток (`constants/spawn.js`) — движок и прежние ветки в этот
 * репозиторий не входят, и запрещать ссылки на них нельзя. Список проверяется
 * на актуальность: каждое имя обязано отсутствовать файлом (иначе запись
 * устарела), и список не может быть пустым.
 */
const REMOVED_MODULES = [
  "task.types.js",
  "role.builder.js",
  "role.harvester.js",
  "role.repairer.js",
  "role.towerSupplier.js",
  "role.upgrader.js",
];

/* ── Разбор ссылок ────────────────────────────────────────────────────── */
const CITE = /\b([\w./-]+\.(?:js|json|md)):(\d+)(?:-(\d+))?/g;

/** @type {{where: string, cite: string, target: string, start: number, end: number}[]} */
const citations = [];
for (const rel of sources) {
  const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    CITE.lastIndex = 0;
    let m;
    while ((m = CITE.exec(lines[i]))) {
      const name = m[1];
      citations.push({
        where: `${rel}:${i + 1}`,
        cite: m[0],
        name,
        target: resolveRef(name, rel),
        start: +m[2],
        end: m[3] ? +m[3] : +m[2],
      });
    }
  }
}

const strictBad = [];
const warnBad = [];
const deletedRefs = [];
const hollowRefs = [];
let external = 0;
let strictOk = 0;

/**
 * Цель ссылки — живая строка, а не пустота. Проверка «строка внутри файла»
 * (ниже) этого не ловит: ссылка на пустую строку или на одни закрывающие
 * скобки формально внутри файла, а по сути ни на что не указывает.
 *
 * Зачем отдельная проверка. Аудит 04.10.2026 нашёл в репозитории ссылки,
 * которые годами оставались «зелёными», потому что попадали в диапазон:
 * `task.executors.js:165-167` вела на комментарий про Traveler вместо фаз
 * `creep.memory.working`, `worker.runner.js:308` — на `let best = -1;` вместо
 * `taskId = null`, `empire.js:12` — на пустую строку вместо `startTick()`.
 * Полную семантику («строка говорит то, что утверждает текст») механически
 * проверить нельзя, но пустоту и скобки — можно, и это отсекает самый грубый
 * класс сдвигов.
 *
 * @param {{target: string|null, start: number, end: number}} c
 * @returns {string} "" если цель живая, иначе причина
 */
const targetCache = new Map();
function hollowReason(c) {
  if (!c.target) return "";
  let lines = targetCache.get(c.target);
  if (!lines) {
    lines = fs.readFileSync(path.join(ROOT, c.target), "utf8").split("\n");
    targetCache.set(c.target, lines);
  }
  const slice = lines.slice(c.start - 1, Math.min(c.end, lines.length));
  const nonEmpty = slice.map(s => s.trim()).filter(s => s !== "");
  if (nonEmpty.length === 0) return "цель — пустые строки";
  if (nonEmpty.every(s => /^[}\])]*;?$/.test(s) || s === "*/")) {
    return "цель — только закрывающие скобки";
  }
  return "";
}

for (const c of citations) {
  const historical = isHistorical(c.where.split(":")[0]);

  if (c.target) {
    const total = fs.readFileSync(path.join(ROOT, c.target), "utf8").split("\n").length;
    if (c.start > total || c.end > total) {
      const msg = `${c.where} → ${c.cite} (в ${c.target} строк ${total})`;
      (historical ? warnBad : strictBad).push(msg);
    } else {
      const hollow = hollowReason(c);
      if (hollow) {
        const msg = `${c.where} → ${c.cite} (${hollow})`;
        (historical ? warnBad : hollowRefs).push(msg);
      } else {
        strictOk++;
      }
    }
    continue;
  }

  // Имя не разрешилось: движок (src/*, ENG-*), файл прошлой ветки или
  // опечатка. Отличать их механически нельзя — считаем и печатаем, а строго
  // ловится только явный реестр удалённых модулей (REMOVED_MODULES).
  if (REMOVED_MODULES.includes(path.basename(c.name))) {
    const msg = `${c.where} → ${c.cite} (модуль удалён из репозитория)`;
    (historical ? warnBad : deletedRefs).push(msg);
    continue;
  }

  external++;
}

/* ── Защита от ложной зелени ──────────────────────────────────────────── */
console.log("1. Разбор ссылок");
check("источников просмотрено", sources.length > 40, String(sources.length));
check("ссылок file:line найдено", citations.length > 500, String(citations.length));
check("ссылок внутри репозитория", strictOk > 300, String(strictOk));
check(
  "ссылки разрешаются (basename без каталога не ломает разбор)",
  citations.filter(c => c.target).length > 300,
  String(citations.filter(c => c.target).length),
);
check(
  "исторические docs/*.md распознаются (иначе строгий режим vacuus)",
  sources.some(isHistorical) && sources.some(p => !isHistorical(p)),
);
check(
  "реестр удалённых модулей заполнен и не устарел",
  REMOVED_MODULES.length > 0 &&
    REMOVED_MODULES.every(n => !fs.existsSync(path.join(ROOT, n))),
  REMOVED_MODULES.filter(n => fs.existsSync(path.join(ROOT, n))).join(", ") ||
    "список пуст",
);

console.log("\n2. Строгий режим: код, тесты, скрипты, скиллы, AGENTS.md, живые правила");
check("нет ссылок за конец файла", strictBad.length === 0, strictBad.join(" | "));
check(
  "нет ссылок на пустые строки и одни скобки",
  hollowRefs.length === 0,
  hollowRefs.join(" | "),
);
check(
  "нет ссылок на удалённые модули репозитория",
  deletedRefs.length === 0,
  deletedRefs.join(" | "),
);

console.log("\n3. Предупреждения: датированные отчёты docs/*.md (на код возврата не влияют)");
if (warnBad.length === 0) {
  console.log("  предупреждений нет");
} else {
  console.log(`  устаревших ссылок в исторических отчётах: ${warnBad.length}`);
  for (const w of warnBad.slice(0, 10)) console.log(`    ${w}`);
  if (warnBad.length > 10) console.log(`    ... и ещё ${warnBad.length - 10}`);
}

console.log(
  `\nВсего ссылок: ${citations.length} (внешних — движок/докуменация: ${external}, ` +
    `проверено в репозитории: ${strictOk})`,
);
console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
