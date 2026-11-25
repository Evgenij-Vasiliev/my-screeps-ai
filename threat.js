/**
 * ===================================================
 * THREAT.JS — единое определение боевой угрозы и скан врагов комнаты
 * ===================================================
 * Перенесено из origin/Новая-Империя:threat.js. В старой ветке модуль решал
 * две разные задачи, и обе нужны здесь:
 *
 *   1) isCombatHostile — кого считать БОЕВОЙ угрозой для тревоги
 *      (Memory.attackAlert) и высылки атакующего. Это тело с ATTACK,
 *      RANGED_ATTACK или HEAL.
 *   2) getHostiles — ОДИН room.find(FIND_HOSTILE_CREEPS) на комнату за тик
 *      с heap-кэшем. defense.manager сканирует комнаты, room.manager — башни;
 *      без общего кэша один и тот же тик делал бы два скана одной комнаты.
 *
 * Набор целей БАШЕН сознательно шире: башня обязана бить любого врага, даже
 * без боевых частей (иначе враг без ATTACK/HEAL беспрепятственно работал бы
 * в комнате). Определение тревоги уже: не-боевой крип не высылает атакующего,
 * но башни его видят и атакуют.
 * ===================================================
 */

/**
 * Боевая угроза: в теле есть части атаки или лечения.
 * @param {Creep} creep
 * @returns {boolean}
 */
function isCombatHostile(creep) {
  const body = creep && creep.body;
  if (!body) return false;
  for (let i = 0; i < body.length; i++) {
    const type = body[i].type;
    if (type === ATTACK || type === RANGED_ATTACK || type === HEAL) {
      return true;
    }
  }
  return false;
}

/**
 * Единый скан вражеских крипов комнаты на тик.
 *
 * Результат кладётся в heap и живёт ровно тик (ключ — Game.time): объекты
 * Game между тиками хранить нельзя. Для комнат без башен (дальние комнаты)
 * defense.manager — первый и единственный потребитель, там скан просто
 * кэшируется на тик. Для своих комнат порядок вызовов — defense.manager
 * раньше room.manager (empire.js), поэтому башни переиспользуют список.
 *
 * @param {Room} room
 * @returns {Creep[]}
 */
function getHostiles(room) {
  if (!global._hostileScan) global._hostileScan = {};
  const cached = global._hostileScan[room.name];
  if (cached && cached.tick === Game.time) return cached.creeps;
  const creeps = room.find(FIND_HOSTILE_CREEPS);
  global._hostileScan[room.name] = { tick: Game.time, creeps };
  return creeps;
}

module.exports = { isCombatHostile, getHostiles };
