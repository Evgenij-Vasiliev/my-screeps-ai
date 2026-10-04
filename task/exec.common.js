// ===================================================
// TASK/exec.common.js — общие помощники исполнителей
// ===================================================
// Часть разбиения task.executors.js (957 строк, 04.10.2026): исполнители
// разложены по тем же семействам, что и генераторы (task/gen.*.js). Наружу их
// по-прежнему отдаёт фасад task.executors.js — имена экспортов и объект
// executors не изменились (их зовут task/runner.js:2, executor.power.test.js:81,
// role.micro.test.js:125).
//
// resolveTarget (кэш резолва на тик), isValidTask и isTargetFull. Экспортируются для
// остальных exec.* и для worker.runner.js: выбор задачи считает расстояние до тех же
// id, что потом резолвит исполнитель.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
/**
 * ШАГ 3 ПЛАНА (ленивый резолв целей): повторяющиеся в одном тике id берём из
 * per-room кэша объектов в heap с ключом Game.time.
 *
 * Замер на живом шарде (shard3, Game.time 83294987, docs/resolve-measure.json):
 *   Game.getObjectById по прогретому id — 0.000094 CPU на вызов,
 *   повторный вызов того же id в том же тике — 0.000047 CPU,
 *   по несуществующему id — 0.000141 CPU,
 *   проверка кэша (tick + byId + hasOwnProperty) — 0.000088 + 0.000052 CPU.
 *
 * Кэш живёт один тик (объекты Game пересобираются каждый тик, хранить их
 * дольше нельзя), поэтому объект в heap один, а не по комнате на каждый id:
 * платить за индексацию было бы дороже, чем сэкономить.
 *
 * ДВИЖЕНИЕ: ведёт библиотека Traveler (`creep.travelTo`, traveler.js), она
 * подключается в main.js и создаёт метод на `Creep.prototype`. Политика
 * `MOVE.*` (reusePath) при этом больше НЕ применяется: путь Traveler держит сам
 * в `creep.memory._travel` по пункту назначения и переиспользует его между
 * заходами, поэтому `reusePath` в вызовах движения не нужен.
 *
 * ПОПЫТКА УБРАТЬ ШТАТНОЕ ДВИЖЕНИЕ ПРОВАЛЕНА (03-04.10.2026) — записано, чтобы
 * не повторять. Гипотеза: moveTo на каждом тике хода делает `_.cloneDeep(_move)`
 * и две конвертации пути (`deserializePath`/`serializePath`, engine
 * src/game/creeps.js), поэтому собственный маршрут со шагом через
 * `creep.move(direction)` должен снять 0.5-1.0 CPU/тик с роли worker.
 *
 * Что вышло: модуль `path.follow.js` был написан, покрыт тестами и выгружен.
 * Живой замер роли (`scripts/cpu.roles.measure.js`, окно 9 отчётов) после
 * выгрузки: **worker 1.2484 CPU/тик против 1.1959 до правки — снижения нет.**
 * Промежуточно всплыла и вторая ошибка: `PathFinder.search` с матрицей по
 * умолчанию структуры не учитывает (маршруты вели в spawn/extension/lab,
 * `creep.move` возвращал OK, движок не пускал, воркеры встали намертво); она
 * была устранена переходом на `creep.pos.findPathTo`, после чего движение
 * работало, но CPU не изменился.
 *
 * Вывод: цена роли worker лежит НЕ в обработке кэша пути. Модуль удалён.
 * Замер Traveler 04.10.2026 подтверждает то же с другой стороны: пересчёт
 * путей во всей империи — 24 пересчёта за 74 тика (0.324/тик) ценой 0.0714
 * CPU/тик, то есть 1.6 % бюджета. Движение в этом боте дёшево, и менять его
 * ради CPU смысла нет — Traveler здесь ради ПОВЕДЕНИЯ (обход пробок, маршрут
 * по пункту назначения, межкомнатные переходы), а не ради экономии.
 *
 * Откат: git checkout -- task.executors.js
 */
let resolveCache = null;

function resolveTarget(id) {
  if (!id) {
    return null;
  }

  const tick = Game.time;

  if (!resolveCache || resolveCache.tick !== tick) {
    resolveCache = { tick: tick, byId: {} };
  }

  if (Object.prototype.hasOwnProperty.call(resolveCache.byId, id)) {
    return resolveCache.byId[id];
  }

  const target = Game.getObjectById(id);
  resolveCache.byId[id] = target;
  return target;
}

function isValidTask(task) {
  return (
    !!task &&
    task.type === "transfer" &&
    !!task.sourceId &&
    !!task.targetId &&
    task.resourceType === RESOURCE_ENERGY
  );
}

function isTargetFull(target) {
  if (!target) return false;

  // ОДНО обращение к `.store`: каждое чтение — новая конструкция Store
  // (Object.entries по ресурсам, 4 defineProperty, new Proxy —
  // engine src/game/store.js). Прежняя версия читала его до трёх раз.
  const store = target.store;

  if (store && typeof store.getFreeCapacity === "function") {
    return store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  }
  return false;
}


module.exports = {
  resolveTarget,
  isValidTask,
  isTargetFull,
};
