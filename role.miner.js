/** @param {Creep} creep **/
module.exports = {
  run: function (creep) {
    const source = Game.getObjectById(creep.memory.sourceId);
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source);
    }
    // creep.memory - подсказка в этом месте работает
  },
};
