/**
 * ГЛАВНЫЙ ЦИКЛ (Main Loop)
 * ТЗ №3: main.js разгружен, вся логика — в empire.js (Empire Kernel).
 */
const empire = require("empire");

// ── TRAVELER: библиотека движения (порт из ветки «Новая-Империя») ──────────
// Вызов фабрики создаёт `Creep.prototype.travelTo`. Нативный
// `Creep.prototype.moveTo` НЕ подменяется (traveler.js:9-10), поэтому роли,
// которые ещё не переведены, продолжают работать как раньше: переход на
// Traveler делается по одному месту, а не сразу по всему боту.
//
// try/catch здесь по делу, а не для красоты: `traveler.js` опирается на два
// глобала рантайма Screeps — `_` (lodash движка) и `Creep`. В Node (офлайн-тесты,
// scripts/check.boot.js) их нет, и без перехвата падала бы загрузка ВСЕХ модулей
// (`Error: _ is not defined` из traveler.js:29). При перехвате бот продолжает
// работать на нативном `moveTo` — тот же откат, что при `{installPrototype:false}`.
//
// Порядок важен: `Creep` существует во время исполнения модуля, а вызов
// фабрики создаёт `global.traveler` и метку `global.travelerTick`. Дальше
// экземпляр пересоздаётся раз в тик при первом `travelTo` (traveler.js:544-556),
// поэтому кэши CostMatrix живут ровно один тик и не растут.
//
// Состояние пути Traveler держит в `creep.memory._travel` (travelData.path, а
// не в `_move`): ключ снимается вместе с памятью мёртвого крипа в empire.js.
//
// Откат: git checkout -- main.js
try {
  require("traveler")();
} catch (e) {
  console.log("[main] traveler не подключён: " + (e.message || e));
}

module.exports.loop = function () {
  empire.run();
};
