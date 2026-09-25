// jsconfig проверяет JS с moduleResolution: classic, а у screeps-api нет
// типов, разрешимых в этом режиме (TS2792). Ошибка не о коде: пакет
// установлен и работает — глушим только эту строку.
// @ts-ignore
const { ScreepsAPI } = require("screeps-api");
const { requireToken } = require("./screeps.token");

// ── Выгрузка кода ────────────────────────────────────────────────────────
// Почему не grunt-screeps: он берёт ИМЯ МОДУЛЯ из basename файла, поэтому
// папки при выгрузке разворачиваются в корень (constants/logistics.js →
// модуль "logistics"). Тогда на шарде не разрешается ни barrel
// require("./constants/logistics"), ни require("./constants/market") — весь
// смысл разбиения constants/* теряется. Выгружаем сами через screeps-api
// (он уже в зависимостях) и сохраняем путь файла без расширения как имя
// модуля — так же, как это делает require на шарде.
const BRANCH = "test";
const SRC = [
  "*.js",
  "constants/*.js",
  // Служебные файлы: Gruntfile и модуль чтения токена на сервере не нужны.
  "!Gruntfile.js",
  "!screeps.token.js",
];

module.exports = function (grunt) {
  grunt.registerTask(
    "screeps",
    "Выгрузка кода в Screeps с сохранением путей модулей",
    function () {
      const done = this.async();

      const modules = {};
      for (const file of grunt.file.expand(SRC)) {
        modules[file.replace(/\.js$/, "")] = grunt.file.read(file);
      }
      if (Object.keys(modules).length === 0) {
        grunt.log.error("Не найдено ни одного файла для выгрузки.");
        done(false);
        return;
      }

      const api = new ScreepsAPI({ token: requireToken() });
      api.code
        .set(BRANCH, modules)
        .then(() => {
          grunt.log.writeln(
            `Выгружено модулей: ${Object.keys(modules).length} ` +
              `→ ветка "${BRANCH}" (пути сохранены: constants/*).`,
          );
          done();
        })
        .catch((err) => {
          grunt.log.error(`Ошибка выгрузки: ${err.message}`);
          done(false);
        });
    },
  );
};
