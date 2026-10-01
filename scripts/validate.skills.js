"use strict";
/**
 * ===================================================
 * SCRIPTS/VALIDATE.SKILLS.JS — механическая проверка скиллов DSH
 * ===================================================
 * Назначение: убедиться, что каждый скилл в .dsh/skills/<name>/SKILL.md
 * корректен и будет принят провайдером скиллов DSH, а не молча им отброшен.
 *
 * Провайдер (проверено чтением чекаута DSH):
 *   - каталог проекта:   .dsh/skills   (@deepseek-ai/dsh-skill-filesystem)
 *   - формат:            каталог <name>/ + файл SKILL.md
 *   - YAML frontmatter:  первая строка ровно "---", закрывающая строка "---"
 *   - обязательные поля: name, description (непустые строки)
 *   - whenToUse:         необязательное, но если есть — непустая строка
 *   - шаблон имени:      /^[a-z0-9]+(?:-[a-z0-9]+)*$/
 *   - устаревшие поля disableModelInvocation / modelInvocable / userInvocable
 *     заставляют провайдера ОТБРОСИТЬ файл целиком (см. parseInvocationPolicy).
 *
 * Frontmatter разбирается НАСТОЯЩИМ YAML-парсером (js-yaml), а не регулярками:
 * незакавыченное значение с «: » внутри (например
 * `description: см. tests/*.test.js: что проверяется`) — это не YAML, и
 * провайдер молча выбрасывает такой скилл из каталога сессии. Ровно этот
 * дефект и был у screeps-architecture-testing: файл 15 минут не появлялся
 * в каталоге, пока description не закавычили.
 *
 * Проверки (ошибка = код возврата 1, предупреждение на код не влияет):
 *   1. frontmatter: первая строка "---", закрывающий "---" найден;
 *   2. YAML frontmatter валиден (js-yaml) и является объектом;
 *   3. name и description непустые; whenToUse, если есть, непустой;
 *   4. name === имя каталога и совпадает с /^[a-z0-9][a-z0-9-]*$/
 *      (дополнительно — строгий шаблон DSH);
 *   5. description: < 20 символов — ошибка, > 400 — предупреждение;
 *   6. «: » в незакавыченном description/whenToUse — предупреждение (см. выше);
 *   7. тело непустое, меньше 40 непустых строк — предупреждение;
 *   8. секция "## Источники" — предупреждение, если её нет;
 *   9. каждый блок ```js синтаксически валиден (new Function в try/catch);
 *  10. нет дублей name между каталогами; посторонние файлы в каталоге скилла —
 *      предупреждение;
 *  11. отчёт: сколько скиллов проверено, ошибки, предупреждения, код возврата.
 *
 * Зависимость: js-yaml (уже есть в node_modules проекта; иначе берётся из
 * ~/.dsh/profiles/node_modules/js-yaml; иначе — явная ошибка «нет js-yaml»).
 * Запуск: node scripts/validate.skills.js
 * ===================================================
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SKILLS_DIR = path.join(ROOT, ".dsh", "skills");
const SKILL_FILE = "SKILL.md";

/** Поля, без которых провайдер отбросит скилл. */
const REQUIRED_FIELDS = ["name", "description"];

/** Поля, в которых «: » в незакавыченном значении ломает YAML. */
const FRAGILE_FIELDS = ["description", "whenToUse"];

/** Шаблон имени из правил проекта. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Строгий шаблон провайдера DSH (@deepseek-ai/dsh-skill): без "--" и хвостового "-". */
const DSH_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Устаревшие поля frontmatter: с ними провайдер игнорирует файл. */
const LEGACY_FIELDS = {
  disableModelInvocation: "disable-model-invocation",
  modelInvocable: "disable-model-invocation",
  userInvocable: "user-invocable",
};

const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 400;
const BODY_MIN_LINES = 40;
const SOURCES_HEADING = "## Источники";

const errors = [];
const warnings = [];

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

/** Строка отчёта по одной проверке: OK / WARN / FAIL. */
function line(status, label) {
  if (status === "OK") console.log(`  OK    ${label}`);
  else if (status === "WARN") console.log(`  WARN  ${label}`);
  else console.log(`  FAIL  ${label}`);
}

/** Тип элемента каталога (учитывает симлинки): "dir" | "file" | "other". */
function kindOf(fullPath) {
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch (error) {
    return "other";
  }
  if (stat.isDirectory()) return "dir";
  if (stat.isFile()) return "file";
  return "other";
}

