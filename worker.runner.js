const taskExecutors = require("taskExecutors");
const energySource = require("energySource");

const TASK_CHAIN = [
  "fillSpawnsExtensions",
  // "fillTerminals",
  // "operateFactory",
  // "repairStructures",
  // "buildStructures",
  // "fillTowers",
  // "upgradeController",
];

const SAY_LABELS = {
  fillSpawnsExtensions: "spawn",
  // fillTerminals: "terminal",
  // operateFactory: "factory",
  // repairStructures: "repair",
  // buildStructures: "build",
  fillTowers: "tower",
  // upgradeController: "upgrade",
};

module.exports = {
  run: function (creep) {
    if (creep.memory.taskIndex === undefined) {
      creep.memory.taskIndex = 0;
    }

    const currentTaskName = TASK_CHAIN[creep.memory.taskIndex];

    // Энергия закончилась — переходим к следующей задаче
    if (
      creep.store[RESOURCE_ENERGY] === 0 &&
      currentTaskName !== "operateFactory"
    ) {
      energySource.withdrawFromStorage(creep);

      if (!creep.memory._energyDepleted) {
        creep.memory._energyDepleted = true;
        creep.memory.taskIndex =
          (creep.memory.taskIndex + 1) % TASK_CHAIN.length;
      }

      return;
    }

    creep.memory._energyDepleted = false;

    const taskName = currentTaskName;

    // say только при смене задачи
    if (creep.memory.lastTaskName !== taskName) {
      creep.say(SAY_LABELS[taskName] || taskName);
      creep.memory.lastTaskName = taskName;
    }

    if (typeof taskExecutors[taskName] === "function") {
      const isBusy = taskExecutors[taskName].call(taskExecutors, creep);

      if (!isBusy) {
        creep.memory.taskIndex =
          (creep.memory.taskIndex + 1) % TASK_CHAIN.length;
      }
    }
  },
};
