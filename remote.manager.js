/**
 * ===================================================
 * MANAGER.REMOTE.JS — Менеджер дальней добычи (заглушка)
 * ===================================================
 * Пока подключена только роль резервера.
 * Дальний майнер и дальний хайлер будут добавлены позже.
 * ===================================================
 */

const roleReserver = require("remote.reserver");

module.exports = {
  run: function () {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (creep.memory.role === "reserver") {
        roleReserver.run(creep);
      }
    }
  },
};