/**
 * Загружает js-yaml: сначала из зависимостей проекта, затем из профиля DSH.
 * Отсутствие парсера — явная ошибка, а не тихая подмена регулярками.
 * @returns {{parse: function(string): *, version: string, from: string}}
 */
function loadYaml() {
  const candidates = [
    "js-yaml",
    path.join(os.homedir(), ".dsh", "profiles", "node_modules", "js-yaml"),
  ];

  for (const candidate of candidates) {
    let yaml;
    try {
      yaml = require(candidate);
    } catch (error) {
      continue;
    }

    let version = "?";
    try {
      version = require(path.join(
        path.dirname(require.resolve(candidate)),
        "package.json",
      )).version;
    } catch (error) {
      /* версия не критична */
    }

    // js-yaml 3.x: безопасный разбор — safeLoad. В 4.x safeLoad оставлен
    // заглушкой, которая БРОСАЕТ исключение при вызове, поэтому проверяем
    // не typeof, а пробным разбором: "a: 1" — валидный YAML.
    const probe = "a: 1";
    for (const name of ["safeLoad", "load"]) {
      const fn = yaml[name];
      if (typeof fn !== "function") continue;
      try {
        fn(probe);
        return { parse: fn, version, from: candidate };
      } catch (error) {
        /* этот вариант в данной версии недоступен — пробуем следующий */
      }
    }
  }

  console.log("Ошибка: не найден модуль js-yaml — разобрать YAML frontmatter нечем.");
  console.log(`Искали: ${candidates.join(", ")}`);
  console.log("Код возврата: 1");
  process.exit(1);
}

const YAML = loadYaml();

/**
 * Разбирает YAML frontmatter.
 * @param {string} text строки frontmatter без обрамляющих "---"
 * @param {number} startLine номер первой строки frontmatter в файле (1-based)
 * @returns {{ok: boolean, data: Object|null, error: string|null}}
 */
function parseFrontmatter(text, startLine) {
  let data;
  try {
    data = YAML.parse(text);
  } catch (error) {
    const mark = error && error.mark ? error.mark : null;
    const where = mark ? `:${startLine + mark.line}` : "";
    const reason = error && error.reason ? error.reason : String(error);
    return {
      ok: false,
      data: null,
      error: `невалидный YAML frontmatter${where} — ${reason}`,
    };
  }

  if (data === null || data === undefined) {
    return { ok: false, data: null, error: "frontmatter пуст (YAML вернул null)" };
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      data: null,
      error: "frontmatter должен быть YAML-объектом (пары ключ: значение)",
    };
  }

  return { ok: true, data, error: null };
}

/**
 * Номера строк верхнеуровневых ключей frontmatter в файле.
 * @param {string[]} lines строки frontmatter
 * @param {number} startLine номер первой строки в файле (1-based)
 * @returns {Object<string, number>}
 */
function fieldLinesOf(lines, startLine) {
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_-]+)\s*:/.exec(lines[i]);
    if (match && out[match[1]] === undefined) out[match[1]] = startLine + i;
  }
  return out;
}

/**
 * «: » в незакавыченном значении description/whenToUse — предупреждение.
 * Проверяется сырой текст строки: кавычки и блочные индикаторы (| >) безопасны.
 * @param {string[]} lines строки frontmatter
 * @param {number} startLine номер первой строки в файле (1-based)
 * @param {string} where путь файла для сообщения
 */
function checkFragileColon(lines, startLine, where) {
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_-]+)\s*:(.*)$/.exec(lines[i]);
    if (!match || FRAGILE_FIELDS.indexOf(match[1]) < 0) continue;

    const value = match[2].trim();
    if (value === "") continue;
    if (/^["'|>]/.test(value)) continue;
    if (value.indexOf(": ") < 0) continue;

    addWarning(
      `${where}:${startLine + i} — в незакавыченном "${match[1]}" есть ": ": ` +
        "YAML считает это отображением и провайдер отбросит скилл; " +
        "закавычьте значение целиком",
    );
    line("WARN", `"${match[1]}": ": " в незакавыченном значении (строка ${startLine + i})`);
  }
}

