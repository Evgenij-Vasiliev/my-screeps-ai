const screepsConfig = require('eslint-config-screeps');
const globals = require('globals');

module.exports = [
  {
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.node,
        ...screepsConfig.globals,
        // Глобалы движка, которых нет в eslint-config-screeps (аудит, п. 39):
        // без них eslint выдавал 12 ложных no-undef на валидном API.
        RESOURCE_BATTERY: "readonly",
        RESOURCE_H: "readonly",
        STRUCTURE_FACTORY: "readonly",
        STRUCTURE_INVADER_CORE: "readonly",
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
    },
  },
  {
    // .mjs-файлы (проверка пресета DSH) — ES-модули: общий sourceType 'script'
    // давал на них "Parsing error: 'import' and 'export' may appear only with
    // 'sourceType: module'", из-за чего `npx eslint .` не был чистым.
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
];