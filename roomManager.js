/**
 * ===================================================
 * ROOMMANAGER.JS — Менеджер комнат
 * ===================================================
 * VERSION: 2.1
 *
 * ИЗМЕНЕНИЯ v2.1 (ТЗ Архитектора №2):
 * - Remote-логика вынесена в room.remote.js
 * - Удалены: HIGH_RISK_ROOMS, REMOTE_SCAN_ROOMS, runAttackScanner()
 * - Добавлен: roomRemote.run(room)
 *
 * ИЗМЕНЕНИЯ v2.0 (ТЗ Архитектора №1):
 * - Spawn-логика вынесена в room.spawn.js
 *
 * roomManager теперь отвечает ТОЛЬКО за:
 *   кэши комнаты, башни, источники, минералы,
 *   стройки, ремонт, observer,
 *   terminal, links, labs, factory
 * ===================================================
 */

// Логика башен — атакует врагов, лечит союзников
const roleTower = require("./role.tower");
// Торговля на рынке и логистика между комнатами
const terminalManager = require("./terminalManager");
// Управление линками — телепорт энергии между точками
const linkManager = require("./role.linkManager");
// Управление лабораториями — варка бустов
const labManager = require("./role.labManager");
// Управление фабриками
const factoryController = require("./factoryController");
// Логика спавна крипов (вынесено v2.0)
const roomSpawn = require("./room.spawn");
// Оркестрация удалённых комнат (вынесено v2.1)
const roomRemote = require("./room.remote");

// Комната с Observer — сканирует соседние комнаты
const OBSERVER_ROOM = "E36S38";

// ── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ───────────────────────────────────────────────

/**
 * Генерирует список комнат для сканирования Observer'ом.
 */
function generateScanList(roomName, radius) {
  const match = roomName.match(/([EW])(\d+)([NS])(\d+)/);
  if (!match) return [];
  const xDir = match[1];
  const x = parseInt(match[2]);
  const yDir = match[3];
  const y = parseInt(match[4]);
  const list = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0) continue;
      list.push(`${xDir}${nx}${yDir}${ny}`);
    }
  }
  return list;
}

/**
 * Запускает Observer — каждый тик смотрит в следующую комнату по списку.
 */
function runObserver(room) {
  const observer = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_OBSERVER,
  })[0];
  if (!observer) return;

  if (
    !room.memory.observerScanList ||
    room.memory.observerScanList.length === 0
  ) {
    room.memory.observerScanList = generateScanList(room.name, 10);
    room.memory.observerIdx = 0;
    console.log(
      `[Observer ${room.name}] Список сгенерирован: ${room.memory.observerScanList.length} комнат`,
    );
  }

  const list = room.memory.observerScanList;
  const idx = room.memory.observerIdx || 0;
  observer.observeRoom(list[idx % list.length]);
  room.memory.observerIdx = (idx + 1) % list.length;
}

// ── ГЛАВНЫЙ МОДУЛЬ ────────────────────────────────────────────────────────

const roomManager = {
  run: function (room) {
    // ── 1. ENERGY TARGETS — каждый тик ──────────────────────────────────
    {
      const energyTargets = room.find(FIND_MY_STRUCTURES, {
        filter: s =>
          (s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_SPAWN) &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });
      room.memory.energyTargets = energyTargets.map(s => s.id);
      room._energyTargets = energyTargets;
    }

    // ── 2. БАШНИ — раз в 50 тиков ────────────────────────────────────────
    if (!room.memory.towers || Game.time % 50 === 0) {
      const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
      });
      room.memory.towers = towers.map(t => t.id);
    }
    room._towers = room.memory.towers
      .map(id => Game.getObjectById(id))
      .filter(Boolean);

    // ── 3. ИСТОЧНИКИ — один раз навсегда ─────────────────────────────────
    if (!room.memory.sources) {
      const sources = room.find(FIND_SOURCES);
      room.memory.sources = sources.map(s => s.id);
    }
    room._sources = room.memory.sources
      .map(id => Game.getObjectById(id))
      .filter(Boolean);

    // ── 4. МИНЕРАЛ — раз в 100 тиков ─────────────────────────────────────
    if (!room.memory.mineralId || Game.time % 100 === 0) {
      const minerals = room.find(FIND_MINERALS);
      room.memory.mineralId = minerals.length > 0 ? minerals[0].id : null;
    }

    // ── 5. СТРОЙКИ — раз в 100 тиков ─────────────────────────────────────
    if (room.memory.hasSites === undefined || Game.time % 100 === 0) {
      room.memory.hasSites = room.find(FIND_CONSTRUCTION_SITES).length > 0;
    }

    // ── 6. РЕМОНТ — раз в 100 тиков ──────────────────────────────────────
    if (room.memory.needsRepair === undefined || Game.time % 100 === 0) {
      room.memory.needsRepair =
        room.find(FIND_STRUCTURES, {
          filter: s =>
            s.hits < s.hitsMax * 0.8 &&
            s.structureType !== STRUCTURE_WALL &&
            s.structureType !== STRUCTURE_RAMPART,
        }).length > 0;
    }

    // ── 7. REMOTE — сканер атак (вынесено v2.1) ───────────────────────────
    roomRemote.run(room);

    // ── 8. СПАВН — делегируем в room.spawn.js ────────────────────────────
    roomSpawn.run(room);

    // ── 9. ТЕРМИНАЛ — продажа ресурсов и балансировка ────────────────────
    terminalManager.run(room);

    // ── 10. ФАБРИКА ───────────────────────────────────────────────────────
    factoryController.run(room);

    // ── 11. ЛИНКИ — передача энергии ─────────────────────────────────────
    linkManager.run(room);

    // ── 12. ЛАБЫ — варка бустов ───────────────────────────────────────────
    labManager.run(room);

    // ── 13. OBSERVER — сканируем соседние комнаты ─────────────────────────
    if (room.name === OBSERVER_ROOM) {
      runObserver(room);
    }

    // ── 14. БАШНИ — атакуем врагов, лечим союзников ──────────────────────
    room._towers.forEach(tower => roleTower.run(tower));
  },
};

module.exports = roomManager;
