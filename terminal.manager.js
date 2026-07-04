/**
 * ===================================================
 * TERMINAL MANAGER
 * ===================================================
 */

const resourceBalancer = require("resourceBalancer");
const empire = require("empire");

const ENERGY_SEND_AMOUNT = empire.energy.sendAmount;
const TERMINAL_ENERGY_MIN = empire.energy.terminalMin;
const TERMINAL_ENERGY_MAX = empire.energy.terminalMax;

module.exports = {
  run(room) {
    // Исполнительная логика локальной комнаты
    resourceBalancer.processIncoming(room);
    this._runSellPrep(room);
  },

  /**
   * Исполнительный метод транзакции (ТЗ №24)
   * Вызывается централизованно из empire.js
   */
  executeTransfer(donor, targetRoom, resource, amount) {
    const terminal = donor.terminal;
    if (!terminal || terminal.cooldown > 0) return;

    // 1. Считаем цену доставки (сколько нужно энергии на перелет)
    const cost = Game.market.calcTransactionCost(
      amount,
      donor.name,
      targetRoom.name,
    );

    // 2. Проверяем, хватает ли в терминале энергии на оплату этой доставки
    const availableEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (availableEnergy < cost) {
      // Если топлива нет, и мы отправляем МИНЕРАЛ — заказываем энергию у криптов
      if (resource !== RESOURCE_ENERGY) {
        this._addNeed(donor, RESOURCE_ENERGY, cost);
      }
      return;
    }

    // 3. Проверяем, есть ли сам груз в терминале
    const availableResource = terminal.store[resource] || 0;

    if (resource === RESOURCE_ENERGY) {
      // Если везем энергию: её должно хватать и на груз, и на оплату доставки
      if (availableEnergy < amount + cost) return;
    } else {
      // Если везем минерал: его должно быть не меньше, чем заказано
      if (availableResource < amount) return;
    }

    // 4. Отправляем груз
    const result = terminal.send(resource, amount, targetRoom.name);
    if (result === OK) {
      if (this._clearNeed) {
        this._clearNeed(donor, resource);
      }

      // ИСПРАВЛЕНИЕ (ТЗ №28): регистрируем входящий перевод на стороне
      // получателя — ТОЧНО ТЕМ ЖЕ вызовом, которым уже пользуется
      // control.js Terminal.move() для ручных переводов. Раньше этот
      // вызов существовал только в control.js; автоматический канал
      // empire._processEnergyBalance()/_processMineralBalance() →
      // executeTransfer() → terminal.send() его не делал вообще, из-за
      // чего resourceBalancer.processIncoming() никогда не запускался
      // для этих переводов, и энергия оставалась в terminal без
      // дальнейшей разгрузки в storage (см. отчёты по ТЗ №27/28).
      // Ни новых менеджеров, ни новых структур Memory — используется
      // уже существующий resourceBalancer.registerIncoming(), уже
      // импортированный в этом файле, и уже существующая структура
      // Memory.rooms[x].terminalIncoming.
      resourceBalancer.registerIncoming(targetRoom.name, resource, amount);
    }
  },

  _runSellPrep(room) {
    if (!empire.shouldRunSellPrep()) return;
    if (!room.terminal || !room.storage) return;

    const totalEnergy =
      (room.storage.store[RESOURCE_ENERGY] || 0) +
      (room.terminal.store[RESOURCE_ENERGY] || 0);

    const inTerminal = room.terminal.store[RESOURCE_ENERGY] || 0;

    if (
      totalEnergy > empire.energy.sellPrepThreshold &&
      inTerminal < TERMINAL_ENERGY_MIN
    ) {
      this._addNeed(room, RESOURCE_ENERGY, TERMINAL_ENERGY_MIN, null);
    }
  },

  _addNeed(room, resource, amount, toRoom) {
    if (!room.memory.terminalNeeds) room.memory.terminalNeeds = [];

    const needs = room.memory.terminalNeeds;
    const existing = needs.find(
      n => n.resource === resource && n.toRoom === toRoom,
    );

    if (existing) {
      existing.amount = amount;
      return;
    }

    needs.push({ resource, amount, toRoom });
  },

  _clearNeed(room, resource, toRoom) {
    if (!room.memory.terminalNeeds) return;

    room.memory.terminalNeeds = room.memory.terminalNeeds.filter(
      n => !(n.resource === resource && n.toRoom === toRoom),
    );
  },
};
