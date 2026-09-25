/**
 * Проверка preset `screeps-chief-architect` родным загрузчиком DSH.
 *
 * Health-вердикт берётся из @deepseek-ai/dsh-agent-presets/discovery — это тот же
 * код, который читает пикер пресетов и отказывает сломанному пресету до старта
 * сессии. Дополнительно конфиг каждой строки subagent_* разбирается схемой
 * @deepseek-ai/dsh-tool-subagent (Config), чтобы проверка не была текстовой.
 *
 * Скрипт ничего не меняет: только читает файлы.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const PROFILE_ROOT = join(DSH_HOME, 'profiles');
const PRESET_DIR = join(DSH_HOME, '.agent-presets', 'screeps-chief-architect');
const COMPOSITION = join(PRESET_DIR, 'agent.cordis.yml');
const PRESET_ID = 'screeps-chief-architect';
const TARGETS = ['subagent_cpu', 'subagent_defense', 'subagent_economy', 'subagent_logistics'];
const ALLOWED = new Set(['read', 'glob', 'grep']);
const FORBIDDEN = ['edit', 'write', 'bash', 'pwsh', 'subagent', 'subagent_fork', 'workflow', 'ralph', 'todo_write', 'ask_user_question', 'present', 'read_image', 'skill', 'web_search', 'web_fetch'];

const importFrom = (pkg) => import(pathToFileURL(join(PROFILE_ROOT, 'node_modules', pkg)).href);

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
};

// ── 1. HEALTHY: родной discovery ────────────────────────────────────────────
const discovery = await importFrom('@deepseek-ai/dsh-agent-presets/lib/types/discovery.js');
const rows = await discovery.scanRoot({ path: join(DSH_HOME, '.agent-presets'), trust: 'user' }, pathToFileURL(PROFILE_ROOT + '/'));
const row = rows.find((preset) => preset.id === PRESET_ID);
check(row !== undefined, `preset найден в user-root (id=${PRESET_ID})`);
check(row?.broken === undefined, `preset HEALTHY (broken=${JSON.stringify(row?.broken ?? null)})`);
if (row?.broken !== undefined) {
  console.log('\nПрервано: пресет считается сломанным родным загрузчиком.');
  process.exit(1);
}

// ── 2. Строки subagent_*: схема tool-subagent, а не текстовый поиск ─────────
// Разбор идёт ровно тем же YAML-диалектом, что и у загрузчика: entryListSchema
// из cordis-plugin-include (JSON_SCHEMA + тег !!js).
const { createRequire } = await import('node:module');
const requireFromProfile = createRequire(pathToFileURL(join(PROFILE_ROOT, 'package.json')));
const jsYaml = requireFromProfile('js-yaml');
const { entryListSchema } = await importFrom('@deepseek-ai/cordis-plugin-include/lib/index.js');
const { Config } = await importFrom('@deepseek-ai/dsh-tool-subagent/lib/index.js');

const text = await readFile(COMPOSITION, 'utf8');
const composition = jsYaml.load(text, { schema: entryListSchema });
check(Array.isArray(composition), 'композиция разобрана родным YAML-диалектом (top-level list)');

const walk = (nodes, visit) => {
  for (const node of nodes) {
    visit(node);
    if (node.group === true && Array.isArray(node.config)) walk(node.config, visit);
  }
};
const toolRows = new Map();
walk(composition, (node) => {
  if (typeof node?.config?.toolName === 'string') toolRows.set(node.config.toolName, node.config);
});

for (const name of TARGETS) {
  const raw = toolRows.get(name);
  if (raw === undefined) {
    check(false, `${name}: строка не найдена`);
    continue;
  }
  // Схема плагина: заодно доказывает, что конфиг валиден для загрузчика.
  let parsed;
  try {
    parsed = Config(raw);
    check(true, `${name}: конфиг принят схемой @deepseek-ai/dsh-tool-subagent`);
  } catch (error) {
    check(false, `${name}: схема отвергла конфиг — ${String(error)}`);
    continue;
  }

  const allow = parsed.toolFilter?.allow;
  const deny = parsed.toolFilter?.deny;
  check(Array.isArray(allow), `${name}: toolFilter.allow присутствует (${JSON.stringify(allow)})`);
  check(deny === undefined, `${name}: toolFilter.deny отсутствует (${JSON.stringify(deny ?? null)})`);
  check(
    Array.isArray(allow) && allow.length === ALLOWED.size && allow.every((tool) => ALLOWED.has(tool)),
    `${name}: allow-list ровно read, glob, grep (получено ${JSON.stringify(allow ?? null)})`,
  );
  const extra = (allow ?? []).filter((tool) => !ALLOWED.has(tool));
  check(extra.length === 0, `${name}: лишних инструментов в allow нет (${JSON.stringify(extra)})`);
  const leaked = FORBIDDEN.filter((tool) => (allow ?? []).includes(tool));
  check(leaked.length === 0, `${name}: запрещённые инструменты отсутствуют (${JSON.stringify(leaked)})`);

  // Неизменённые поля.
  check(parsed.provider === 'spawn', `${name}: provider=spawn`);
  check(parsed.backgroundMode === 'one-shot', `${name}: backgroundMode=one-shot`);
  check(parsed.enableRunInBackground === false, `${name}: enableRunInBackground=false`);
  check(parsed.maxDepth === 1, `${name}: maxDepth=1`);
  check(typeof parsed.persona === 'string' && parsed.persona.length > 0, `${name}: persona на месте (${parsed.persona?.length ?? 0} символов)`);
}

// ── 3. Остальные строки preset не должны получить toolFilter ────────────────
for (const [toolName, config] of toolRows) {
  if (TARGETS.includes(toolName)) continue;
  check(config.toolFilter === undefined, `${toolName}: toolFilter не добавлен (не изменяем)`);
}
const chiefPersona = text.includes('Ты — Screeps Chief Architect');
check(chiefPersona, 'persona Chief Architect на месте');
check(!/toolFilter/.test(text.split('id: tool-subagent\n')[1]?.split('- id: tool-subagent-cpu')[0] ?? ''), 'строки subagent/subagent_fork без toolFilter');

// ── 4. Структурное сравнение с бэкапом: изменены только четыре строки ───────
const BACKUP = join(process.cwd(), 'tests', 'preset-backup', 'agent.cordis.yml.before-toolFilter');
let backupText = null;
try {
  backupText = await readFile(BACKUP, 'utf8');
} catch {
  console.log('info  бэкап не найден — структурное сравнение пропущено');
}
if (backupText !== null) {
  const ROW_KEYS = ['id', 'name', 'provider', 'toolName', 'backgroundMode', 'enableRunInBackground', 'maxDepth', 'toolFilter', 'persona'];
  const digest = (source) => {
    const parsed = jsYaml.load(source, { schema: entryListSchema });
    const seen = [];
    walk(parsed, (node) => {
      seen.push(ROW_KEYS.map((key) => [key, node?.[key]]).filter(([, value]) => value !== undefined));
    });
    return seen;
  };
  const before = JSON.stringify(digest(backupText));
  const after = digest(text).map((row) => {
    const toolName = row.find(([key]) => key === 'toolName')?.[1];
    if (!TARGETS.includes(toolName)) return row;
    return [...row, ['toolFilter', { allow: [...ALLOWED] }]];
  });
  check(before === JSON.stringify(after), 'все прочие строки preset байт-в-байт как в бэкапе (структурно)');
}

// ── 5. Имена read/glob/grep реально регистрируются как глобальные инструменты ─
const registered = (source, pattern) => new RegExp(pattern).test(source);
const fsSource = await readFile(join(PROFILE_ROOT, 'node_modules', '@deepseek-ai', 'dsh-tool-fs', 'lib', 'index.js'), 'utf8');
const searchSource = await readFile(join(PROFILE_ROOT, 'node_modules', '@deepseek-ai', 'dsh-tool-fs-search', 'lib', 'index.js'), 'utf8');
check(registered(fsSource, 'name: "read"'), 'инструмент read регистрируется пакетом dsh-tool-fs (tools.restrict примет имя)');
check(registered(searchSource, 'name: "glob"'), 'инструмент glob регистрируется пакетом dsh-tool-fs-search');
check(registered(searchSource, 'name: "grep"'), 'инструмент grep регистрируется пакетом dsh-tool-fs-search');

console.log(`\nИтог: ${failures.length === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `ПРОВАЛЕНО ${failures.length}`}`);
for (const failure of failures) console.log(` - ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