/**
 * Проверяет все блоки ```js в теле через new Function.
 * @param {string} where относительный путь файла для сообщения
 * @param {string[]} bodyLines строки тела
 * @param {number} bodyStartLine номер первой строки тела в файле (1-based)
 * @returns {{total: number, unclosed: number}} total — сколько блоков ```js найдено
 */
function checkCodeBlocks(where, bodyLines, bodyStartLine) {
  const blocks = [];
  let open = null;
  let unclosed = 0;
  let total = 0;

  for (let i = 0; i < bodyLines.length; i++) {
    const match = /^\s*`{3,}\s*([^\s`]*)\s*$/.exec(bodyLines[i]);

    if (!match) {
      if (open) open.code.push(bodyLines[i]);
      continue;
    }

    if (open === null) {
      open = {
        lang: (match[1] || "").toLowerCase(),
        startLine: bodyStartLine + i,
        code: [],
      };
      continue;
    }

    if (open.lang === "js" || open.lang === "javascript") {
      total++;
      const code = open.code.join("\n");
      try {
        // Только синтаксис: тело функции, поэтому top-level return допустим.
        new Function(code);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        addError(
          `${where}:${open.startLine} — блок \`\`\`${open.lang} не компилируется: ${message}`,
        );
      }
    }

    open = null;
  }

  if (open !== null) {
    unclosed++;
    addError(`${where}:${open.startLine} — незакрытый блок кода (нет строки \`\`\`)`);
  }

  return { total, unclosed };
}

