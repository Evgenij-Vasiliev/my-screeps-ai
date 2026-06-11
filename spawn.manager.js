module.exports = {
  run: function (room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn || spawn.spawning) return;

    // Режим выживания: если крипов нет вообще — спавним harvester любой ценой
    const roomCreeps = _.filter(Game.creeps, c => c.memory.room === room.name);
    if (roomCreeps.length === 0) {
      this._spawn(spawn, "harvester", room, true);
      return;
    }

    const counts = this._countCreeps(room);
    const energy = room.energyCapacityAvailable; // используем максимум, не текущий

    // Приоритет спавна
    let role = null;
    if (counts.miners < 2) role = "miner";
    else if (counts.transporters < 2) role = "transporter";
    else if (counts.towerSuppliers < 2) role = "towerSupplier";
    else if (counts.harvesters < 1) role = "harvester";
    else if (counts.upgraders < 1) role = "upgrader";
    else if (counts.builders < 1) role = "builder";

    if (role) this._spawn(spawn, role, room, false);
  },

  _spawn: function (spawn, role, room, emergency) {
    // В аварийном режиме используем только то, что есть прямо сейчас
    const energy = emergency
      ? room.energyAvailable
      : room.energyCapacityAvailable;

    const body = this._buildBody(role, energy);
    if (!body) return; // энергии недостаточно даже на минимум

    const name = `${role}_${room.name}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
      memory: { role, room: room.name },
    });

    if (result === OK) {
      console.log(
        `[spawn] ${room.name}: спавним ${role} (${body.length} частей, ${energy} энергии)`,
      );
    }
  },

  _buildBody: function (role, energy) {
    // Специализированные тела под роль
    const bodies = {
      // Miner: максимум WORK, минимум движения (стоит на месте)
      miner: [
        { cost: 650, body: [WORK, WORK, WORK, WORK, WORK, MOVE] },
        { cost: 450, body: [WORK, WORK, WORK, WORK, MOVE] },
        { cost: 250, body: [WORK, WORK, MOVE] },
      ],
      // Transporter/TowerSupplier: максимум CARRY
      transporter: [
        {
          cost: 600,
          body: [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE],
        },
        { cost: 400, body: [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE] },
        { cost: 200, body: [CARRY, CARRY, MOVE] },
      ],
      towerSupplier: [
        {
          cost: 600,
          body: [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE],
        },
        { cost: 400, body: [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE] },
        { cost: 200, body: [CARRY, CARRY, MOVE] },
      ],
      // Остальные: универсальное тело WORK/CARRY/MOVE
      default: [
        {
          cost: 800,
          body: [WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE],
        },
        { cost: 550, body: [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE] },
        { cost: 300, body: [WORK, WORK, CARRY, MOVE, MOVE] },
        { cost: 200, body: [WORK, CARRY, MOVE] },
      ],
    };

    const options = bodies[role] || bodies.default;

    // Берём самое мощное тело, которое влезает в бюджет
    for (const option of options) {
      if (energy >= option.cost) return option.body;
    }

    return null; // не хватает энергии даже на минимум
  },

  _countCreeps: function (room) {
    const creeps = _.filter(Game.creeps, c => c.memory.room === room.name);
    return {
      miners: _.filter(creeps, c => c.memory.role === "miner").length,
      transporters: _.filter(creeps, c => c.memory.role === "transporter")
        .length,
      towerSuppliers: _.filter(creeps, c => c.memory.role === "towerSupplier")
        .length,
      harvesters: _.filter(creeps, c => c.memory.role === "harvester").length,
      upgraders: _.filter(creeps, c => c.memory.role === "upgrader").length,
      builders: _.filter(creeps, c => c.memory.role === "builder").length,
    };
  },
};
