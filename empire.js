/**
 * ===================================================
 * EMPIRE.JS
 * ===================================================
 */

const DEFICIT_THRESHOLD = {
  energy: 20000,
  battery: 3000,
  O: 1000,
  H: 1000,
  Z: 5000,
  K: 5000,
  L: 5000,
  U: 5000,
  X: 5000,
  OH: 2000,
  ZK: 2000,
  ZO: 2000,
  KH: 2000,
  LO: 2000,
  UO: 2000,
  UH: 2000,
  LH: 2000,
  GH: 2000,
  ZHO2: 1000,
  KHO2: 1000,
  LHO2: 1000,
  UHO2: 1000,
  UH2O: 1000,
  KH2O: 1000,
  LH2O: 1000,
  GH2O: 1000,
};

const SEND_AMOUNT = {
  energy: 30000,
  battery: 5000,
  O: 2000,
  H: 2000,
  Z: 10000,
  K: 10000,
  L: 10000,
  U: 10000,
  X: 10000,
  OH: 5000,
  ZK: 5000,
  ZO: 5000,
  KH: 5000,
  LO: 5000,
  UO: 5000,
  UH: 5000,
  LH: 5000,
  GH: 5000,
  ZHO2: 2000,
  KHO2: 2000,
  LHO2: 2000,
  UHO2: 2000,
  UH2O: 2000,
  KH2O: 2000,
  LH2O: 2000,
  GH2O: 2000,
};

const RESERVE_MIN = {
  energy: 50000,
  battery: 10000,
  O: 3000,
  H: 3000,
  Z: 15000,
  K: 15000,
  L: 15000,
  U: 15000,
  X: 15000,
  OH: 8000,
  ZK: 8000,
  ZO: 8000,
  KH: 8000,
  LO: 8000,
  UO: 8000,
  UH: 8000,
  LH: 8000,
  GH: 8000,
  ZHO2: 3000,
  KHO2: 3000,
  LHO2: 3000,
  UHO2: 3000,
  UH2O: 3000,
  KH2O: 3000,
  LH2O: 3000,
  GH2O: 3000,
};

