/**
 * ===================================================
 * DEFENSE.MANAGER.JS — Менеджер обороны
 * ===================================================
 * Обнаруживает угрозы (вражеских боевых крипов и Invader Core)
 * в своих комнатах и в комнатах дальней добычи, выставляет
 * Memory.attackAlert, на который реагирует role.attacker.js.
 * ===================================================
 */
const attacker = require("defense.attacker");
// Комнаты повышенного риска — проверяются первыми
const HIGH_RISK_ROOMS = ["E36S37", "E35S38"];

// Комнаты дальней добычи, которые нужно проверять на угрозы
const REMOTE_SCAN_ROOMS = ["E36S37", "E35S38"];

module.exports = {
  run: function () {
    // Свои комнаты
    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my,
    );

    // Видимые ремоут-комнаты (видимость есть, только если там наш крип)
    const remoteRooms = REMOTE_SCAN_ROOMS.map(name => Game.rooms[name]).filter(
      Boolean,
    );

    // Объединяем без дублей
    const allRooms = [...ourRooms];
    for (const r of remoteRooms) {
      if (!allRooms.find(x => x.name === r.name)) allRooms.push(r);
    }

    // Комнаты повышенного риска проверяем первыми
    const sorted = allRooms.sort((a, b) => {
      const aRisk = HIGH_RISK_ROOMS.includes(a.name) ? 0 : 1;
      const bRisk = HIGH_RISK_ROOMS.includes(b.name) ? 0 : 1;
      return aRisk - bRisk;
    });

    let threatFound = false;

    for (const room of sorted) {
      // Ищем опасных врагов (с деталями атаки или лечения)
      const cache = Memory.rooms[room.name] || (Memory.rooms[room.name] = {});

      if (!cache.defenseCache) cache.defenseCache = {};
      // Обновляем Core и список вражеских крипов раз в 25 тиков
      if (Game.time % 25 === 0) {
        const core = room.find(FIND_HOSTILE_STRUCTURES, {
          filter: s => s.structureType === STRUCTURE_INVADER_CORE,
        });

        cache.defenseCache.invaderCoreId = core.length ? core[0].id : null;

        const hostileCreeps = room.find(FIND_HOSTILE_CREEPS);
        cache.defenseCache.hostileCreepIds = hostileCreeps.map(c => c.id);
      }
      const hostileCreepIds =
        cache &&
        cache.defenseCache &&
        Array.isArray(cache.defenseCache.hostileCreepIds)
          ? cache.defenseCache.hostileCreepIds
          : [];

      const hostiles = hostileCreepIds
        .map(id => Game.getObjectById(id))
        .filter(
          c =>
            c &&
            c.body.some(
              b =>
                b.type === ATTACK ||
                b.type === RANGED_ATTACK ||
                b.type === HEAL,
            ),
        );

      if (hostiles.length > 0) {
        Memory.attackAlert = { room: room.name, time: Game.time };
        threatFound = true;
        break;
      }

      // Ищем ядра захватчиков в удалённых комнатах
      const invaderCoreId =
        cache && cache.defenseCache ? cache.defenseCache.invaderCoreId : null;

      const invaderCore = invaderCoreId
        ? Game.getObjectById(invaderCoreId)
        : null;

      if (invaderCore) {
        Memory.attackAlert = { room: room.name, time: Game.time };
        threatFound = true;
        break;
      }
    }

    const ATTACKER_CACHE_MAX_AGE = 50; // тиков — максимум устаревания кэша

    const creepNames = Object.keys(Game.creeps);
    if (
      !Memory.attackerNamesCache ||
      Memory.attackerNamesCacheCount !== creepNames.length ||
      Game.time - (Memory.attackerNamesCacheUpdatedAt || 0) >
        ATTACKER_CACHE_MAX_AGE
    ) {
      Memory.attackerNamesCache = creepNames.filter(
        name => Game.creeps[name].memory.role === "attacker",
      );
      Memory.attackerNamesCacheCount = creepNames.length;
      Memory.attackerNamesCacheUpdatedAt = Game.time;
    }

    for (const name of Memory.attackerNamesCache) {
      const creep = Game.creeps[name];
      if (creep) {
        attacker.run(creep);
      }
    }

    // Если угроз нигде нет в этом тике — снимаем тревогу
    if (!threatFound && Memory.attackAlert) {
      delete Memory.attackAlert;
    }
  },
};
