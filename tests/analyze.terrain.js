"use strict";
/**
 * Разбор снимка /tmp/rooms.json: какая индексация террейна верна, и
 * связность E35S38 (что достижимо из клетки входа (23,1)).
 * Запуск: node tests/analyze.terrain.js
 */
const j = require("/tmp/rooms.json");

const rowMajor = t => (x, y) => t.charAt(y * 50 + x);
const colMajor = t => (x, y) => t.charAt(x * 50 + y);

for (const room of ["E35S37", "E35S38", "E36S37"]) {
  const t = j[room].terrain[0].terrain;
  for (const [name, at] of [
    ["row-major", rowMajor(t)],
    ["col-major", colMajor(t)],
  ]) {
    let onWall = 0;
    let total = 0;
    for (const o of j[room].objects) {
      if (o.type !== "road" && o.type !== "container") continue;
      total++;
      if (at(o.x, o.y) === "1") onWall++;
    }
    // Координаты объектов должны попадать в "свой" сектор: у дорог не должно
    // быть стен-совпадений.
    console.log(
      `${room} ${name}: дорог/контейнеров ${total}, на стене ${onWall}`,
    );
  }
  // Координаты объектов-крипов и структур для ручной проверки
  const samples = j[room].objects
    .filter(o => o.type === "controller" || o.type === "source" || o.type === "mineral")
    .map(o => `${o.type}(${o.x},${o.y})`);
  console.log(`   объекты: ${samples.join(" ")}`);
}

// ── Связность E35S38 ────────────────────────────────────────────────────
{
  const t = j.E35S38.terrain[0].terrain;
  const at = rowMajor(t);
  const map = [];
  for (let y = 0; y < 50; y++) {
    let r = "";
    for (let x = 0; x < 50; x++) r += at(x, y) === "1" ? "#" : ".";
    map.push(r);
  }
  const DIRS = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ];
  const reach = (sx, sy) => {
    const seen = new Set([`${sx},${sy}`]);
    const q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx > 49 || ny > 49) continue;
        const k = `${nx},${ny}`;
        if (seen.has(k) || map[ny][nx] === "#") continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    return seen;
  };

  const fromEntry = reach(23, 1);
  console.log("\nE35S38: из клетки входа (23,1) достижимо", fromEntry.size, "клеток");
  for (const [x, y, label] of [
    [25, 25, "центр комнаты (waypoint роли)"],
    [36, 33, "спутник источника (36,32)"],
    [36, 31, "спутник источника (36,32)"],
    [37, 32, "спутник источника (36,32)"],
    [18, 39, "у контроллера"],
  ]) {
    console.log(
      `   (${x},${y}) ${label}: стена=${map[y][x] === "#"} достижимо=${fromEntry.has(`${x},${y}`)}`,
    );
  }

  const fromCenter = reach(25, 25);
  console.log("   из центра (25,25) достижимо", fromCenter.size, "клеток");
  console.log(
    `   спутник источника (37,32) из центра: ${fromCenter.has("37,32")}`,
  );
  console.log(
    `   ${"карта (# стена, * из (23,1), + из (25,25), S источник, C контроллер, M минерал)"}`,
  );
  for (let y = 0; y < 50; y++) {
    let r = "";
    for (let x = 0; x < 50; x++) {
      if (x === 36 && y === 32) r += "S";
      else if (x === 19 && y === 39) r += "C";
      else if (x === 24 && y === 20) r += "M";
      else if (map[y][x] === "#") r += "#";
      else if (fromCenter.has(`${x},${y}`)) r += "+";
      else if (fromEntry.has(`${x},${y}`)) r += "*";
      else r += ".";
    }
    console.log(String(y).padStart(2) + " " + r);
  }
}
