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
const { isCombatHostile, getHostiles } = require("threat");
// Комнаты повышенного риска — проверяются первыми
const HIGH_RISK_ROOMS = ["E36S37", "E35S38"];

// Комнаты дальней добычи, которые нужно проверять на угрозы
const REMOTE_SCAN_ROOMS = ["E36S37", "E35S38"];

// Как часто (тиков) обновлять в комнате список вражеских крипов и ядро.
const DEFENSE_CACHE_TTL = 25;

// Сколько тиков держать Memory.attackAlert, если комната тревоги пропала из
// видимости (крип ушёл/погиб) и проверить её в этом тике нечем.
const ATTACK_ALERT_TTL = 50;

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
    // Комнаты, которые реально просканированы в этом тике (до break). Нужны,
    // чтобы отличить «врагов нет» от «комнаты не видно».
    const scannedRooms = [];

    for (const room of sorted) {
      scannedRooms.push(room.name);

      // Инициализация глобального кэша обороны (самопосборка после Global Reset)
      if (!global._defenseCache) global._defenseCache = {};
      if (!global._defenseCache[room.name]) global._defenseCache[room.name] = {};
      const cache = global._defenseCache[room.name];

      // Обновляем Core и список вражеских крипов раз в DEFENSE_CACHE_TTL тиков.
      // Условие по updatedAt, а не по `Game.time % 25 === 0`: сразу после
      // Global Reset кэш пуст, и на «нечётном» тике оборона оставалась слепой
      // до следующего кратного 25 тика (до 25 тиков без тревоги и без
      // самозащиты атакующего). Теперь кэш наполняется при первом же заходе.
      if (
        !Array.isArray(cache.hostileCreepIds) ||
        Game.time - (cache.updatedAt || 0) >= DEFENSE_CACHE_TTL
      ) {
        const core = room.find(FIND_HOSTILE_STRUCTURES, {
          filter: s => s.structureType === STRUCTURE_INVADER_CORE,
        });

        cache.invaderCoreId = core.length ? core[0].id : null;

        // Единый скан врагов (threat.getHostiles): если башни уже сканировали
        // комнату в этом тике, список переиспользуется — второго room.find нет.
        cache.hostileCreepIds = getHostiles(room).map(c => c.id);
        cache.updatedAt = Game.time;
      }

      const hostileCreepIds = Array.isArray(cache.hostileCreepIds)
        ? cache.hostileCreepIds
        : [];

      // Угроза — боевые враги. Определение одно на проект (threat.isCombatHostile):
      // то же самое использует флаг underAttack в room.manager.
      const hostiles = hostileCreepIds
        .map(id => Game.getObjectById(id))
        .filter(c => c && isCombatHostile(c));

      if (hostiles.length > 0) {
        Memory.attackAlert = { room: room.name, time: Game.time };
        threatFound = true;
        break;
      }

      // Ищем ядра захватчиков в удалённых комнатах
      const invaderCoreId = cache.invaderCoreId || null;

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

    // Инициализация глобального кэша (самопосборка после Global Reset)
    if (!global._attackerNamesCache) {
      global._attackerNamesCache = [];
      global._attackerNamesCacheCount = 0;
      global._attackerNamesCacheUpdatedAt = 0;
    }

    const creepNames = Object.keys(Game.creeps);
    if (
      !global._attackerNamesCache ||
      global._attackerNamesCacheCount !== creepNames.length ||
      Game.time - (global._attackerNamesCacheUpdatedAt || 0) >
        ATTACKER_CACHE_MAX_AGE
    ) {
      global._attackerNamesCache = creepNames.filter(
        name => Game.creeps[name].memory.role === "attacker",
      );
      global._attackerNamesCacheCount = creepNames.length;
      global._attackerNamesCacheUpdatedAt = Game.time;
    }

    for (const name of global._attackerNamesCache) {
      const creep = Game.creeps[name];
      if (creep) {
        attacker.run(creep);
      }
    }

    // Снятие тревоги. Раньше она удалялась при первом же тике, в котором
    // угроз «не нашли», — в том числе когда комната тревоги просто пропала из
    // видимости (крип ушёл/погиб). Атакующий разворачивался, хотя бой мог
    // продолжаться. Теперь:
    //   - комната тревоги видна и врагов в ней нет — снимаем сразу;
    //   - комната пропала из видимости — держим до ATTACK_ALERT_TTL тиков,
    //     чтобы не потерять действующую тревогу ошибочно.
    if (!threatFound && Memory.attackAlert) {
      const alert = Memory.attackAlert;
      const alertRoomScanned =
        typeof alert.room === "string" &&
        scannedRooms.indexOf(alert.room) !== -1;
      const alertAge = Game.time - (alert.time || 0);

      if (alertRoomScanned || alertAge >= ATTACK_ALERT_TTL) {
        delete Memory.attackAlert;
      }
    }
  },
};
