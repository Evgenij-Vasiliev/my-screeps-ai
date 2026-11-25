/**
 * ===================================================
 * DEFENSE.MANAGER.JS — менеджер обороны империи
 * ===================================================
 * Перенесено из origin/Новая-Империя:defense.manager.js с двумя адаптациями
 * под текущую ветку:
 *
 *   1) списки комнат и TTL берутся из constants.js (DEFENSE), а не из
 *      shard.state.js: в текущей ветке нет Memory.empire и дальнего контура,
 *      которому он нужен;
 *   2) роль атакующего НЕ запускается отсюда. В Harness-Empire единственный
 *      диспетчер ролей — room.manager.js (карта ROLES + roomState.creeps).
 *      Второй цикл по крипам в defense.manager был бы вторым диспетчером и
 *      нарушал бы архитектурное правило. Здесь только датчик: скан комнат и
 *      Memory.attackAlert, на который реагирует role.attacker.js.
 *
 * Что делает:
 *   - собирает свои комнаты и видимые комнаты из DEFENSE.REMOTE_SCAN_ROOMS
 *     (зрение даёт observer.manager.js);
 *   - комнаты повышенного риска (DEFENSE.HIGH_RISK_ROOMS) проверяет первыми;
 *   - кэширует список врагов комнаты на DEFENSE.CACHE_TTL тиков, чтобы не
 *     делать room.find в каждой комнате каждый тик;
 *   - боевые враги (threat.isCombatHostile) или InvaderCore поднимают
 *     Memory.attackAlert;
 *   - если тревожная комната видна и врагов в ней нет — тревога снимается
 *     сразу; если комната пропала из видимости — держится DEFENSE.ALERT_TTL
 *     тиков, чтобы не потерять действующий бой.
 *
 * Тревога одна на империю (Memory.attackAlert) — так было во всех старых
 * ветках. Ограничение известно: при двух одновременных атаках все атакующие
 * едут в первую проверенную комнату (audit docs/ASSESSMENT-2026-09-26.md:341).
 * Свои комнаты при этом продолжают держать башни.
 * ===================================================
 */

const { DEFENSE } = require("./constants");
const { isCombatHostile, getHostiles } = require("./threat");

module.exports = {
  run: function () {
    const highRiskRooms = DEFENSE.HIGH_RISK_ROOMS;
    const remoteScanRooms = DEFENSE.REMOTE_SCAN_ROOMS;

    // Свои комнаты
    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my,
    );

    // Видимые дальние комнаты (зрение есть, только если там наш крип или
    // обсервер смотрел её в прошлом тике)
    const remoteRooms = remoteScanRooms
      .map(name => Game.rooms[name])
      .filter(Boolean);

    // Объединяем без дублей
    const allRooms = [...ourRooms];
    for (const r of remoteRooms) {
      if (!allRooms.find(x => x.name === r.name)) allRooms.push(r);
    }

    // Комнаты повышенного риска проверяем первыми
    const sorted = allRooms.sort((a, b) => {
      const aRisk = highRiskRooms.includes(a.name) ? 0 : 1;
      const bRisk = highRiskRooms.includes(b.name) ? 0 : 1;
      return aRisk - bRisk;
    });

    let threatFound = false;
    // Комнаты, реально просканированные в этом тике (до break). Нужны, чтобы
    // отличить «врагов нет» от «комнаты не видно».
    const scannedRooms = [];

    for (const room of sorted) {
      scannedRooms.push(room.name);

      // global-кэш обороны: самособирается после Global Reset.
      if (!global._defenseCache) global._defenseCache = {};
      if (!global._defenseCache[room.name]) {
        global._defenseCache[room.name] = {};
      }
      const cache = global._defenseCache[room.name];

      // Обновляем ядро и список врагов раз в DEFENSE.CACHE_TTL тиков.
      // Условие по updatedAt, а не по `Game.time % 25 === 0`: сразу после
      // Global Reset кэш пуст, и на «нечётном» тике оборона оставалась бы
      // слепой до следующего кратного 25 тика.
      if (
        !Array.isArray(cache.hostileCreepIds) ||
        Game.time - (cache.updatedAt || 0) >= DEFENSE.CACHE_TTL
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

      // Угроза — боевые враги. Определение одно на проект
      // (threat.isCombatHostile); башни при этом бьют любого врага.
      const hostiles = hostileCreepIds
        .map(id => Game.getObjectById(id))
        .filter(c => c && isCombatHostile(c));

      if (hostiles.length > 0) {
        Memory.attackAlert = { room: room.name, time: Game.time };
        threatFound = true;
        break;
      }

      // Ядра захватчиков в удалённых комнатах
      const invaderCore = cache.invaderCoreId
        ? Game.getObjectById(cache.invaderCoreId)
        : null;

      if (invaderCore) {
        Memory.attackAlert = { room: room.name, time: Game.time };
        threatFound = true;
        break;
      }
    }

    // Снятие тревоги. Тревога НЕ снимается, если тревожная комната просто
    // пропала из видимости: крип ушёл/погиб, а бой мог продолжаться.
    if (!threatFound && Memory.attackAlert) {
      const alert = Memory.attackAlert;
      const alertRoomScanned =
        typeof alert.room === "string" &&
        scannedRooms.indexOf(alert.room) !== -1;
      const alertAge = Game.time - (alert.time || 0);

      if (alertRoomScanned || alertAge >= DEFENSE.ALERT_TTL) {
        delete Memory.attackAlert;
      }
    }
  },
};
