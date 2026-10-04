"use strict";
/**
 * ===================================================
 * SCRIPTS/CHECK.SHARD.ALIVE.JS — жив ли бот на шарде
 * ===================================================
 * Зачем: 29.09.2026 после выгрузки кода с циклическим require бот перестал
 * исполняться вовсе — движок падал на загрузке модулей:
 *
 *   Error: Circular reference to module 'room.manager'
 *       at Object.requireFn (<runtime>:21121:19)
 *       at task.generators:7:34
 *
 * Поймать это глазами по консоли можно, но нужен однозначный признак. Первая
 * версия скрипта брала два снимка Memory.cpuStats и сравнивала count/average —
 * ЭТОТ ПРИЗНАК НЕГОДЕН и 29.09.2026 дал ложную тревогу: cpuMonitor пишет
 * Memory.cpuStats раз в CPU.REPORT_INTERVAL (10) тиков, поэтому два снимка
 * легко попадают в одно окно, и живой бот выглядит мёртвым.
 *
 * Правильные признаки (оба проверяются ниже):
 *   1) Memory.cpuStats.total — накопитель, он РАСТЁТ каждый тик;
 *   2) маркер: бот чистит поля верхнего уровня с "__" в каждом тике
 *      (empire.js, гигиена Memory), поэтому удалённый маркер = loop исполняется.
 * Маркер ставится как Memory.keepTemp = true (штатный флаг проекта) и
 * снимается в finally В ЛЮБОМ случае.
 *
 * Скрипт больше НИЧЕГО не меняет: раньше он писал только своё временное поле.
 *
 * Запуск:
 *   node scripts/check.shard.alive.js [shard3] [секунды]
 * Код возврата: 0 — бот тикает, 1 — нет.
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const WINDOW_SEC = Number(process.argv[3] || 15);

const api = new ScreepsAPI({ token: resolveTokenSource().token });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Снимок «живости»: то, что боевой код меняет каждый тик. */
async function snapshot() {
  const stats = await api.memory.get("cpuStats", SHARD);
  const taskId = await api.memory.get("_taskIdSeq", SHARD);

  const s = stats && stats.data;
  return {
    total: s ? s.total : null,
    count: s ? s.count : null,
    average: s ? s.average : null,
    bucket: s ? s.bucket : null,
    creeps: s ? s.creeps : null,
    taskIdSeq: taskId ? taskId.data : null,
  };
}

(async () => {
  const { source } = resolveTokenSource();
  console.log(`Проверка живости бота: шард ${SHARD}, окно ${WINDOW_SEC} с (токен из: ${source})`);

  let markerLeft = false;
  let exitCode = 1;

  try {
    // Штатный флаг проекта: пока он стоит, empire не вычищает поля "__".
    // Живой бот снимет его сам (empire.js: если keepTemp !== true — уборка).
    await api.memory.set("keepTemp", true, SHARD);
    markerLeft = true;
    await sleep(1200);

    const a = await snapshot();
    console.log("t0:      ", JSON.stringify(a));

    await sleep(WINDOW_SEC * 1000);

    const b = await snapshot();
    console.log(`t+${WINDOW_SEC}с:`, JSON.stringify(b));

    const keep = await api.memory.get("keepTemp", SHARD);
    const alive = b.total !== a.total || a.taskIdSeq !== b.taskIdSeq || keep.data === undefined;

    console.log(
      alive
        ? "\nБот исполняется: Memory.cpuStats растёт и/или флаг keepTemp снят движком бота."
        : "\nБот НЕ исполняется: Memory не меняется (ошибка загрузки модулей или loop не вызывается).",
    );

    if (b.average !== null) {
      console.log(
        `CPU/тик (окно ${b.count}): ${Number(b.average).toFixed(3)}, bucket ${b.bucket}, крипов ${b.creeps}`,
      );
    }

    // Сверка версии модулей: причина прошлой аварии — обратный require.
    try {
      const res = await api.code.get("test");
      const mods = res.modules || res;
      const tg = mods["task.generators"] || "";
      const scannerSrc = mods["scanner"] || "";
      const version = (scannerSrc.match(/const CACHE_VERSION = (\d+)/) || [])[1];
      console.log(
        `Код на шарде: обратный require room.manager в task.generators — ` +
          `${/require\(\s*["']room\.manager["']\s*\)/.test(tg) ? "ЕСТЬ (цикл!)" : "нет"}, ` +
          `scanner CACHE_VERSION = ${version || "?"}`,
      );
    } catch (e) {
      console.log("Не удалось прочитать код с шарда:", e.message);
    }

    // Код возврата НЕ выходим здесь: process.exit() внутри try не даёт
    // выполниться finally, а именно в нём снимается маркер keepTemp. Именно на
    // этом скрипт и попадался: после каждой проверки флаг оставался стоять и
    // глушил уборку полей "__" в empire.js:32-39 (проверено 01.10.2026).
    exitCode = alive ? 0 : 1;
  } finally {
    // Снимаем флаг ВСЕГДА, даже если проверка упала: иначе бот перестанет
    // чистить временные поля и Memory начнёт расти.
    if (markerLeft) {
      // Снятие ТОЛЬКО консольной командой и с паузой больше тика.
      // Проверено 01.10.2026: POST /api/user/memory со значением undefined
      // поле НЕ удаляет, а delete в консоли исполняется на следующем тике —
      // здесь это ~3.8 с, поэтому прежняя пауза 1.5 с давала ложное «НЕТ».
      let check = await api.memory.get("keepTemp", SHARD);

      for (let attempt = 1; attempt <= 2 && check.data !== undefined; attempt++) {
        await api.console("delete Memory.keepTemp", SHARD);
        await sleep(6000);
        check = await api.memory.get("keepTemp", SHARD);
      }

      console.log(
        "keepTemp снят:",
        check.data === undefined ? "да" : "НЕТ (проверьте вручную)",
      );
    }
  }

  process.exit(exitCode);
})();