/** Проверяет один каталог скилла. Возвращает объявленное имя или undefined. */
function validateSkill(dirName, dirPath) {
  const rel = path.posix.join(".dsh", "skills", dirName);
  const skillPath = path.join(dirPath, SKILL_FILE);
  const where = `${rel}/${SKILL_FILE}`;

  console.log(`\n=== СКИЛЛ: ${dirName} ===`);

  let entries = [];
  try {
    entries = fs.readdirSync(dirPath).sort();
  } catch (error) {
    addError(`${rel} — каталог не читается: ${error.message}`);
    line("FAIL", "каталог не читается");
    return undefined;
  }

  const extra = entries.filter(name => name !== SKILL_FILE);
  if (extra.length > 0) {
    addWarning(`${rel} — посторонние файлы в каталоге скилла: ${extra.join(", ")}`);
    line("WARN", `посторонние файлы: ${extra.join(", ")}`);
  } else {
    line("OK", "посторонних файлов нет");
  }

  if (!entries.includes(SKILL_FILE)) {
    addError(`${rel} — ${SKILL_FILE} не найден`);
    line("FAIL", `${SKILL_FILE} не найден`);
    return undefined;
  }

  let raw;
  try {
    raw = fs.readFileSync(skillPath, "utf8");
  } catch (error) {
    addError(`${where} — файл не читается: ${error.message}`);
    line("FAIL", "файл не читается");
    return undefined;
  }

  const allLines = raw.split(/\r?\n/);

  // ── 1. Рамки frontmatter ───────────────────────────────────────────────
  if (allLines.length === 0 || allLines[0].replace(/\r$/, "") !== "---") {
    addError(`${where}:1 — первая строка должна быть ровно "---" (frontmatter отсутствует)`);
    line("FAIL", "frontmatter: первая строка не ---");
    return undefined;
  }

  let closeIndex = -1;
  for (let i = 1; i < allLines.length; i++) {
    if (allLines[i].replace(/\r$/, "") === "---") {
      closeIndex = i;
      break;
    }
  }

  if (closeIndex < 0) {
    addError(`${where} — закрывающий "---" не найден`);
    line("FAIL", "frontmatter: нет закрывающего ---");
    return undefined;
  }

  const fmLines = allLines.slice(1, closeIndex);
  const fmText = fmLines.join("\n");
  const fmStart = 2;
  line("OK", `frontmatter: строки 1-${closeIndex + 1}`);

  // ── 2. Хрупкое «: » в сыром тексте (до разбора — это причина падения) ──
  checkFragileColon(fmLines, fmStart, where);

  // ── 3. YAML-разбор ─────────────────────────────────────────────────────
  const parsed = parseFrontmatter(fmText, fmStart);
  const fieldLines = fieldLinesOf(fmLines, fmStart);
  let fields = null;

  if (!parsed.ok) {
    addError(`${where} — ${parsed.error}`);
    line("FAIL", `frontmatter: ${parsed.error}`);
  } else {
    fields = parsed.data;
    line("OK", `YAML frontmatter разобран (js-yaml ${YAML.version})`);
  }

  if (fields !== null) {
    // ── 4. Обязательные поля ─────────────────────────────────────────────
    for (const field of REQUIRED_FIELDS) {
      const value = fields[field];
      const at = fieldLines[field] === undefined ? "" : `:${fieldLines[field]}`;
      if (typeof value !== "string" || value === "") {
        addError(
          `${where}${at} — обязательное поле "${field}" отсутствует, пустое или не строка`,
        );
        line("FAIL", `поле "${field}" отсутствует или пустое`);
        continue;
      }
      line("OK", `поле "${field}": ${value.length} символов`);
    }

    if (Object.prototype.hasOwnProperty.call(fields, "whenToUse")) {
      const at = fieldLines.whenToUse === undefined ? "" : `:${fieldLines.whenToUse}`;
      if (typeof fields.whenToUse !== "string" || fields.whenToUse === "") {
        addError(`${where}${at} — поле "whenToUse" присутствует, но пустое или не строка`);
        line("FAIL", 'поле "whenToUse" пустое или не строка');
      } else {
        line("OK", `поле "whenToUse": ${fields.whenToUse.length} символов`);
      }
    }

    for (const legacy of Object.keys(LEGACY_FIELDS)) {
      if (Object.prototype.hasOwnProperty.call(fields, legacy)) {
        const at = fieldLines[legacy] === undefined ? "" : `:${fieldLines[legacy]}`;
        addError(
          `${where}${at} — устаревшее поле "${legacy}": провайдер DSH отбросит скилл, ` +
            `используйте "${LEGACY_FIELDS[legacy]}"`,
        );
        line("FAIL", `устаревшее поле "${legacy}"`);
      }
    }

    // ── 5. Имя: совпадает с каталогом и с шаблоном ───────────────────────
    const name = fields.name;
    if (typeof name === "string" && name !== "") {
      if (name !== dirName) {
        addError(
          `${where}:${fieldLines.name} — name "${name}" не совпадает с каталогом "${dirName}"`,
        );
        line("FAIL", `name "${name}" != каталог "${dirName}"`);
      } else {
        line("OK", `name = "${name}" (совпадает с каталогом)`);
      }

      if (!NAME_PATTERN.test(name)) {
        addError(
          `${where}:${fieldLines.name} — name "${name}" не соответствует /^[a-z0-9][a-z0-9-]*$/`,
        );
        line("FAIL", "name не соответствует /^[a-z0-9][a-z0-9-]*$/");
      } else if (!DSH_NAME_PATTERN.test(name)) {
        addError(
          `${where}:${fieldLines.name} — name "${name}" нарушает строгий шаблон DSH ` +
            `/^[a-z0-9]+(?:-[a-z0-9]+)*$/ (нет "--" и хвостового "-")`,
        );
        line("FAIL", "name нарушает строгий шаблон DSH");
      } else {
        line("OK", "name соответствует шаблону DSH");
      }
    }

    // ── 6. Длина description ─────────────────────────────────────────────
    const description = fields.description;
    if (typeof description === "string" && description !== "") {
      if (description.length < DESCRIPTION_MIN) {
        addError(
          `${where}:${fieldLines.description} — description короче ${DESCRIPTION_MIN} символов (${description.length})`,
        );
        line("FAIL", `description: ${description.length} символов (< ${DESCRIPTION_MIN})`);
      } else if (description.length > DESCRIPTION_MAX) {
        addWarning(
          `${where}:${fieldLines.description} — description длиннее ${DESCRIPTION_MAX} символов (${description.length})`,
        );
        line("WARN", `description: ${description.length} символов (> ${DESCRIPTION_MAX})`);
      } else {
        line("OK", `description: ${description.length} символов`);
      }
    }
  }

  // ── 7. Тело ────────────────────────────────────────────────────────────
  const bodyLines = allLines.slice(closeIndex + 1);
  const bodyStartLine = closeIndex + 2;
  const bodyCount = bodyLines.filter(text => text.trim() !== "").length;
  // Строк всего — без «фантомной» последней строки от завершающего \n.
  const bodyTotal =
    bodyLines.length - (bodyLines[bodyLines.length - 1] === "" ? 1 : 0);

  if (bodyCount === 0) {
    addError(`${where} — тело скилла пустое`);
    line("FAIL", "тело пустое");
  } else if (bodyCount < BODY_MIN_LINES) {
    addWarning(
      `${where} — тело короче ${BODY_MIN_LINES} непустых строк: ${bodyCount} ` +
        `непустых из ${bodyTotal} строк`,
    );
    line("WARN", `тело: ${bodyCount} непустых строк (< ${BODY_MIN_LINES})`);
  } else {
    line("OK", `тело: ${bodyCount} непустых строк`);
  }

  // ── 8. Секция источников ───────────────────────────────────────────────
  const hasSources = bodyLines.some(
    text => text.trim().replace(/\s+$/, "") === SOURCES_HEADING,
  );
  if (!hasSources) {
    addWarning(`${where} — нет секции "${SOURCES_HEADING}"`);
    line("WARN", `секции "${SOURCES_HEADING}" нет`);
  } else {
    line("OK", `секция "${SOURCES_HEADING}"`);
  }

  // ── 9. Блоки ```js ─────────────────────────────────────────────────────
  const before = errors.length;
  checkCodeBlocks(where, bodyLines, bodyStartLine);
  const blockErrors = errors.length - before;

  if (blockErrors === 0) {
    line("OK", "все блоки кода синтаксически валидны");
  } else {
    line("FAIL", `блоков кода с ошибками: ${blockErrors}`);
  }

  if (fields === null) return undefined;
  return typeof fields.name === "string" && fields.name !== ""
    ? fields.name
    : undefined;
}

