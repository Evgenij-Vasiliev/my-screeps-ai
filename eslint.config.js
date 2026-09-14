const screepsConfig = require('eslint-config-screeps');
const globals = require('globals');

module.exports = [
  {
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.node,
        ...screepsConfig.globals,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
    },
  },
];