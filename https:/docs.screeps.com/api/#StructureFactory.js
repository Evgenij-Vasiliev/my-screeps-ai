/**
 * ===================================================
 * ROOMMANAGER.JS — Менеджер комнат
 * ===================================================
 * ИСПРАВЛЕНО v10:
 * - terminalUnloader спавнится когда есть terminalNeeds
 *   (включая "_sell_" запросы от terminalManager)
 * ===================================================
 */

const factory = require("./factory");
const roleTower = require("./role.tower");
const terminalManager = require("./terminalManager");
const linkManager = require("./role.linkManager");
const labManager = require("./role.labManager");

const REMOTE_ROOMS = ["E35S38", "E36S37"];
const OBSERVER_ROOM = "E36S38";
const NUKER_ROOM = "E37S37";

const TERMINAL_ENERGY_OVERFLOW = 50000;
const STORAGE_ENERGY_MIN = 10000;

const EARLY_SPAWN_ROLES = {
  test_miner: { travelBuffer: 10 },
  test_remoteMiner: { travelBuffer: 80 },
};

const FIXED_SOURCE_ROLES = new Set([
  "test_hauler",
  "test_miner",
  "test_harvester",
]);
const REMOTE_ROLES = new Set([
  "test_remoteMiner",
  "test_remoteHauler",
  "test_reserver",
]);

function getEarlySpawnThreshold(role, travelBuffer, spawn) {
  try {
    const blueprint = factory.blueprints[role]
      ? factory.blueprints[role](spawn, 0, {})
      : null;
    if (blueprint && blueprint.body) {
      return blueprint.body.length * 3 + travelBuffer;
    }
  } catch (e) {}
  return 50 + travelBuffer;
}

function hasLabConfig(room) {
  const mem = room.memory;
  return !!(mem.labs || mem.labs2 || mem.labs3 || mem.labs4 || mem.labs5);
}

function nukerNeedsFilling(room) {
  const nuker = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_NUKER,
  })[0];
  if (!nuker) return false;
  return (
    nuker.store.getFreeCapacity(RESOURCE_ENERGY) > 0 ||
    nuker.store.getFreeCapacity(RESOURCE_GHODIUM) > 0
  );
}

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

