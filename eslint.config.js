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
        STRUCTURE_FACTORY: "readonly",
        STRUCTURE_INVADER_CORE: "readonly",
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
    },
  },
];