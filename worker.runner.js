const taskExecutors = require("taskExecutors");
const energySource = require("energySource");

module.exports = {
  run: function (creep) {
    const taskChain = [
      "fillSpawnsExtensions",
      "fillTerminals",
      "operateFactory",
      "repairStructures",
      "buildStructures",
      "fillTowers",
      "upgradeController",
    ];

    if (creep.memory.taskIndex === undefined) {
      creep.memory.taskIndex = 0;
    }

    const currentTaskName = taskChain[creep.memory.taskIndex];

    // Условие 3: рюкзак пуст — идём за энергией и ЖДЁМ на текущей задаче,
    // не продвигая taskIndex. Иначе задача, чья очередь пришлась на тик
    // с пустым рюкзаком, будет пропущена, а taskIndex продолжит листаться
    // вперёд на каждом тике, пока крип идёт за энергией.
    // Исключение: operateFactory сам обрабатывает пустой рюкзак —
    // это её законный шаг 4 (проверка батарейки на фабрике).
    if (
      creep.store[RESOURCE_ENERGY] === 0 &&
      currentTaskName !== "operateFactory"
    ) {
      creep.say("⚡energy");
      energySource.withdrawFromStorage(creep);
      return;
    }

    const taskName = currentTaskName;
    const sayLabels = {
      fillSpawnsExtensions: "spawn",
      fillTerminals: "terminal",
      operateFactory: "factory",
      repairStructures: "repair",
      buildStructures: "build",
      fillTowers: "tower",
      upgradeController: "upgrade",
    };
    creep.say(sayLabels[taskName] || taskName);

    if (typeof taskExecutors[taskName] === "function") {
      const isBusy = taskExecutors[taskName](creep);

      if (!isBusy) {
        creep.memory.taskIndex =
          (creep.memory.taskIndex + 1) % taskChain.length;
      }
    }
  },
};
