/**
 * ===================================================
 * THREAT.JS — единое определение угрозы и скан врагов комнаты
 * ===================================================
 * Раньше defense.manager и башни (room.manager.runTowerLogic / role.tower)
 * определяли угрозу по-разному и сканировали комнату каждый сам:
 *   - defense.manager считал угрозой только тела с ATTACK/RANGED_ATTACK/HEAL
 *     и обновлял список раз в 25 тиков;
 *   - башни били ЛЮБОГО врага и искали врагов каждый тик.
 * Один и тот же тик мог получить разные ответы («тревога есть — башни молчат»
 * и наоборот). Здесь одно определение «боевой угрозы» на весь проект.
 *
 * Набор целей для башен сознательно ШИРЕ определения тревоги: башня обязана
 * реагировать на любого врага в комнате, даже без боевых частей (иначе враг
 * без ATTACK/HEAL беспрепятственно работал бы в комнате). Определение тревоги
 * (кого считать боевой угрозой для высылки атакующего) — одно и то же у
 * defense.manager и у флага underAttack в room.manager.
 * ===================================================
 */

/**
 * Боевая угроза: в теле есть части атаки или лечения.
 * @param {Creep} creep
 * @returns {boolean}
 */
function isCombatHostile(creep) {
  const body = creep.body;
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
 * Башни обязаны сканировать комнату каждый тик (это их реакция на нападение),
 * поэтому результат кладётся в heap-кэш на текущий тик: defense.manager,
 * который выполняется следом, переиспользует список и не делает второй
 * `room.find`. Для комнат без башен (ремоуты) defense.manager — первый и
 * единственный потребитель, там скан просто кэшируется на тик.
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