module.exports = {
  energy: {
    poorThreshold: 20000,
    richThreshold: 100000,
    energyPoorThreshold: 50000,
    sendAmount: 20000,
    terminalMin: 100000,
    terminalMax: 150000,
    balanceInterval: 100,
    factoryReserve: 10000,
    sellSurplus: 100000,
    sellPrepThreshold: 500000,
  },

  minerals: {
    sellSurplus: 50000,
  },

  // ТЗ №25: Централизованная конфигурация рынка CONTROL-слоя
  market: {
    interval: 100,
    maxDealAmount: 10000,
    sellable: [
      RESOURCE_ENERGY,
      RESOURCE_BATTERY,
      RESOURCE_UTRIUM,
      RESOURCE_LEMERGIUM,
      RESOURCE_KEANIUM,
      RESOURCE_ZYNTHIUM,
      RESOURCE_OXYGEN,
      RESOURCE_HYDROGEN,
      RESOURCE_CATALYST,
      RESOURCE_GHODIUM,
      RESOURCE_UTRIUM_HYDRIDE,
      RESOURCE_UTRIUM_OXIDE,
      RESOURCE_KEANIUM_HYDRIDE,
      RESOURCE_KEANIUM_OXIDE,
      RESOURCE_LEMERGIUM_HYDRIDE,
      RESOURCE_LEMERGIUM_OXIDE,
      RESOURCE_ZYNTHIUM_HYDRIDE,
      RESOURCE_ZYNTHIUM_OXIDE,
      RESOURCE_GHODIUM_HYDRIDE,
      RESOURCE_ZYNTHIUM_KEANITE,
      RESOURCE_UTRIUM_LEMERGITE,
      RESOURCE_KEANIUM_ACID,
      RESOURCE_LEMERGIUM_ALKALIDE,
      RESOURCE_UTRIUM_ALKALIDE,
      RESOURCE_ZYNTHIUM_ALKALIDE,
    ],
  },

  getReserveMin(resource) {
    return RESERVE_MIN[resource] !== undefined ? RESERVE_MIN[resource] : 5000;
  },

  getDeficitThreshold(resource) {
    return DEFICIT_THRESHOLD[resource] !== undefined
      ? DEFICIT_THRESHOLD[resource]
      : 2000;
  },

  getSendAmount(resource) {
    return SEND_AMOUNT[resource] !== undefined ? SEND_AMOUNT[resource] : 3000;
  },

  selectBalanceTarget(resource, poorRooms) {
    return poorRooms[0];
  },

  selectBalanceDonor(resource, targetRoom, richRooms) {
    return richRooms.find(r => r.name !== targetRoom.name);
  },

  isResourceDeficitRoom(room, resourceTotal, deficitThreshold) {
    return resourceTotal < deficitThreshold;
  },

  isResourceDonorRoom(room, resourceTotal, reserve, sendAmount, isBusy) {
    return (
      resourceTotal > reserve + sendAmount &&
      room.terminal.cooldown === 0 &&
      !isBusy
    );
  },

  isEnergyRichRoom(room, storageEnergy) {
    return storageEnergy > this.energy.richThreshold;
  },

  shouldRunEnergyBalance() {
    return Game.time % this.energy.balanceInterval === 0;
  },

  shouldRunSellPrep() {
    return Game.time % this.energy.balanceInterval === 0;
  },

  // ТЗ №25: Условие запуска рыночных торгов
  shouldRunMarket() {
    return false; // Торги полностью заморожены на уровне CONTROL-слоя
    // return Game.time % this.market.interval === 0;
  },

  getBalanceInterval() {
    return this.energy.balanceInterval;
  },

  getTerminalEnergyReserve() {
    return 20000;
  },

  getIncomingTransferTimeout() {
    return 500;
  },

  run() {
    const myRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my,
    );

    Memory.empire = {
      rooms: myRooms.length,
    };

    // Глобальный военный контроль: сканирование угроз и управление аттакерами
    this._processMilitaryAlerts();

    // Глобальный контроль обсерваторий (разведка)
    this._processObservers();

    // Запуск исполнителя баланса ресурсов
    const resourceBalancer = require("resourceBalancer");
    resourceBalancer.run();

    // Оркестровка распределения энергии по интервалу
    if (this.shouldRunEnergyBalance()) {
      this._processEnergyBalance();
      this._processMineralBalance();
    }

    // ТЗ №25: Глобальная оркестровка рынка Империи
    if (this.shouldRunMarket()) {
      this._processMarketTrades();
    }
  },

  _processEnergyBalance() {
    const rooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    const poorRooms = rooms.filter(
      r =>
        (r.storage.store[RESOURCE_ENERGY] || 0) <
        this.energy.energyPoorThreshold,
    );

    const richRooms = rooms.filter(r =>
      this.isEnergyRichRoom(r, r.storage.store[RESOURCE_ENERGY] || 0),
    );

    if (!poorRooms.length || !richRooms.length) return;

    const terminalManager = require("terminal.manager");
    for (const poorRoom of poorRooms) {
      const donor = this.selectBalanceDonor(
        RESOURCE_ENERGY,
        poorRoom,
        richRooms,
      );
      if (!donor) continue;

      terminalManager.executeTransfer(
        donor,
        poorRoom,
        RESOURCE_ENERGY,
        this.energy.sendAmount,
      ); // <-- Заменили здесь
    }
  },
  // Новый контур: Централизованное распределение минералов Империи
  _processMineralBalance() {
    // 1. Получаем список всех комнат, где есть и склад, и терминал
    const rooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    // 2. Автоматически берём список всех ресурсов из таблицы дефицита
    const allResources = Object.keys(DEFICIT_THRESHOLD);

    // 3. Запускаем цикл перебора по каждому ресурсу
    for (const resource of allResources) {
      // Энергию пропускаем, у неё свой собственный изолированный баланс выше
      if (resource === RESOURCE_ENERGY) continue;

      // Получаем правила Империи для этого конкретного минерала
      const deficitLimit = this.getDeficitThreshold(resource);
      const reserveLimit = this.getReserveMin(resource);
      const sendAmount = this.getSendAmount(resource);

      // Ищем комнаты-потребители (где этого минерала критически мало)
      const poorRooms = rooms.filter(r => {
        const total =
          (r.storage.store[resource] || 0) + (r.terminal.store[resource] || 0);
        return this.isResourceDeficitRoom(r, total, deficitLimit);
      });

      // Ищем комнаты-доноры (где есть излишки и терминал свободен)
      const richRooms = rooms.filter(r => {
        const total =
          (r.storage.store[resource] || 0) + (r.terminal.store[resource] || 0);
        const isBusy = false; // На данном этапе считаем, что терминал не занят другой операцией
        return this.isResourceDonorRoom(
          r,
          total,
          reserveLimit,
          sendAmount,
          isBusy,
        );
      });

      // 4. Если нашли и того, кому надо, и того, у кого есть лишнее — соединяем их
      if (poorRooms.length > 0 && richRooms.length > 0) {
        const targetRoom = this.selectBalanceTarget(resource, poorRooms);
        const donorRoom = this.selectBalanceDonor(
          resource,
          targetRoom,
          richRooms,
        );

        if (donorRoom) {
          // Вызываем универсальный менеджер терминала для отправки груза
          const terminalManager = require("terminal.manager");
          terminalManager.executeTransfer(
            donorRoom,
            targetRoom,
            resource,
            sendAmount,
          );

          // Прерываем цикл для этого тика, чтобы не перегружать терминалы комнат
          return;
        }
      }
    }
  },
  // Новый контур: Централизованная торговля Империи
  _processMarketTrades() {
    const rooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    for (const room of rooms) {
      // Формируем список ресурсов (Энергия всегда в приоритете)
      const sellableList = this.market.sellable;
      const resources = [RESOURCE_ENERGY, ...sellableList].filter(
        (value, index, self) => self.indexOf(value) === index,
      );

      for (const resource of resources) {
        const total =
          (room.storage.store[resource] || 0) +
          (room.terminal.store[resource] || 0);

        // Проверяем пороги излишков прямо здесь, в CONTROL-слое
        const minSurplus =
          resource === RESOURCE_ENERGY
            ? this.energy.sellSurplus
            : this.minerals.sellSurplus;

        if (total < minSurplus) continue;

        // Определяем, сколько у нас есть в терминале для продажи
        const inTerminal = room.terminal.store[resource] || 0;
        if (inTerminal <= 0) continue;

        // Передаем точную команду исполнителю рынка
        const marketManager = require("market.manager");
        marketManager.executeDeal(room, resource, inTerminal);

        // Одна сделка за тик на всю Империю для безопасности
        return;
      }
    }
  },
  // Глобальный военный сканер Империи (Управление аттакерами)
  _processMilitaryAlerts() {
    const HIGH_RISK_ROOMS = ["E36S37", "E35S38"];
    const REMOTE_SCAN_ROOMS = ["E36S37", "E35S38"];

    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my,
    );

    const remoteRooms = REMOTE_SCAN_ROOMS.map(name => Game.rooms[name]).filter(
      Boolean,
    );

    const allRooms = [...ourRooms];
    for (const r of remoteRooms) {
      if (!allRooms.find(x => x.name === r.name)) allRooms.push(r);
    }

    const sorted = allRooms.sort((a, b) => {
      const aRisk = HIGH_RISK_ROOMS.includes(a.name) ? 0 : 1;
      const bRisk = HIGH_RISK_ROOMS.includes(b.name) ? 0 : 1;
      return aRisk - bRisk;
    });

    for (const room of sorted) {
      // Ищем опасных врагов (с деталями атаки или лечения)
      const hostiles = room.find(FIND_HOSTILE_CREEPS, {
        filter: c =>
          c.body.some(
            b =>
              b.type === ATTACK || b.type === RANGED_ATTACK || b.type === HEAL,
          ),
      });

      if (hostiles.length > 0) {
        Memory.attackAlert = { room: room.name, time: Game.time };
        return;
      }

      // Ищем ядра захватчиков в удаленных комнатах
      const invaderCore = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_INVADER_CORE,
      });

      if (invaderCore.length > 0) {
        Memory.attackAlert = { room: room.name, time: Game.time };
        return;
      }
    }

    // Если угроз нигде нет — снимаем тревогу
    if (Memory.attackAlert) {
      delete Memory.attackAlert;
    }
  },
  // Глобальное управление обсерваториями Империи
  _processObservers() {
    const OBSERVE_ROOMS = ["E36S37", "E35S38"];
    let observerCount = 0;

    // Перебираем только наши живые комнаты
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      // Ищем обсерваторию в комнате
      const observer = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_OBSERVER,
      })[0];

      if (observer) {
        // Смещаем индекс на основе номера обсерватории,
        // чтобы разные комнаты не дублировали просмотр одной цели
        const index = (Game.time + observerCount) % OBSERVE_ROOMS.length;
        observer.observeRoom(OBSERVE_ROOMS[index]);
        observerCount++;
      }
    }
  },
};
