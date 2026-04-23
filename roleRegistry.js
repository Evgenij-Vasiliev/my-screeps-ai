module.exports = {
  test_harvester: require("./role.harvester"),
  test_upgrader: require("./role.upgrader"),
  test_builder: require("./role.builder"),
  test_repairer: require("./role.repairer"),
  test_miner: require("./role.miner"),
  test_hauler: require("./role.hauler"),
  test_towerSupplier: require("./role.towerSupplier"),
  test_mineralMiner: require("./role.mineralMiner"),
  test_attacker: require("./role.attacker"),
  test_reserver: require("./role.reserver"),
  test_remoteMiner: require("./role.remoteMiner"), // Регистрация майнера
  test_remoteHauler: require("./role.remoteHauler"), // Регистрация хаулера
};
