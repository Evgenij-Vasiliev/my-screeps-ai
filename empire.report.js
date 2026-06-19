module.exports = {
  generate() {
    const ownedRooms = _.filter(
      Game.rooms,
      r => r.controller && r.controller.my,
    );

    const roomInfo = {};

    // ---------- ROOMS ----------
    for (const room of ownedRooms) {
      const storageEnergy = room.storage?.store[RESOURCE_ENERGY] || 0;
      const terminalEnergy = room.terminal?.store[RESOURCE_ENERGY] || 0;

      let storageState = "ok";
      if (storageEnergy < 10000) storageState = "critical";
      else if (storageEnergy < 50000) storageState = "low";

      let terminalState = "normal";
      if (terminalEnergy >= 150000) terminalState = "reserve";

      roomInfo[room.name] = {
        role:
          room.name === "E35S37"
            ? "remoteMiningHub+boostCenter"
            : "generalPurpose",

        storageEnergy,
        terminalEnergy,

        storageState,
        terminalState,

        availableEnergy: room.energyAvailable,
        energyCapacity: room.energyCapacityAvailable,
      };
    }

    // ---------- INFRASTRUCTURE ----------
    const infrastructure = {
      rooms: ownedRooms.length,
      rcl8Rooms: 0,
      factories: 0,
      labs: 0,
      observer: 0,
      nukers: 0,
      totalEnergy: 0,
    };

    for (const room of ownedRooms) {
      if (room.controller.level === 8) {
        infrastructure.rcl8Rooms++;
      }

      infrastructure.factories += room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_FACTORY,
      }).length;

      infrastructure.labs += room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LAB,
      }).length;

      infrastructure.observer += room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_OBSERVER,
      }).length;

      infrastructure.nukers += room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_NUKER,
      }).length;

      if (room.storage) {
        infrastructure.totalEnergy += room.storage.store[RESOURCE_ENERGY] || 0;
      }
    }

    // ---------- READINESS ----------
    const readiness = {
      energyStability: "ok",
      weakRooms: 0,
      criticalRooms: 0,
      overflowRooms: 0,
    };

    for (const r of Object.values(roomInfo)) {
      if (r.storageState === "critical") readiness.criticalRooms++;
      if (r.storageState === "low" || r.storageState === "critical") {
        readiness.weakRooms++;
      }
      if (r.terminalState === "reserve") readiness.overflowRooms++;
    }

    if (readiness.criticalRooms >= 2) {
      readiness.energyStability = "unstable";
    } else if (readiness.weakRooms >= 2) {
      readiness.energyStability = "fragile";
    }

    // // ---------- ENERGY FLOW (FIXED) ----------
    // const energyFlow = [];

    // const consumers = Object.entries(roomInfo)
    //   .filter(
    //     ([_, r]) => r.storageState === "critical" || r.storageState === "low",
    //   )
    //   .map(([name]) => name);

    // for (const [fromName, fromRoom] of Object.entries(roomInfo)) {
    //   const isDonor = fromRoom.terminalState === "reserve";

    //   if (!isDonor) continue;

    //   if (consumers.length === 0) continue;

    //   const target = consumers.find(c => c !== fromName) || consumers[0];

    //   energyFlow.push({
    //     from: fromName,
    //     to: target,
    //     type: "energy_rebalance",
    //   });
    // }

    // ---------- RETURN ----------
    return {
      vision: {
        goal: "Построение полностью управляемой империи на основе AUTO/CONTROL",
        currentFocus: "Стабилизация базовых систем и развитие CONTROL слоя",
      },

      architecture: {
        spawnSystem: "quota",
        minerAssignment: "fixed spots",
        remoteMining: true,
        labs: true,
      },

      state: {
        tick: Game.time,
        rooms: ownedRooms.length,
        creeps: Object.keys(Game.creeps).length,
        cpuBucket: Game.cpu.bucket,
      },

      infrastructure,
      readiness,
      // energyFlow,

      rooms: roomInfo,
      issues: [],
    };
  },
};
