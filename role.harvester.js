const energySource = require("energySource");

// ── ДЕШЁВЫЙ КОРОТКИЙ ХОД ─────────────────────────────────────────────────
// Замеры на шарде (17.09.2026): один вызов PathFinder.search стоит 0.04–0.11
// CPU ПОЧТИ НЕЗАВИСИМО от длины и сложности пути — даже «пустой» поиск, когда
// цель уже в радиусе, обошёлся в 0.043 CPU, а путь на 25 клеток прошёл всего
// за 33 операции. Основная цена — сам нативный вызов, а не обход клеток.
// Один шаг creep.move стоит почти ноль.
// Харвестер — курьер: он ходит по базе короткими перебежками
// (storage ↔ спавны/расширения), поэтому на дистанции 1–2 клетки шагаем
// напрямую, а к Traveler обращаемся только когда прямой шаг невозможен.
// Важно: у creep.move НЕТ ошибки «клетка занята» (возвращает только
// OK | ERR_NOT_OWNER | ERR_BUSY | ERR_TIRED | ERR_NO_BODYPART), поэтому
// застревание считаем сами — по позиции в heap-состоянии (без записи в Memory).
const DIRECT_MOVE_RANGE = 2;
const DIRECT_MOVE_STUCK_LIMIT = 2;

if (!global._harvesterMove) global._harvesterMove = {};

/**
 * Ведёт крипа к цели: дешёвым прямым шагом на короткой дистанции,
 * через Traveler — во всех остальных случаях.
 * @param {Creep} creep
 * @param {any} target объект с .pos (структура/крип/источник) либо RoomPosition
 */
function moveTo(creep, target) {
  /** @type {RoomPosition} */
  const targetPos = target.pos || target;
  const range = creep.pos.getRangeTo(targetPos);

  // Уже в радиусе действия — шаг не нужен (действие выполнит вызывающий код).
  if (range <= 1) {
    return;
  }

  if (range <= DIRECT_MOVE_RANGE) {
    const state = global._harvesterMove;
    const prev = state[creep.name];

    if (prev && prev.x === creep.pos.x && prev.y === creep.pos.y) {
      // Стоим на месте (устал или клетка занята) — считаем попытки.
      prev.stuck++;
    } else {
      state[creep.name] = { x: creep.pos.x, y: creep.pos.y, stuck: 0 };
    }

    if (state[creep.name].stuck < DIRECT_MOVE_STUCK_LIMIT) {
      creep.move(creep.pos.getDirectionTo(targetPos));
      return;
    }
  }

  // Не короткая дистанция или прямой шаг не проходит — отдаём Traveler.
  delete global._harvesterMove[creep.name];
  creep.travelTo(target);
}

module.exports = {
  run: function (creep, roomState) {
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    if (creep.memory.working === false && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false;
    }

    if (!creep.memory.working) {
      const withdrewFromStorage = energySource.withdrawFromStorage(
        creep,
        true,
        moveTo,
      );

      if (withdrewFromStorage) {
        return;
      }

      // NB: ветки терминала здесь нет намеренно — withdrawFromStorage()
      // уже забирает энергию из терминала, когда storage пуст.

      let source = null;

      if (creep.memory.sourceId) {
        source = Game.getObjectById(creep.memory.sourceId);
        if (!source || source.energy === 0) {
          source = null;
          delete creep.memory.sourceId;
        }
      }

      if (!source) {
        let minRange = Infinity;
        for (let i = 0; i < roomState.sources.length; i++) {
          const s = roomState.sources[i];
          if (s.energy > 0) {
            const range = creep.pos.getRangeTo(s);
            if (range < minRange) {
              minRange = range;
              source = s;
            }
          }
        }
        if (source) {
          creep.memory.sourceId = source.id;
        }
      }

      if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
          moveTo(creep, source);
        }
      }
      return;
    }

    let target = null;

    if (creep.memory.targetId) {
      target = Game.getObjectById(creep.memory.targetId);
      if (!target || target.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        target = null;
        delete creep.memory.targetId;
      }
    }

    if (!target) {
      let minRange = Infinity;

      for (let i = 0; i < roomState.extensions.length; i++) {
        const s = roomState.extensions[i];
        if (s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          const range = creep.pos.getRangeTo(s);
          if (range < minRange) {
            minRange = range;
            target = s;
          }
        }
      }

      if (!target) {
        minRange = Infinity;
        for (let i = 0; i < roomState.spawns.length; i++) {
          const s = roomState.spawns[i];
          if (s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            const range = creep.pos.getRangeTo(s);
            if (range < minRange) {
              minRange = range;
              target = s;
            }
          }
        }
      }

      if (target) {
        creep.memory.targetId = target.id;
      }
    }

    if (target) {
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        moveTo(creep, target);
      }
    }
  },
};
