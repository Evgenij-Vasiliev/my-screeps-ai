/**
 * Вспомогательная функция для генерации массива частей тела.
 * Принимает объект с количеством запчастей.
 */
const prepareBody = ({
  work = 0,
  carry = 0,
  move = 0,
  attack = 0,
  tough = 0,
  ranged_attack = 0,
  heal = 0,
  claim = 0,
}) => {
  const body = [];
  // Порядок важен для выживаемости: броня -> атака -> движение
  for (let i = 0; i < tough; i++) body.push(TOUGH);
  for (let i = 0; i < work; i++) body.push(WORK);
  for (let i = 0; i < carry; i++) body.push(CARRY);
  for (let i = 0; i < attack; i++) body.push(ATTACK);
  for (let i = 0; i < ranged_attack; i++) body.push(RANGED_ATTACK);
  for (let i = 0; i < heal; i++) body.push(HEAL);
  for (let i = 0; i < claim; i++) body.push(CLAIM);
  for (let i = 0; i < move; i++) body.push(MOVE); // MOVE обычно в конце

  return body;
};

const factory = {
  blueprints: {
    test_miner: (spawn, bestIndex) => {
      const sources = spawn.room.find(FIND_SOURCES);
      return {
        body: prepareBody({ work: 5, move: 2 }),
        memory: { sourceId: sources[bestIndex] ? sources[bestIndex].id : null },
      };
    },
    test_hauler: () => ({
      body: prepareBody({ carry: 2, move: 2 }),
      memory: {},
    }),
    test_towerSupplier: () => ({
      body: prepareBody({ carry: 2, move: 2 }),
      memory: {},
    }),
    test_harvester: () => ({
      body: prepareBody({ work: 1, carry: 1, move: 1 }),
      memory: {},
    }),
    test_upgrader: () => ({
      body: prepareBody({ work: 1, carry: 1, move: 1 }),
      memory: {},
    }),
    test_builder: () => ({
      body: prepareBody({ work: 1, carry: 1, move: 1 }),
      memory: {},
    }),
    test_repairer: () => ({
      body: prepareBody({ work: 1, carry: 1, move: 1 }),
      memory: {},
    }),
    default: () => ({
      body: prepareBody({ work: 1, carry: 1, move: 1 }),
      memory: {},
    }),
  },

  run: function (spawn, roleData, bestIndex) {
    const blueprintFunc =
      this.blueprints[roleData.role] || this.blueprints["default"];
    const blueprint = blueprintFunc(spawn, bestIndex);

    const finalMemory = Object.assign(
      {
        role: roleData.role,
        sourceIndex: bestIndex,
        working: false,
      },
      blueprint.memory,
    );

    return spawn.spawnCreep(blueprint.body, `${roleData.role}_${Game.time}`, {
      memory: finalMemory,
    });
  },
};

module.exports = factory;