function main() {
  console.log("===================================================");
  console.log("VALIDATE.SKILLS.JS — проверка скиллов в .dsh/skills");
  console.log("===================================================");
  console.log(`Каталог: ${SKILLS_DIR}`);
  console.log(`YAML-парсер: js-yaml ${YAML.version} (${YAML.from})`);

  if (!fs.existsSync(SKILLS_DIR) || kindOf(SKILLS_DIR) !== "dir") {
    console.log(`\nОшибка: каталог скиллов не найден: ${SKILLS_DIR}`);
    console.log("Код возврата: 1");
    process.exit(1);
  }

  const entries = fs.readdirSync(SKILLS_DIR).sort();
  const dirs = entries.filter(name => kindOf(path.join(SKILLS_DIR, name)) === "dir");
  const strayFiles = entries.filter(name => dirs.indexOf(name) < 0);

  console.log(`Каталогов в .dsh/skills: ${entries.length}, из них скиллов: ${dirs.length}`);

  for (const name of strayFiles) {
    addWarning(`.dsh/skills/${name} — не каталог скилла (скилл — это каталог с ${SKILL_FILE})`);
  }

  const declared = {};
  let checked = 0;

  for (const dirName of dirs) {
    // Считаем КАЖДЫЙ каталог: даже упавший на frontmatter — уже проверенный.
    checked++;
    const name = validateSkill(dirName, path.join(SKILLS_DIR, dirName));
    if (name === undefined) continue;
    if (declared[name] === undefined) declared[name] = [];
    declared[name].push(dirName);
  }

  for (const name of Object.keys(declared)) {
    if (declared[name].length > 1) {
      addError(`дубль name "${name}" в каталогах: ${declared[name].join(", ")}`);
    }
  }

  console.log("\n===================================================");
  console.log("ИТОГ");
  console.log("===================================================");
  console.log(`Скиллов проверено: ${checked}`);

  if (errors.length > 0) {
    console.log(`\n=== ОШИБКИ (${errors.length}) ===`);
    for (let i = 0; i < errors.length; i++) {
      console.log(`  ${i + 1}. ${errors[i]}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n=== ПРЕДУПРЕЖДЕНИЯ (${warnings.length}) ===`);
    for (let i = 0; i < warnings.length; i++) {
      console.log(`  ${i + 1}. ${warnings[i]}`);
    }
  }

  console.log(
    `\nОшибок: ${errors.length} | Предупреждений: ${warnings.length} | ` +
      `Проверено скиллов: ${checked}`,
  );

  if (errors.length === 0) {
    console.log("Скиллы корректны: провайдер DSH примет их.");
    process.exit(0);
  }

  console.log("Есть ошибки: такие скиллы провайдер DSH проигнорирует.");
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.log(
    "КРИТИЧЕСКАЯ ОШИБКА:",
    error && error.stack ? error.stack : String(error),
  );
  process.exit(1);
}
