"use strict";
/**
 * Dijkstra «как PathFinder в Screeps» по реальному террейну (/tmp/rooms.json):
 * стоимость: стена — нельзя, равнина 2, болото 10, дорога 1 (структурная
 * матрица Traveler'а: дороги 1, прочие структуры 0xff).
 *
 * Цель: понять, куда реально ведёт путь от клетки входа (24,1) E35S38
 * к источнику (36,32) — не уходит ли он на север, в домашнюю комнату.
 *
 * Запуск: node tests/path.sim.js
 */
const j = require("/tmp/rooms.json");

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

const ROOM_RE = /^([WE])(\d+)([NS])(\d+)$/;
function parseRoom(name) {
  const m = ROOM_RE.exec(name);
  return { ew: m[1], e: +m[2], ns: m[3], s: +m[4] };
}
function neighborRoom(name, dir) {
  const r = parseRoom(name);
  const [dx, dy] = DIRS[dir - 1];
  if (dx) {
    if (r.ew === "E") r.e += dx > 0 ? 1 : -1;
    else r.e += dx < 0 ? 1 : -1;
  }
  if (dy) {
    if (r.ns === "S") r.s += dy > 0 ? 1 : -1;
    else r.s += dy < 0 ? 1 : -1;
  }
  return `${r.ew}${r.e}${r.ns}${r.s}`;
}
function stepPos(room, x, y, dir) {
  const [dx, dy] = DIRS[dir - 1];
  let nx = x + dx;
  let ny = y + dy;
  let nr = room;
  if (nx < 0) {
    nr = neighborRoom(nr, 7);
    nx = 49;
  } else if (nx > 49) {
    nr = neighborRoom(nr, 3);
    nx = 0;
  }
  if (ny < 0) {
    nr = neighborRoom(nr, 1);
    ny = 49;
  } else if (ny > 49) {
    nr = neighborRoom(nr, 5);
    ny = 0;
  }
  return { room: nr, x: nx, y: ny };
}

// ── МАТРИЦА (структурная, как в traveler.addStructuresToMatrix) ──────────
const blocked = {}; // "room:x,y" -> true
const road = {}; // "room:x,y" -> true
for (const room of Object.keys(j)) {
  for (const o of j[room].objects || []) {
    if (o.type !== "road" && o.type !== "container" && o.structureType !== "container" && o.structureType !== "road") continue;
    if (o.structureType === "road" || o.type === "road") road[`${room}:${o.x},${o.y}`] = true;
  }
  // прочие структуры (не дороги/контейнеры) считаем непроходимыми
  for (const o of j[room].objects || []) {
    if (!o.structureType) continue;
    if (o.structureType === "road" || o.structureType === "container") continue;
    blocked[`${room}:${o.x},${o.y}`] = true;
  }
}

function tileCost(room, x, y) {
  const data = j[room];
  if (!data) return 2; // террейн не загружен — считаем равниной
  const t = data.terrain[0] ? data.terrain[0].terrain : data.terrain;
  const c = t.charAt(y * 50 + x);
  if (c === "1") return Infinity;
  const key = `${room}:${x},${y}`;
  if (blocked[key]) return Infinity;
  if (road[key]) return 1; // структурная матрица: дорога = 1
  return c === "2" ? 10 : 2;
}

function dijkstra(start, goal, range) {
  const key = p => `${p.room}:${p.x},${p.y}`;
  const dist = { [key(start)]: 0 };
  const prev = {};
  const pq = [{ p: start, d: 0 }];
  const goalKey = p => p.room === goal.room && Math.max(Math.abs(p.x - goal.x), Math.abs(p.y - goal.y)) <= range;
  let best = null;
  while (pq.length) {
    pq.sort((a, b) => b.d - a.d);
    const { p, d } = pq.pop();
    if (d > (dist[key(p)] ?? Infinity)) continue;
    if (goalKey(p)) {
      best = p;
      break;
    }
    for (let dir = 1; dir <= 8; dir++) {
      const n = stepPos(p.room, p.x, p.y, dir);
      const c = tileCost(n.room, n.x, n.y);
      if (!isFinite(c)) continue;
      // в цели сама клетка может быть стеной — тогда заходим нельзя,
      // но цель с range>0 ищется по соседям, поэтому просто пропускаем.
      const nd = d + c;
      const nk = key(n);
      if (nd < (dist[nk] ?? Infinity)) {
        dist[nk] = nd;
        prev[nk] = p;
        pq.push({ p: n, d: nd });
      }
    }
  }
  if (!best) return null;
  const path = [];
  let cur = best;
  while (cur) {
    path.unshift(cur);
    cur = prev[key(cur)];
  }
  return { cost: dist[key(best)], path };
}

