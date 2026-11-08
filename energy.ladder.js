// Лестница энергии: включён ли потребитель по энергии в хранилище комнаты.
// Пороги — ENERGY_LADDER в constants.js. Состояние (гистерезис) хранится в
// Memory.rooms[<комната>].energyLadder[<потребитель>].
const { STORAGE, ENERGY_LADDER } = require("./constants");

function isEnabled(room, name) {
  const rule = ENERGY_LADDER[name];
  if (!rule || !room.storage) return false;

  const energy = room.storage.store[RESOURCE_ENERGY] || 0;
  if (!Memory.rooms) Memory.rooms = {};
  const mem = Memory.rooms[room.name] || (Memory.rooms[room.name] = {});
  const state = mem.energyLadder || (mem.energyLadder = {});

  if (energy >= STORAGE.ENERGY_MIN * rule.on) state[name] = true;
  else if (energy < STORAGE.ENERGY_MIN * rule.off) state[name] = false;

  return state[name] === true;
}

module.exports = { isEnabled };
