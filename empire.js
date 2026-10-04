/**
 * EMPIRE KERNEL (Ядро Империи)
 * Уровень империи: очистка памяти, делегирование всей комнатной
 * логики Room Manager'у, запуск глобального рынка.
 */
const taskManager = require("task.manager");
const roomManager = require("room.manager");
const marketManager = require("market.manager");
const terminalNetwork = require("terminalNetwork");
const cpuMonitor = require("cpuMonitor");
const systems = require("systems");

module.exports.run = function () {
  cpuMonitor.startTick();

  // 1. Очистка памяти умерших крипов
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  // ── Гигиена Memory ──────────────────────────────────────────────────
  // Memory сериализуется ЦЕЛИКОМ каждый тик, поэтому любой мёртвый ключ —
  // это постоянный расход CPU. На живом шарде 27.09.2026 в Memory накопилось
  // 85 отладочных полей на 61 КБ (55 % объёма) — уборка ниже не даёт этому
  // повториться.
  //
  // Конвенция: имя поля верхнего уровня, начинающееся с "__", означает
  // ВРЕМЕННОЕ значение. Такие поля не переживают тик уборки.
  // Для отладки, когда значение нужно сохранить между тиками:
  //   Memory.keepTemp = true   — уборка временно выключена
  //   delete Memory.keepTemp   — снова включена
  if (Memory.keepTemp !== true) {
    for (const key in Memory) {
      // charCodeAt вместо startsWith: без создания подстроки на каждой итерации.
      if (key.charCodeAt(0) === 95 && key.charCodeAt(1) === 95) {
        delete Memory[key];
      }
    }
  }

  // towerState переехал в heap (задание 5), structureCache — в scanner.
  if (Memory.towerState) delete Memory.towerState;

  // ── Мёртвый кэш пути движка ─────────────────────────────────────────
  // Ключ `_move` в памяти крипа пишет ТОЛЬКО нативный `creep.moveTo`
  // (engine src/game/creeps.js: `memory._move` при reusePath). После порта
  // Traveler (04.10.2026) во всём рантайме не осталось ни одного `moveTo` —
  // движение ведёт `creep.travelTo`, который держит путь в `_travel`. Значит
  // `_move` больше никем не обновляется и никем не читается, но и сам не
  // исчезает: движок его не чистит, а `delete Memory.creeps[name]` срабатывает
  // только на смерти крипа.
  //
  // Замер shard3 04.10.2026: `_move` у 15 крипов из 20 — 1313 байт, тогда как
  // живой `_travel` — 2875 байт. Ключ вычищается, а не переписывается: если
  // `moveTo` когда-нибудь вернётся (откат порта), движок создаст `_move` заново.
  //
  // Уборка идёт после удаления памяти мёртвых крипов (шаг 1) — иначе ключи
  // умерших пришлось бы обходить дважды.
  for (const name in Memory.creeps) {
    if (Memory.creeps[name]._move) delete Memory.creeps[name]._move;
  }

  // 2. Уровень комнат — вся комнатная логика внутри roomManager.
  // Тумблеры систем — в systems.js: roomManager: false выключает этот вызов.
  if (systems.roomManager !== false) roomManager.run();

  // 3. TerminalNetwork — межкомнатная логистика (подключено 01.10.2026).
  // Порядок важен: roomManager уже отработал, поэтому конфиги троек
  // (Memory.rooms[*].labs*/boostLab) заполнены labManager'ом в этом же тике —
  // именно из них сеть строит список реагентов, которые надо развезти.
  // Гейта по bucket здесь нет намеренно: в этой ветке marketManager ниже
  // вызывается так же безусловно, а loadShed гейтит только фоновые генераторы
  // задач. Если понадобится — обёртка одна: if (!bucketLow) { ... }.
  if (systems.terminalNetwork !== false) {
    cpuMonitor.trackRole("terminalNetwork", () => terminalNetwork.run());
  }

  // 4. Рынок империального уровня
  if (systems.marketManager !== false) {
    cpuMonitor.trackRole("marketManager", () => marketManager.run());
  }

  // 5. Сжатие очередей задач. Завершение задачи оставляет в массиве
  // null-надгробие (чтобы не сдвигать массив и держать O(1)); дыры надо
  // убрать ДО конца тика, иначе они уедут в сериализованную Memory.
  //
  // У taskCompact выключателя НЕТ и быть не должно: выключенное сжатие
  // оставляет надгробия в Memory навсегда — это утечка, а не экономия.
  cpuMonitor.trackRole("taskCompact", () => taskManager.compactAll());

  cpuMonitor.endTick();
};