const roomManager = {
  run: function (room) {
    // ── 1. ENERGY TARGETS — каждый тик ────────────────────────────────────
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

    // ── 2. БАШНИ — раз в 50 тиков ─────────────────────────────────────────
    if (!room.memory.towers || Game.time % 50 === 0) {
      const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
      });
      room.memory.towers = towers.map(t => t.id);
    }
    room._towers = room.memory.towers
      .map(id => Game.getObjectById(id))
      .filter(Boolean);

    // ── 3. ИСТОЧНИКИ — один раз навсегда ──────────────────────────────────
    if (!room.memory.sources) {
      const sources = room.find(FIND_SOURCES);
      room.memory.sources = sources.map(s => s.id);
    }
    room._sources = room.memory.sources
      .map(id => Game.getObjectById(id))
      .filter(Boolean);

    // ── 4. КОНТЕЙНЕРЫ У ИСТОЧНИКОВ ────────────────────────────────────────
    if (!room.memory.sourceContainers) {
      room.memory.sourceContainers = [];
    }
    room._sourceContainers = [];
    room._sources.forEach((source, index) => {
      let container = null;
      const containerId = room.memory.sourceContainers[index];
      if (containerId) container = Game.getObjectById(containerId);
      if (!container) {
        container =
          source.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
          })[0] || null;
        room.memory.sourceContainers[index] = container ? container.id : null;
      }
      room._sourceContainers[index] = container;
    });

    // ── 5. МИНЕРАЛ — раз в 100 тиков ──────────────────────────────────────
    if (!room.memory.mineralId || Game.time % 100 === 0) {
      const minerals = room.find(FIND_MINERALS);
      room.memory.mineralId = minerals.length > 0 ? minerals[0].id : null;
    }
    const mineral = room.memory.mineralId
      ? Game.getObjectById(room.memory.mineralId)
      : null;
    const mineralAvailable = mineral && mineral.mineralAmount > 0;

    // ── 6. СТРОЙКИ — раз в 100 тиков ──────────────────────────────────────
    if (room.memory.hasSites === undefined || Game.time % 100 === 0) {
      room.memory.hasSites = room.find(FIND_CONSTRUCTION_SITES).length > 0;
    }
    const hasSites = room.memory.hasSites;

    // ── 7. РЕМОНТ — раз в 100 тиков ───────────────────────────────────────
    if (room.memory.needsRepair === undefined || Game.time % 100 === 0) {
      room.memory.needsRepair =
        room.find(FIND_STRUCTURES, {
          filter: s =>
            s.hits < s.hitsMax * 0.8 &&
            s.structureType !== STRUCTURE_WALL &&
            s.structureType !== STRUCTURE_RAMPART,
        }).length > 0;
    }
    const needsRepair = room.memory.needsRepair;

    // ── 8. ПОДСЧЁТ КРИПОВ ─────────────────────────────────────────────────
    const spawnsForThreshold = room.find(FIND_MY_SPAWNS);
    const spawnForThreshold = spawnsForThreshold[0] || null;

    if (!room.memory.earlySpawnThresholds || Game.time % 200 === 0) {
      room.memory.earlySpawnThresholds = {};
      for (const role in EARLY_SPAWN_ROLES) {
        const { travelBuffer } = EARLY_SPAWN_ROLES[role];
        room.memory.earlySpawnThresholds[role] = spawnForThreshold
          ? getEarlySpawnThreshold(role, travelBuffer, spawnForThreshold)
          : 50 + travelBuffer;
      }
    }
    const thresholds = room.memory.earlySpawnThresholds;

    const localGroups = {};
    const globalGroups = {};
    const roomCreeps = [];
    let attackersHere = 0;

    const fixedSourceCount = {};
    for (const role of FIXED_SOURCE_ROLES) {
      fixedSourceCount[role] = {};
      for (let i = 0; i < (room.memory.sources || []).length; i++) {
        fixedSourceCount[role][i] = 0;
      }
    }

    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      const role = creep.memory.role;

      let countAsAlive = true;
      if (thresholds[role] !== undefined && creep.ticksToLive !== undefined) {
        if (creep.ticksToLive < thresholds[role]) countAsAlive = false;
      }

      if (countAsAlive) {
        globalGroups[role] = (globalGroups[role] || 0) + 1;
        if (creep.room.name === room.name) {
          localGroups[role] = (localGroups[role] || 0) + 1;
          roomCreeps.push(creep);
          if (
            FIXED_SOURCE_ROLES.has(role) &&
            creep.memory.sourceIndex !== undefined &&
            fixedSourceCount[role] !== undefined &&
            fixedSourceCount[role][creep.memory.sourceIndex] !== undefined
          ) {
            fixedSourceCount[role][creep.memory.sourceIndex]++;
          }
        }
      } else {
        if (creep.room.name === room.name) roomCreeps.push(creep);
      }

      if (role === "test_attacker" && creep.memory.homeRoom === room.name) {
        attackersHere++;
      }
    }

    // ── 9. КОНФИГУРАЦИЯ РОЛЕЙ ──────────────────────────────────────────────
    const needsUpgrader =
      room.controller && room.controller.ticksToDowngrade < 100000 ? 1 : 0;

    const attackerCount = 1;

    const terminalNonEnergy = room.terminal
      ? Object.entries(room.terminal.store)
          .filter(([r]) => r !== RESOURCE_ENERGY)
          .reduce((sum, [, amt]) => sum + amt, 0)
      : 0;

    const hasTerminalNeeds = (room.memory.terminalNeeds || []).length > 0;

    const terminalEnergyOverflow =
      room.terminal &&
      room.storage &&
      (room.terminal.store[RESOURCE_ENERGY] || 0) > TERMINAL_ENERGY_OVERFLOW &&
      (room.storage.store[RESOURCE_ENERGY] || 0) < STORAGE_ENERGY_MIN;

    const localRolesConfig = [
      // { role: "test_harvester", count: 1 },
      { role: "test_miner", count: 2 },
      // { role: "test_hauler", count: 0 },
      { role: "test_towerSupplier", count: 1 },
      {
        role: "test_terminalUnloader",
        // Спавним если: есть не-энергетические ресурсы в терминале,
        // или есть очередь запросов (включая "_sell_"),
        // или терминал переполнен энергией при пустом storage
        count:
          terminalNonEnergy > 5000 || hasTerminalNeeds || terminalEnergyOverflow
            ? 1
            : 0,
      },
      // { role: "test_builder", count: hasSites ? 2 : 0 },
      // { role: "test_upgrader", count: needsUpgrader },
      // { role: "test_repairer", count: needsRepair ? 1 : 0 },
      {
        role: "test_mineralMiner",
        count:
          mineralAvailable &&
          room.storage &&
          room.storage.store[RESOURCE_ENERGY] > 20000
            ? 2
            : 0,
      },
      {
        role: "test_labWorker",
        count: hasLabConfig(room) ? 1 : 0,
      },
      {
        role: "test_nukerFiller",
        count: room.name === NUKER_ROOM && nukerNeedsFilling(room) ? 1 : 0,
      },
      { role: "test_worker", count: 1 },
    ];

    const globalRolesConfig = [];
    if (room.name === "E35S37") {
      globalRolesConfig.push({ role: "test_reserver", count: 2 });
      globalRolesConfig.push({ role: "test_remoteMiner", count: 2 });
      globalRolesConfig.push({ role: "test_remoteHauler", count: 2 });
    }

    // ── 10. СПАВН ─────────────────────────────────────────────────────────
    const spawns = room.find(FIND_MY_SPAWNS, { filter: s => !s.spawning });
    const spawn = spawns[0];

    if (spawn) {
      if (attackerCount > 0 && attackersHere < attackerCount) {
        const result = factory.run(spawn, { role: "test_attacker" }, 0);
        if (result === OK) {
          room._towers.forEach(tower => roleTower.run(tower));
          return;
        }
      }

      const fullConfig = [...localRolesConfig, ...globalRolesConfig];

      for (const roleData of fullConfig) {
        const isGlobal = globalRolesConfig.some(r => r.role === roleData.role);
        const currentCount = isGlobal
          ? globalGroups[roleData.role] || 0
          : localGroups[roleData.role] || 0;

        if (currentCount < roleData.count) {
          let bestIndex;

          if (FIXED_SOURCE_ROLES.has(roleData.role)) {
            const counts = fixedSourceCount[roleData.role] || {};
            bestIndex = Number(
              Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0],
            );
          } else {
            const sourceUsage = {};
            room._sources.forEach((_, i) => {
              sourceUsage[i] = 0;
            });
            roomCreeps.forEach(c => {
              if (
                c.memory.sourceIndex !== undefined &&
                sourceUsage[c.memory.sourceIndex] !== undefined
              ) {
                sourceUsage[c.memory.sourceIndex]++;
              }
            });
            bestIndex = Number(
              Object.entries(sourceUsage).sort((a, b) => a[1] - b[1])[0][0],
            );
          }

          if (REMOTE_ROLES.has(roleData.role)) {
            const taken = Object.values(Game.creeps)
              .filter(
                c =>
                  c.memory.role === roleData.role &&
                  (c.memory.target || c.memory.targetRoom),
              )
              .map(c => c.memory.target || c.memory.targetRoom);
            roleData.targetRoom =
              REMOTE_ROOMS.find(r => !taken.includes(r)) || REMOTE_ROOMS[0];
          }

          const result = factory.run(spawn, roleData, bestIndex);
          if (result === OK) break;
        }
      }
    }

    // ── Продажа ресурсов ───────────────────────────────────────────────────
    terminalManager.run(room);

    // ── ЛИНКИ ─────────────────────────────────────────────────────────────
    linkManager.run(room);

    // ── ЛАБЫ ──────────────────────────────────────────────────────────────
    labManager.run(room);

    // ── OBSERVER — только в комнате E36S38 ────────────────────────────────
    if (room.name === OBSERVER_ROOM) {
      runObserver(room);
    }

    // ── 11. БАШНИ ─────────────────────────────────────────────────────────
    room._towers.forEach(tower => roleTower.run(tower));
  },
};

module.exports = roomManager;
