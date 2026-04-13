/**
 * ЛОГИКА МАЙНЕРА (Static Miner)
 * @param {Creep} creep
 **/
module.exports = {
  run: function (creep) {
    // 1. ПОИСК ЦЕЛИ
    // Достаем источник из памяти по ID.
    // ID туда запишет Spawn в момент рождения (мы это настроим в main.js)
    const source = Game.getObjectById(creep.memory.sourceId);
    if (!source) return; // Если источник не виден — ничего не делаем

    // 2. ПОИСК ПОЗИЦИИ (Контейнера)
    // Ищем контейнер в радиусе 1 клетки от источника
    const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER,
    })[0]; // Берем первый найденный из списка

    // 3. ЛОГИКА ПЕРЕМЕЩЕНИЯ И ДОБЫЧИ
    if (container) {
      // Если контейнер есть, майнер должен стоять СТРОГО на нем
      if (!creep.pos.isEqualTo(container.pos)) {
        // Идем точно на координаты контейнера
        creep.moveTo(container, { visualizePathStyle: { stroke: "#ffaa00" } });
      } else {
        // Мы на месте! Просто копаем. Энергия сама упадет в контейнер под нами
        creep.harvest(source);
      }
    } else {
      // Если строители еще не закончили контейнер — просто копаем рядом
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source);
      }
    }
  },
};
