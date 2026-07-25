const workerRunner = require("worker.runner");

const taskManager = {
  /**
   * Управление задачами воркеров в комнате
   * @param {Object} roomState
   */
  run: function (roomState) {
    if (!roomState) return;

    // Находим всех воркеров этой комнаты (используем уже собранный список)
    const workers = roomState.creeps.filter(
      creep => creep.memory.role === "worker" && !creep.spawning,
    );

    for (const creep of workers) {
      // Передаем и creep, и roomState в runner
      workerRunner.run(creep, roomState);
    }
  },
};

module.exports = taskManager;
