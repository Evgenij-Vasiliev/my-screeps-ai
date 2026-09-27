const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");
const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const files = fs.readdirSync(".").filter(f => f.endsWith(".js"));
const sources = files.map(f => ({ f, text: fs.readFileSync(f, "utf8") }));

(async () => {
  await api.console("Memory.__keys = JSON.stringify(Object.keys(Memory).map(k => { let s = -1; try { const j = JSON.stringify(Memory[k]); s = j === undefined ? -2 : j.length; } catch (e) {} return [k, s]; }).sort((a,b) => b[1]-a[1]))", "shard3");
  await sleep(4000);
  const v = await api.memory.get("__keys", "shard3");
  await api.console("delete Memory.__keys", "shard3");
  const arr = JSON.parse(v.data);
  fs.writeFileSync("/tmp/memkeys.json", JSON.stringify(arr, null, 1));

  let deadBytes = 0;
  const dead = [], unknown = [], used = [];
  for (const [k, s] of arr) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("Memory\\." + esc + "\\b|Memory\\[\"'" + esc + "\"']");
    const hit = sources.filter(o => re.test(o.text)).map(o => o.f);
    if (hit.length) used.push(k + "(" + s + ") <- " + hit.join(","));
    else if (k.startsWith("__")) { dead.push(k); deadBytes += Math.max(0, s); }
    else unknown.push([k, s]);
  }
  console.log("ВСЕГО:", arr.length, "ключей | сумма секций:", arr.reduce((n, x) => n + Math.max(0, x[1]), 0), "Б");
  console.log("\n=== МЁРТВЫЕ __*:", dead.length, "шт,", deadBytes, "Б ===");
  console.log(dead.join(" "));
  console.log("\n=== ИСПОЛЬЗУЮТСЯ КОДОМ:", used.length);
  console.log(used.join("\n"));
  console.log("\n=== БЕЗ ССЫЛОК, НО НЕ __* (решение за человеком):");
  for (const [k, s] of unknown) console.log("  ", k, s);
  process.exit(0);
})().catch(e => { console.log("FAILED:", e.message); process.exit(0); });
