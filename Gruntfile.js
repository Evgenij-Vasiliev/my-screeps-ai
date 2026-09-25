// jsconfig проверяет JS с moduleResolution: classic, а у screeps-api нет
// типов, разрешимых в этом режиме (TS2792). Ошибка не о коде: пакет
// установлен и работает — глушим только эту строку.
// @ts-ignore
const { ScreepsAPI } = require("screeps-api");
const { requireToken } = require("./screeps.token");
const {
  collectModules,
  buildModules,
  findUnresolvedRequires,
} = require("./scripts/deploy.modules");

// ── Выгрузка кода ────────────────────────────────────────────────────────
// Почему не grunt-screeps: он берёт ИМЯ МОДУЛЯ из basename файла, поэтому
// папки при выгрузке разворачиваются в корень (constants/logistics.js →
// модуль "logistics"). Тогда на шарде не разрешается ни barrel
// require("./constants/logistics"), ни require("./constants/market") — весь
// смысл разбиения constants/* теряется. Выгружаем сами через screeps-api
// (он уже в зависимостях) и сохраняем путь файла без расширения как имя
// модуля — так же, как это делает require на шарде.
//
// ВАЖНО: require на шарде НЕ разрешает относительные пути — движок лишь
// отбрасывает ведущий "./" и ищет имя от корня. Поэтому из constants/* сосед
// по папке находится только по корневому имени ("constants/logistics"), и
// scripts/deploy.modules.js переводит такие спецификаторы при выгрузке.
// Подробности и разбор живого падения — в шапке этого модуля.
const BRANCH = "test";

module.exports = function (grunt) {
  grunt.registerTask(
    "screeps",
    "Выгрузка кода в Screeps с сохранением путей модулей",
    function () {
      const done = this.async();

      const modules = buildModules(collectModules(__dirname));
      if (Object.keys(modules).length === 0) {
        grunt.log.error("Не найдено ни одного файла для выгрузки.");
        done(false);
        return;
      }

      // Страховка от "Unknown module '…'" на шарде: каждый require("<литерал>")
      // в том, что уедет, обязан указывать на выгружаемое имя модуля по
      // правилам движка. Лучше упасть здесь, чем на живом шарде.
      const problems = findUnresolvedRequires(modules);
      if (problems.length > 0) {
        grunt.log.error("Неразрешимые require — выгрузка отменена:");
        for (const { module, spec, target } of problems) {
          grunt.log.error(
            `  ${module}: require("${spec}") → модуль "${target}" не выгружается`,
          );
        }
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
