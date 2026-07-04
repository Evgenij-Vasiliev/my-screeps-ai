const empire = require("empire");
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

      // -----------------------------
      // STATE (CONTROLLED BY EMPIRE)
      // -----------------------------

      let storageState = "ok";

      if (storageEnergy < empire.energy.poorThreshold) {
        storageState = "critical";
      } else if (storageEnergy < empire.energy.energyPoorThreshold) {
        // ИСПРАВЛЕНО: empire.energy.lowThreshold не существовал в
        // empire.js — сравнение с undefined всегда было false, эта
        // ветка была мёртвым кодом. Переиспользуем существующую
        // политику energyPoorThreshold (уже используется в
        // empire._processEnergyBalance для того же смысла: "мало").
        storageState = "low";
      }

      let terminalState = "normal";

      if (terminalEnergy >= empire.energy.terminalMax) {
        // ИСПРАВЛЕНО: empire.energy.terminalReserveThreshold не
        // существовал — ветка была мёртвым кодом. Переиспользуем
        // уже задекларированный потолок terminalMax: если terminal
        // достиг или превысил заявленный потолок — это буквально
        // и есть состояние "reserve"/переполнение (см. Конфликт №2
        // отчёта по ТЗ №24 — этот потолок нигде не исполняется
        // технически, но здесь хотя бы отражается в отчёте).
        terminalState = "reserve";
      }

      // -----------------------------
      // ROOM INFO
      // -----------------------------

      roomInfo[room.name] = {
        role: room.controller.level === 8 ? "rcl8" : "generalPurpose",

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

    if (readiness.criticalRooms >= empire.readiness.criticalRoomThreshold) {
      // ИСПРАВЛЕНО: empire.energy.criticalRoomThreshold не существовал
      // (правильная секция — empire.readiness, добавлена отдельно).
      readiness.energyStability = "unstable";
    } else if (readiness.weakRooms >= empire.readiness.weakRoomThreshold) {
      readiness.energyStability = "fragile";
    }

    // ---------- RETURN ----------
    return {
      vision: empire.vision,

      architecture: {
        spawnSystem: "quota",
        minerAssignment: "fixed spots",
        // ИСПРАВЛЕНО: было захардкожено remoteMining:true, labs:true.
        // labs:true прямо противоречило empire.labs.enabled=false —
        // отчёт заявлял о работающих лабораториях, которых в
        // кодовой базе нет вообще ни одного файла (аудит ТЗ №24).
        // Теперь оба поля берутся из единственного источника политик.
        remoteMining: empire.remoteMining.enabled,
        labs: empire.labs.enabled,
      },

      state: {
        tick: Game.time,
        rooms: ownedRooms.length,
        creeps: Object.keys(Game.creeps).length,
        cpuBucket: Game.cpu.bucket,
      },

      infrastructure,
      readiness,

      rooms: roomInfo,
      issues: [],
    };
  },
};
