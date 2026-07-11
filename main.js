/**
 * ГЛАВНЫЙ ЦИКЛ (Main Loop)
 * ТЗ №3: main.js разгружен, вся логика — в empire.js (Empire Kernel).
 */
const empire = require("empire");

module.exports.loop = function () {
  empire.run();
};