function show(label, start, goal, range) {
  const res = dijkstra(start, goal, range);
  console.log(`\n=== ${label}`);
  if (!res) {
    console.log("   путь не найден");
    return;
  }
  console.log(`   стоимость ${res.cost}, клеток ${res.path.length}`);
  const first = res.path.slice(0, 12).map(p => `${p.room}:${p.x},${p.y}`);
  console.log(`   первые шаги: ${first.join(" -> ")}`);
  const rooms = [...new Set(res.path.map(p => p.room))];
  console.log(`   комнаты по маршруту: ${rooms.join(", ")}`);
  const last = res.path.slice(-2).map(p => `${p.room}:${p.x},${p.y}`);
  console.log(`   финиш: ${last.join(" -> ")}`);
}

// 1. От клетки входа в дальнюю комнату к источнику (36,32).
show(
  "из (24,1) E35S38 к источнику (36,32) E35S38, range 1",
  { room: "E35S38", x: 24, y: 1 },
  { room: "E35S38", x: 36, y: 32 },
  1,
);
// 2. То же, но из (25,25) — центра комнаты.
show(
  "из (25,25) E35S38 к источнику (36,32), range 1",
  { room: "E35S38", x: 25, y: 25 },
  { room: "E35S38", x: 36, y: 32 },
  1,
);
// 3. Из домашней комнаты к центру дальней (waypoint роли).
show(
  "из (23,49) E35S37 к (25,25) E35S38, range 1",
  { room: "E35S37", x: 23, y: 49 },
  { room: "E35S38", x: 25, y: 25 },
  1,
);
// 4. Из домашней комнаты прямо к источнику дальней.
show(
  "из (23,49) E35S37 к источнику (36,32) E35S38, range 1",
  { room: "E35S37", x: 23, y: 49 },
  { room: "E35S38", x: 36, y: 32 },
  1,
);

// 5. Тот же маршрут, но с запретом выходить из комнаты (аналог maxRooms: 1):
// сравниваем стоимость прямого пути внутри комнаты с обходом через дом.
{
  const only = room => room === "E35S38";
  const savedTileCost = tileCost;
  showInRoom();
  function showInRoom() {
    // локальная версия dijkstra с ограничением по комнатам
    const restrict = { value: null };
    restrict.value = only;
    const res = dijkstraRestricted(
      { room: "E35S38", x: 24, y: 1 },
      { room: "E35S38", x: 36, y: 32 },
      1,
      only,
    );
    console.log(
      `\n=== из (24,1) E35S38 к источнику (36,32) БЕЗ выхода из комнаты`,
    );
    if (!res) console.log("   путь не найден");
    else {
      console.log(`   стоимость ${res.cost}, клеток ${res.path.length}`);
      console.log(
        `   первые шаги: ${res.path
          .slice(0, 8)
          .map(p => `${p.room}:${p.x},${p.y}`)
          .join(" -> ")}`,
      );
    }
    void savedTileCost;
  }
}

function dijkstraRestricted(start, goal, range, roomFilter) {
  const key = p => `${p.room}:${p.x},${p.y}`;
  const dist = { [key(start)]: 0 };
  const prev = {};
  const pq = [{ p: start, d: 0 }];
  let best = null;
  while (pq.length) {
    pq.sort((a, b) => b.d - a.d);
    const { p, d } = pq.pop();
    if (d > (dist[key(p)] ?? Infinity)) continue;
    if (
      p.room === goal.room &&
      Math.max(Math.abs(p.x - goal.x), Math.abs(p.y - goal.y)) <= range
    ) {
      best = p;
      break;
    }
    for (let dir = 1; dir <= 8; dir++) {
      const n = stepPos(p.room, p.x, p.y, dir);
      if (!roomFilter(n.room)) continue;
      const c = tileCost(n.room, n.x, n.y);
      if (!isFinite(c)) continue;
      const nd = d + c;
      const nk = key(n);
      if (nd < (dist[nk] ?? Infinity)) {
        dist[nk] = nd;
        prev[nk] = p;
        pq.push({ p: n, d: nd });
      }
    }
  }
  if (!best) return null;
  const path = [];
  let cur = best;
  while (cur) {
    path.unshift(cur);
    cur = prev[key(cur)];
  }
  return { cost: dist[key(best)], path };
}
