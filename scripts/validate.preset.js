"use strict";
/**
 * ===================================================
 * SCRIPTS/VALIDATE.PRESET.JS — механическая проверка agent preset
 * ===================================================
 * Проверяет, что пресет .dsh/preset/screeps-dev будет принят DSH:
 *   - preset.yml разбирается и несёт непустые name/description;
 *   - agent.cordis.yml разбирается как список строк со своими id/name;
 *   - id строк уникальны;
 *   - каждый модуль @deepseek-ai/... реально установлен в этом деплое DSH;
 *   - обязательные поля config на месте (persona.prefix, plan-mode.section,
 *     tool-subagent.provider/toolName, tool-ralph.subagentProvider);
 *   - имена скиллов, перечисленные в персоне, существуют в .dsh/skills.
 *
 * Каждое правило взято из кода пакета, а не придумано: например, plan-mode
 * бросает "PlanModeConfig needs a string `section`"
 * (node_modules/@deepseek-ai/dsh-plan-mode/lib/index.js), persona объявляет
 * `prefix: z.string().required()` (.../dsh-persona/lib/index.js).
 *
 * Запуск:
 *   node scripts/validate.preset.js
 *   DSH_NODE_MODULES=<path> node scripts/validate.preset.js
 *
 * Код возврата: 0 — ошибок нет (предупреждения допустимы), 1 — есть ошибки.
 * ===================================================
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PRESET_DIR = path.join(PROJECT_ROOT, ".dsh", "preset", "screeps-dev");
const SKILLS_DIR = path.join(PROJECT_ROOT, ".dsh", "skills");
const METADATA_FILE = "preset.yml";
const COMPOSITION_FILE = "agent.cordis.yml";

/** Обязательные поля config для строк, у которых они реально обязательны. */
const REQUIRED_CONFIG = {
  "@deepseek-ai/dsh-persona": ["prefix"],
  "@deepseek-ai/dsh-plan-mode": ["section"],
  "@deepseek-ai/dsh-tool-subagent": ["provider", "toolName"],
  "@deepseek-ai/dsh-tool-ralph": ["subagentProvider"],
  "@deepseek-ai/dsh-mcp-client": ["serverName", "transport"]
};

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

/** Первый существующий путь из списка. */
function firstExisting(paths) {
  for (const candidate of paths) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Каталог node_modules деплоя DSH: нужен, чтобы проверить наличие плагинов. */
function findDshNodeModules() {
  const npx = path.join(os.homedir(), ".npm", "_npx");
  const npxCandidates = [];
  try {
    for (const entry of fs.readdirSync(npx)) {
      npxCandidates.push(path.join(npx, entry, "node_modules"));
    }
  } catch {
    /* каталога npx может не быть */
  }
  const found = firstExisting([
    process.env.DSH_NODE_MODULES,
    path.join(os.homedir(), ".dsh", "profiles", "node_modules"),
    ...npxCandidates
  ].filter(Boolean).filter(p => fs.existsSync(path.join(p, "@deepseek-ai", "dsh-agent-presets"))));
  return found;
}

/** js-yaml: свой в проекте, иначе — из деплоя DSH. */
function loadYaml(dshNodeModules) {
  const candidates = ["js-yaml"];
  if (dshNodeModules) candidates.push(path.join(dshNodeModules, "js-yaml"));
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* пробуем следующий */
    }
  }
  return null;
}

/** Пакет установлен? Подпуть (@scope/pkg/sub) проверяем по exports пакета. */
function checkModule(name, where) {
  const parts = name.split("/");
  const packageName = name.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const subpath = name.slice(packageName.length + 1);
  const packageDir = path.join(dshNodeModules, packageName);
  if (!fs.existsSync(packageDir)) {
    fail(`${where}: модуль ${packageName} не найден в ${dshNodeModules}`);
    return;
  }
  if (subpath === "") return;
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
  } catch {
    /* без манифеста проверим только файловую систему */
  }
  const exports = manifest.exports;
  if (exports && typeof exports === "object" && Object.prototype.hasOwnProperty.call(exports, `./${subpath}`)) return;
  if (fs.existsSync(path.join(packageDir, subpath))) return;
  fail(`${where}: подпуть ${name} не объявлен в exports пакета ${packageName}`);
}

const dshNodeModules = findDshNodeModules();

/**
 * Установленная копия в ~/.dsh/.agent-presets не должна расходиться с
 * репозиторием: DSH читает именно её, а не .dsh/preset в репозитории.
 */
function checkInstalledCopy() {
  const installedDir = path.join(os.homedir(), ".dsh", ".agent-presets", "screeps-dev");
  if (!fs.existsSync(installedDir)) {
    warn(`пресет не установлен в ${installedDir} — сессии его не увидят (см. .dsh/README.md)`);
    return;
  }
  let stale = 0;
  for (const name of fs.readdirSync(PRESET_DIR)) {
    const source = path.join(PRESET_DIR, name);
    const target = path.join(installedDir, name);
    if (!fs.statSync(source).isFile()) continue;
    if (!fs.existsSync(target) || fs.readFileSync(source, "utf8") !== fs.readFileSync(target, "utf8")) {
      warn(`установленная копия устарела: ${name} (переустанови пресет, команда в .dsh/README.md)`);
      stale += 1;
    }
  }
  if (stale === 0) console.log(`УСТАНОВЛЕННАЯ КОПИЯ: ${installedDir} — совпадает с репозиторием`);
}

