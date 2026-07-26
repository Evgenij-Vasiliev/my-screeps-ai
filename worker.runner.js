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

    // Условие 3 (энергия кончилась): продвигаем taskIndex РОВНО ОДИН РАЗ —
    // в момент перехода в состояние дозаправки (флаг _energyDepleted).
    // Пока крип идёт за энергией несколько тиков подряд, taskIndex больше
    // не двигается (иначе задачи пропускались бы одна за другой на каждом
    // тике ожидания). Как только энергия появится — крип продолжит СЛЕДУЮЩУЮ
    // задачу в цепочке, а не ту же самую, на которой энергия закончилась.
    // Исключение: operateFactory сам обрабатывает пустой рюкзак —
    // это её законный шаг 4 (проверка батарейки на фабрике).
    if (
      creep.store[RESOURCE_ENERGY] === 0 &&
      currentTaskName !== "operateFactory"
    ) {
      creep.say("⚡energy");
      energySource.withdrawFromStorage(creep);

      if (!creep.memory._energyDepleted) {
        creep.memory._energyDepleted = true;
        creep.memory.taskIndex =
          (creep.memory.taskIndex + 1) % taskChain.length;
      }
      return;
    }

    // Энергия есть — сбрасываем флаг, готовим к следующему возможному
    // истощению энергии на будущей задаче.
    creep.memory._energyDepleted = false;

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
