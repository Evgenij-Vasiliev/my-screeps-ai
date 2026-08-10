/**
 * TERMINAL NETWORK (Task System v4)
 * Singleton. Уровень империи. Определяет избыток/дефицит ресурсов
 * между собственными терминалами и балансирует их через Terminal.send().
 *
 * НЕ таскает ресурсы Worker'ом и НЕ создаёт TransferTask — локальная
 * логистика Storage <-> Terminal целиком остаётся ответственностью
 * task.manager.js (generateFillTerminals), чтобы не было двух источников
 * условий для одного и того же перемещения (п.12 ТЗ TS-001).
 */

const THRESHOLDS = {
  // Выше этого — терминал считается избыточным по ресурсу.
  SURPLUS_ABOVE: 50000,
  // Ниже этого — терминал считается дефицитным по ресурсу.
  DEFICIT_BELOW: 5000,
  // Не отправлять партии меньше этого объёма (не имеет смысла из-за cooldown).
  MIN_SEND_AMOUNT: 1000,
};

class TerminalNetwork {
  /**
   * Точка входа уровня империи. Вызывается один раз за тик из empire.js.
   */
  run() {
    const states = this.collectTerminalStates();
    if (states.length < 2) return; // балансировать нечего

    const resourceTypes = this.collectResourceTypes(states);
    for (const resourceType of resourceTypes) {
      this.balanceResource(resourceType, states);
    }

    // TODO: market integration
    // Future extension point — Game.market.* (покупка/продажа), когда
    // появятся конкретные торговые правила (что торговать, лимиты цены,
    // объёмы ордеров). Сейчас не реализовано — додумывать нельзя.
  }

  /**
   * Собирает состояние терминалов всех собственных комнат.
   * @returns {{room: Room, terminal: StructureTerminal}[]}
   */
  collectTerminalStates() {
    const states = [];
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      if (!room.terminal) continue;
      states.push({ room, terminal: room.terminal });
    }
    return states;
  }

  /**
   * Собирает множество всех типов ресурсов, встречающихся хоть в одном терминале.
   * @param {Array} states
   * @returns {Set<string>}
   */
  collectResourceTypes(states) {
    const types = new Set();
    for (const state of states) {
      for (const resourceType in state.terminal.store) {
        types.add(resourceType);
      }
    }
    return types;
  }

  /**
   * Балансирует один тип ресурса: находит терминал с наибольшим избытком
   * и терминал с наибольшим дефицитом, отправляет между ними одну партию.
   * Не более одной send() на resourceType за тик — без сложного matching.
   * @param {string} resourceType
   * @param {Array} states
   */
  balanceResource(resourceType, states) {
    const surplusState = states
      .filter(s => s.terminal.cooldown === 0)
      .filter(
        s => (s.terminal.store[resourceType] || 0) > THRESHOLDS.SURPLUS_ABOVE,
      )
      .sort(
        (a, b) =>
          (b.terminal.store[resourceType] || 0) -
          (a.terminal.store[resourceType] || 0),
      )[0];

    if (!surplusState) return;

    const deficitState = states
      .filter(s => s.room.name !== surplusState.room.name)
      .filter(
        s => (s.terminal.store[resourceType] || 0) < THRESHOLDS.DEFICIT_BELOW,
      )
      .sort(
        (a, b) =>
          (a.terminal.store[resourceType] || 0) -
          (b.terminal.store[resourceType] || 0),
      )[0];

    if (!deficitState) return;

    const available =
      (surplusState.terminal.store[resourceType] || 0) -
      THRESHOLDS.SURPLUS_ABOVE;
    const needed =
      THRESHOLDS.DEFICIT_BELOW -
      (deficitState.terminal.store[resourceType] || 0);
    const amount = Math.min(available, needed);

    if (amount < THRESHOLDS.MIN_SEND_AMOUNT) return;

    surplusState.terminal.send(
      resourceType,
      amount,
      deficitState.room.name,
      "TerminalNetwork balance",
    );
  }
}

module.exports = new TerminalNetwork();
