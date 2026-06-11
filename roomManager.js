/**
 * МЕНЕДЖЕР КОМНАТ (Room Manager)
 * Единая точка входа для работы с любым количеством комнат игрока.
 * Создаёт и хранит объект состояния (roomState) для каждой комнаты.
 */
const { getRoomRole } = require("roomRoles");

module.exports = {
  /**
   * Возвращает массив всех комнат, принадлежащих игроку.
   * Автоматически обнаруживает новые комнаты без изменения кода.
   * @returns {Room[]}
   */
  getOwnedRooms: function () {
    return Object.values(Game.rooms).filter(
      room => room.controller && room.controller.my,
    );
  },

  /**
   * Строит объект состояния для одной комнаты.
   * Все дальнейшие модули работают через этот объект — не через Game.rooms напрямую.
   *
   * Структура roomState:
   * {
   *   room        — ссылка на объект Room
   *   roomName    — имя комнаты (строка)
   *   role        — специализация комнаты (константа из ROOM_ROLES)
   *   spawn       — первый доступный спавн комнаты (или null)
   *   spawns      — все спавны комнаты
   *   controller  — контроллер комнаты
   *   storage     — хранилище (Storage) или null
   *   terminal    — терминал или null
   *   towers      — массив башен
   *   creeps      — все крипы, приписанные к этой комнате
   *   sources     — источники энергии (подготовлено для расширения)
   *   containers  — контейнеры (подготовлено для расширения)
   *   links       — линки (подготовлено для расширения)
   *   labs        — лаборатории (подготовлено для расширения)
   * }
   *
   * @param {Room} room
   * @returns {Object} roomState
   */
  buildRoomState: function (room) {
    const structures = room.find(FIND_MY_STRUCTURES);

    // Группируем структуры за один проход по массиву
    const spawns = [];
    const towers = [];
    const links = [];
    const labs = [];

    for (const s of structures) {
      switch (s.structureType) {
        case STRUCTURE_SPAWN:
          spawns.push(s);
          break;
        case STRUCTURE_TOWER:
          towers.push(s);
          break;
        case STRUCTURE_LINK:
          links.push(s);
          break;
        case STRUCTURE_LAB:
          labs.push(s);
          break;
      }
    }

    // Контейнеры — не owned-структуры, ищем отдельно
    const containers = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER,
    });

    // Источники энергии
    const sources = room.find(FIND_SOURCES);

    // Крипы, приписанные к данной комнате
    const creeps = Object.values(Game.creeps).filter(
      c => c.memory.homeRoom === room.name || c.room.name === room.name,
    );

    return {
      room,
      roomName: room.name,
      role: getRoomRole(room), // специализация из памяти комнаты
      spawn: spawns[0] || null, // основной спавн (для спавн-утилиты)
      spawns,
      controller: room.controller,
      storage: room.storage || null,
      terminal: room.terminal || null,
      towers,
      creeps,
      sources,
      containers,
      links,
      labs,
    };
  },

  /**
   * Главный метод цикла.
   * Возвращает массив roomState для всех собственных комнат.
   * Вызывается один раз за тик из main.js.
   * @returns {Object[]} массив roomState
   */
  buildAllRoomStates: function () {
    return this.getOwnedRooms().map(room => this.buildRoomState(room));
  },
};
