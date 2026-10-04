// ===================================================
// ROOM/TOWERS.JS — башни: детектор атаки, ремонт, лечение
// ===================================================
// Часть разбиения room.manager.js (960 строк, 04.10.2026).
// Публичный API не изменился: наружу его отдаёт фасад room.manager.js
// (empire.js и консольные замеры зовут require("room.manager")).
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "room/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const scanner = require("scanner");
const roleTower = require("role.tower");
const cpuMonitor = require("cpuMonitor");
const { TOWER, TASK_CONFIG } = require("../constants");

const { getWallsAndRamparts, pickRepairTarget } = require("./repair");

/** Состояние комнаты, которому не обязательно переживать рестарт. */
function roomHeap(roomName) {
  if (!global.__roomHeap) global.__roomHeap = {};
  if (!global.__roomHeap[roomName]) global.__roomHeap[roomName] = {};
  return global.__roomHeap[roomName];
}

/**
 * Записывает флаг атаки в Memory ТОЛЬКО при смене значения.
 * Раньше underAttack переписывался каждый тик на каждую комнату, хотя
 * меняется раз в сотни тиков.
 */
function setUnderAttack(roomName, underAttack) {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};

  if (Memory.rooms[roomName].underAttack !== underAttack) {
    Memory.rooms[roomName].underAttack = underAttack;
  }
}

function detectAttack(roomState) {
  const roomName = roomState.roomName;
  const ATTACK_DROP_THRESHOLD = 1500;

  const wallsAndRamparts = getWallsAndRamparts(roomState);

  let currentTotalHits = 0;
  for (let i = 0; i < wallsAndRamparts.length; i++) {
    currentTotalHits += wallsAndRamparts[i].hits;
  }

  // lastWallHits — в heap: это детектор, а не состояние Империи. После
  // рестарта он просто начнёт отсчёт заново (как при первом запуске).
  const heap = roomHeap(roomName);
  const previousTotalHits = heap.lastWallHits;
  heap.lastWallHits = currentTotalHits;

  if (previousTotalHits === undefined) {
    return false;
  }

  return previousTotalHits - currentTotalHits > ATTACK_DROP_THRESHOLD;
}

/**
 * Тик ремонта башен — СВОЙ у каждой комнаты.
 *
 * Раньше условие было общим для всей империи (`Game.time % TOWER.REPAIR_INTERVAL
 * === 0`), поэтому все 16 башен всех 5 комнат били ремонтом в ОДИН тик:
 * замер 29.09.2026 (scripts/cpu.peaks.measure.js, флаг Memory.cpuGenProfile,
 * 92 окна) — 4.5031 CPU в этом тике против 0.0464 CPU/тик в среднем, то есть
 * 16 интентов × 0.2 CPU + резолв стен и повреждённых в одном тике.
 *
 * Фаза берётся хэшем имени комнаты — тем же детерминированным сдвигом, который
 * уже разносит перестройку кэша сканера (scanner.js rebuildStagger). Среднее и
 * поведение при этом НЕ меняются: каждая башня по-прежнему ремонтирует 1 раз
 * в TOWER.REPAIR_INTERVAL тиков, меняется только тик, в который это происходит.
 *
 * @param {string} roomName
 * @returns {boolean}
 */
function isTowerRepairTick(roomName) {
  const phase = scanner.rebuildStagger(roomName) % TOWER.REPAIR_INTERVAL;
  return (Game.time + phase) % TOWER.REPAIR_INTERVAL === 0;
}

function runTowerLogic(roomState) {
  cpuMonitor.trackRole("towers", () => {
    if (!roomState.towers || roomState.towers.length === 0) return;

    const roomName = roomState.roomName;
    const heap = roomHeap(roomName);
    // После рестарта heap пуст — подхватываем последнее известное значение
    // из Memory, чтобы не потерять тик на повторное обнаружение атаки.
    if (heap.underAttack === undefined) {
      heap.underAttack = !!(
        Memory.rooms &&
        Memory.rooms[roomName] &&
        Memory.rooms[roomName].underAttack
      );
    }

    // Основной сигнал — присутствие враждебных крипов. room.find движок
    // кэширует в пределах тика, и это дешевле JS-обхода списка id стен.
    const hostiles = roomState.room.find(FIND_HOSTILE_CREEPS);
    let underAttack = hostiles.length > 0;

    // Резервный сигнал — падение hits стен и валов: стены могут бить и без
    // враждебных крипов в поле зрения. Обход дорогой, поэтому раз в
    // TOWER.HOSTILE_CHECK_INTERVAL тиков, а не каждый тик.
    if (
      !underAttack &&
      Game.time % TOWER.HOSTILE_CHECK_INTERVAL === 0 &&
      detectAttack(roomState)
    ) {
      underAttack = true;
    }

    const roomData = { hostiles: underAttack ? hostiles : [] };

    heap.underAttack = underAttack;
    setUnderAttack(roomName, underAttack);

    // Тик ремонта у каждой комнаты свой — роль читает готовый флаг, а не
    // Game.time, иначе фаза комнаты в роли не учитывалась бы.
    const repairTick = isTowerRepairTick(roomName);
    roomData.canRepair = repairTick;

    if (repairTick) {
      // Только крипы, физически находящиеся в комнате: heal() по крипу
      // из другой комнаты — бесполезный интент.
      roomData.woundedCreep = roomState.creepsInRoom.find(
        c => c.hits < c.hitsMax,
      );

      // ОДНА цель на комнату и ОДНА башня под неё — ближайшая к цели.
      // Почему одна башня: интент стоит 0.2 CPU, а 16 башен по одной цели
      // давали пик 4.5031 CPU раз в 15 тиков (замер 29.09.2026) — при том,
      // что распад всей империи (валы 78 + дороги 75 хитов/тик) с запасом
      // покрывается одним действием на комнату за тик ремонта.
      // Ближайшая башня даёт максимум хитов: у repair падение по дальности
      // (TOWER_OPTIMAL_RANGE 5, TOWER_FALLOFF_RANGE 20 — @screeps/common).
      const target = pickRepairTarget(roomState);

      if (target) {
        let bestTower = null;
        let bestRange = Infinity;

        for (let i = 0; i < roomState.towers.length; i++) {
          const tower = roomState.towers[i];
          const range = tower.pos.getRangeTo(target);
          if (range < bestRange) {
            bestRange = range;
            bestTower = tower;
          }
        }

        roomData.repairTarget = target;
        roomData.repairTowerId = bestTower ? bestTower.id : null;
      }
    }

    for (const tower of roomState.towers) {
      roleTower.run(tower, roomData);
    }
  });
}


module.exports = {
  roomHeap,
  setUnderAttack,
  detectAttack,
  isTowerRepairTick,
  runTowerLogic,
};
