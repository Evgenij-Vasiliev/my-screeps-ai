"use strict";

const taskManager = require("task.manager");
const taskExecutors = require("task.executors");

/**
 * worker.runner.js
 *
 * Цикл одного Worker (creep) за тик:
 *   1. текущая задача (продолжить)
 *   2. новая задача (если текущей нет)
 *   3. энергия (если задача её требует)
 *   4. выполнить
 *   5. обработать результат
 *
 * Результаты execute(): 'done' | 'invalid' | 'noEnergy' | 'inProgress'.
 * Любой из трёх первых -> задача завершается и освобождается на следующий тик.
 */

class WorkerRunner {
  /**
   * @param {Creep} creep
   */
  run(creep) {
    // Шаг 1 — текущая задача.
    let task = this._getAssignedTask(creep);

    // Шаг 2 — если текущей задачи нет, взять следующую.
    if (!task) {
      task = taskManager.getNext(creep);
      if (task) {
        creep.memory.taskId = task.id;
      }
    }

    if (!task) {
      // Очередь пуста — Worker простаивает этот тик.
      return;
    }

    // Шаг 3 — энергия.
    // Если своей энергии нет вообще, worker не может выполнять большинство
    // задач (build/repair/upgrade). Пытаемся получить энергию из
    // room.storage, при отсутствии storage — аварийный fallback (харвест
    // ближайшего активного источника).
    //
    // Исключение: transfer и operateFactory сами управляют своим ресурсным
    // состоянием (withdraw нужного ресурса из source/factory) — Шаг 3
    // не должен вмешиваться.
    if (
      creep.store[RESOURCE_ENERGY] === 0 &&
      !this._creepDoingTransferTask(creep)
    ) {
      const handled = this._ensureEnergy(creep);
      if (handled) {
        // Тик потрачен на перемещение/сбор энергии — задачу не выполняем.
        return;
      }
    }

    // Шаг 4 — выполнить.
    const result = taskExecutors.execute(creep, task);

    // Шаг 5 — обработать результат.
    if (result === "done" || result === "invalid" || result === "noEnergy") {
      taskManager.complete(task.id);
      creep.memory.taskId = null;
    }
    // result === 'inProgress' -> ничего не делаем, продолжаем на следующем тике.
  }

  /**
   * Возвращает задачу, уже назначенную этому creep'у (по Memory.creeps[name].taskId),
   * либо null, если такой задачи нет или она пропала из очереди.
   * @param {Creep} creep
   * @returns {object|null}
   */
  _getAssignedTask(creep) {
    const taskId = creep.memory.taskId;
    if (!taskId) {
      return null;
    }

    if (!Memory.taskSystem || !Memory.taskSystem.queue) {
      creep.memory.taskId = null;
      return null;
    }

    const task = Memory.taskSystem.queue.find(
      t => t.id === taskId && !t.completed,
    );
    if (!task) {
      // Задача была завершена/удалена другим путём — освобождаем creep'а.
      creep.memory.taskId = null;
      return null;
    }

    return task;
  }

  /**
   * true, если у creep'а сейчас назначена задача, которая сама управляет
   * своим ресурсным состоянием (transfer/operateFactory), и Шаг 3
   * не должен вмешиваться в её промежуточные "пустые" моменты.
   * @param {Creep} creep
   * @returns {boolean}
   */
  _creepDoingTransferTask(creep) {
    const task = this._getAssignedTask(creep);
    return (
      !!task && (task.type === "transfer" || task.type === "operateFactory")
    );
  }

  /**
   * Аварийное/базовое пополнение энергии Worker'а вне логики задач.
   * @param {Creep} creep
   * @returns {boolean} true, если в этот тик было совершено действие (move/withdraw/harvest)
   */
  _ensureEnergy(creep) {
    const room = creep.room;

    if (room.storage && room.storage.store[RESOURCE_ENERGY] > 0) {
      if (creep.withdraw(room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(room.storage);
      }
      return true;
    }

    // Аварийный fallback: storage нет или он пуст — харвестим ближайший источник.
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source);
      }
      return true;
    }

    // Ни storage, ни активных источников — ничего не поделать этот тик.
    return false;
  }
}

module.exports = new WorkerRunner();
