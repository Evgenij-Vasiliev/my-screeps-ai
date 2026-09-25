"use strict";
/**
 * ЖИВОЙ КОНТРОЛЬ АВТОЗАКУПКИ РЕАГЕНТОВ ЛАБ — ТОЛЬКО ЧТЕНИЕ (кроме штатной
 * диагностики Memory.__labImport/__labBuys, которую пишет сам market.manager).
 *
 * Показывает ФАКТ, а не намерение:
 *   - labImportActive: включена ли автозакупка (есть ли в Memory тройки лаб);
 *   - какие ресурсы ведёт курируемая закупка (X_PURCHASE / MARKET.IMPORT), а
 *     какие взяла на себя автоматика лаб;
 *   - по каждому реагенту плана: запас по империи, порог, цель и решение
 *     «покупать/нет» ровно той же функцией, которой пользуется рынок
 *     (market.manager.shouldBuyLabImport) — то есть скрипт не повторяет логику,
 *     а спрашивает её;
 *   - Memory.__labImport — что признано дефицитом на последнем запуске рынка;
 *   - Memory.__labBuys — журнал фактических сделок.
 *
 * Запуск: node tests/live.lab.autoimport.js
 * Токен: SCREEPS_TOKEN или встроенный (как в остальных live-скриптах проекта).
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });

// Ресурсы плана, интересные для контроля (те, что не ведёт курируемый импорт).
const WATCH = ["UHO2", "ZHO2", "KH2O", "OH", "ZO", "UO", "KH", "K", "L"];

const CMDS = [
  "var r=require('lab.recipes'),m=require('market.manager'),req=r.requiredReagents();" +
    "var o={t:Game.time,active:m.labImportActive()," +
    "handled:{X:m.labImportHandled('X'),O:m.labImportHandled('O'),H:m.labImportHandled('H')," +
    "U:m.labImportHandled('U'),Z:m.labImportHandled('Z'),UHO2:m.labImportHandled('UHO2')},r:[]};" +
    JSON.stringify(WATCH) +
    ".forEach(function(k){var q=req[k];if(!q)return;var d=m.shouldBuyLabImport(k,q);" +
    "o.r.push(k+' have='+d.total+' low='+d.low+' high='+d.high+' buy='+d.buy);});" +
    "console.log('AI'+JSON.stringify(o));",
  "console.log('AI2'+JSON.stringify({t:Game.time,labImport:Memory.__labImport||null,labBuys:Memory.__labBuys||null}));",
];

(async () => {
  const lines = {};
  await api.socket.connect();
  api.socket.subscribe("console", (event) => {
    let payload;
    try {
      payload = typeof event === "string" ? JSON.parse(event) : event;
    } catch (err) {
      void err;
      return;
    }
    const msgs = payload && payload.data && payload.data.messages;
    if (!msgs) return;
    const all = []
      .concat(msgs.log || [])
      .concat(msgs.error || [])
      .concat(msgs.result || []);
    for (const raw of all) {
      const line = String(raw).replace(/&#x22;/g, '"').replace(/&#x3E;/g, ">");
      if (line.indexOf("AI{") === 0) lines.AI = line.slice(2);
      if (line.indexOf("AI2{") === 0) lines.AI2 = line.slice(3);
    }
  });

  for (const expr of CMDS) {
    const res = await api.console(expr, SHARD);
    if (!res || res.ok !== 1) {
      console.error("console error:", JSON.stringify(res).slice(0, 200));
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  await new Promise((r) => setTimeout(r, 2500));
  try {
    api.socket.disconnect();
  } catch (err) {
    void err;
  }

  const a = lines.AI ? JSON.parse(lines.AI) : null;
  if (!a) {
    console.error("Не получен ответ AI — market.manager не ответил");
    process.exit(2);
  }

  console.log(`\n── тик ${a.t} | автозакупка лаб активна: ${a.active}`);
  console.log(
    "   ведёт курируемая закупка: " +
      Object.keys(a.handled)
        .filter((k) => a.handled[k])
        .join(", "),
  );
  console.log("   реагенты плана, которые ведёт автоматика:");
  for (const s of a.r) console.log("      " + s);
  console.log(
    "   Memory.__labImport: " +
      (lines.AI2 ? lines.AI2 : "(нет — дефицита не было)"),
  );
  process.exit(0);
})().catch((e) => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
