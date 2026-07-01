/**
 * ===================================================
 * ROOM.REMOTE.JS — Константы удалённых комнат
 * ===================================================
 * Отвечает ТОЛЬКО за хранение констант дальней добычи.
 * Стратегический сканер угроз перенесён в empire.js
 */

const REMOTE_ROOMS = ["E35S38", "E36S37"];

const REMOTE_ROLES = new Set([
  "remoteMiner",
  "remoteHauler",
  "reserver",
  "attacker",
]);

module.exports = {
  REMOTE_ROOMS,
  REMOTE_ROLES,
  // Метод run() удалён, так как логика перешла под контроль Империи
};