/** Скиллы, которые персона обещает агенту. */
function checkPersonaSkills(personaPrefix) {  if (!fs.existsSync(SKILLS_DIR)) {
    warn(`каталог скиллов ${path.relative(PROJECT_ROOT, SKILLS_DIR)} не найден`);
    return;
  }
  const present = new Set(
    fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, entry.name, "SKILL.md")))
      .map(entry => entry.name)
  );
  if (personaPrefix === "") return;
  const mentioned = new Set(personaPrefix.match(/screeps-[a-z0-9-]+/g) || []);
  for (const name of mentioned) {
    if (!present.has(name)) fail(`персона ссылается на скилл ${name}, но ${path.join(".dsh/skills", name, "SKILL.md")} нет`);
  }
  for (const name of present) {
    if (!mentioned.has(name)) warn(`скилл ${name} не перечислен в персоне — агент может про него не узнать`);
  }
}

console.log("ПРЕСЕТ:", path.relative(PROJECT_ROOT, PRESET_DIR));
console.log("DSH node_modules:", dshNodeModules || "НЕ НАЙДЕН");

if (!dshNodeModules) {
  fail("не найден каталог node_modules деплоя DSH (задай DSH_NODE_MODULES=...)");
}

const yaml = dshNodeModules ? loadYaml(dshNodeModules) : null;
if (!yaml) fail("не найден js-yaml (нужен для разбора YAML)");

if (yaml) {
  // ── preset.yml ────────────────────────────────────────────────────────────
  const metadataPath = path.join(PRESET_DIR, METADATA_FILE);
  let metadata = null;
  if (!fs.existsSync(metadataPath)) {
    fail(`нет файла ${METADATA_FILE}`);
  } else {
    try {
      metadata = yaml.load(fs.readFileSync(metadataPath, "utf8"));
    } catch (error) {
      fail(`${METADATA_FILE}: не разбирается (${error.message})`);
    }
    if (metadata && (typeof metadata !== "object" || Array.isArray(metadata))) {
      fail(`${METADATA_FILE}: ожидается объект с name/description`);
      metadata = null;
    }
    if (metadata) {
      if (typeof metadata.name !== "string" || metadata.name.trim() === "") fail(`${METADATA_FILE}: пустое name`);
      if (typeof metadata.description !== "string" || metadata.description.trim() === "") fail(`${METADATA_FILE}: пустое description`);
      if (metadata.order !== undefined && typeof metadata.order !== "number") warn(`${METADATA_FILE}: order не число, будет проигнорирован`);
      console.log(`ИМЯ: ${metadata.name}\nОПИСАНИЕ: ${metadata.description}`);
    }
  }

  // ── agent.cordis.yml ──────────────────────────────────────────────────────
  const compositionPath = path.join(PRESET_DIR, COMPOSITION_FILE);
  if (!fs.existsSync(compositionPath)) {
    fail(`нет файла ${COMPOSITION_FILE}`);
  } else {
    // js-yaml не знает тег !!js (его добавляет загрузчик Cordis): подменяем
    // выражение на литерал — валидатор проверяет структуру, а не вычисляет код.
    const raw = fs.readFileSync(compositionPath, "utf8").replace(/!!js\s+[^\n]+/g, "true");
    let rows = null;
    try {
      rows = yaml.load(raw);
    } catch (error) {
      fail(`${COMPOSITION_FILE}: не разбирается (${error.message})`);
    }
    if (rows !== null && !Array.isArray(rows)) {
      fail(`${COMPOSITION_FILE}: ожидается список строк плагинов`);
      rows = null;
    }
    const seen = new Set();
    let personaPrefix = "";
    const walk = (list, prefix) => {
      for (const row of list) {
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
          fail(`${prefix}: строка не является объектом`);
          continue;
        }
        const where = `${prefix}${row.id || "<без id>"}`;
        if (typeof row.id !== "string" || row.id === "") fail(`${where}: нет id`);
        else if (seen.has(where)) fail(`${where}: дубль id`);
        else seen.add(where);
        if (typeof row.name !== "string" || row.name === "") {
          fail(`${where}: нет name`);
          continue;
        }
        if (row.name.startsWith("@")) checkModule(row.name, where);
        else if (row.name !== "cordis:group") fail(`${where}: неизвестный name ${row.name}`);
        if (REQUIRED_CONFIG[row.name] && row.disabled !== true) {
          const config = row.config && !Array.isArray(row.config) ? row.config : {};
          for (const key of REQUIRED_CONFIG[row.name]) {
            const value = config[key];
            if (typeof value !== "string" || value.trim() === "") fail(`${where}: обязательное поле config.${key} пустое (${row.name})`);
          }
        }
        if (row.name === "@deepseek-ai/dsh-persona" && row.config && typeof row.config.prefix === "string") {
          personaPrefix = row.config.prefix;
        }
        if (Array.isArray(row.config)) walk(row.config, `${where}/`);
      }
    };
    if (rows) {
      walk(rows, "");
      console.log(`СТРОК: ${seen.size}`);
      checkPersonaSkills(personaPrefix);
    }
  }
}

// ── отчёт ───────────────────────────────────────────────────────────────────
checkInstalledCopy();
console.log("");
for (const message of warnings) console.log("ПРЕДУПРЕЖДЕНИЕ:", message);
for (const message of errors) console.log("ОШИБКА:", message);
console.log("");
if (errors.length > 0) {
  console.log(`ИТОГ: ошибок ${errors.length}, предупреждений ${warnings.length}`);
  process.exit(1);
}
console.log(`ИТОГ: пресет корректен, предупреждений ${warnings.length}`);
process.exit(0);
