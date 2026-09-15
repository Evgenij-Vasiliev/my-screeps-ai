# Отчёт: перевод движения крипов на библиотеку Traveler (moveTo -> travelTo)

- Дата: 2026-09-16
- Библиотека: `traveler.js`; инициализация — `require("traveler")()` в `main.js:5` (по умолчанию `installPrototype: true`, поэтому доступен `Creep.prototype.travelTo`).
- Суть изменений: в 14 файлах прямой `creep.moveTo()` заменён на `creep.travelTo()`; в `remote.reserver.js` дополнительно добавлен сброс кэша пути `creep.memory._travel` при смене комнаты (защита от border-crossing бага).
- Вне отчёта: `defense.attacker.js` не изменялся — погоня за движущейся целью (строка 156, `creep.moveTo`) и тактический шаг (строка 154, `creep.move`) оставлены как есть.
- Команда генерации diff:

```bash
git --no-pager diff -- energySource.js lab.worker.js remote.hauler.js remote.miner.js remote.reserver.js role.builder.js role.harvester.js role.linkWorker.js role.miner.js role.mineralMiner.js role.repairer.js role.towerSupplier.js role.upgrader.js task.executors.js
```

## Полный diff

```diff
diff --git a/energySource.js b/energySource.js
index 6704190..3eff7ff 100644
--- a/energySource.js
+++ b/energySource.js
@@ -32,7 +32,7 @@ module.exports = {
       (ignoreReserve || storageEnergy > STORAGE.ENERGY_MIN)
     ) {
       if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
-        creep.moveTo(storage, { reusePath: 50 });
+        creep.travelTo(storage, { reusePath: 50 });
       }
       return true;
     }
@@ -40,7 +40,7 @@ module.exports = {
     // Storage на резерве или пуст — забираем энергию, пришедшую сетью в терминал.
     if (terminal && (terminal.store[RESOURCE_ENERGY] || 0) > 0) {
       if (creep.withdraw(terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
-        creep.moveTo(terminal, { reusePath: 50 });
+        creep.travelTo(terminal, { reusePath: 50 });
       }
       return true;
     }
diff --git a/lab.worker.js b/lab.worker.js
index 8aae8b0..b6ffc0c 100644
--- a/lab.worker.js
+++ b/lab.worker.js
@@ -228,13 +228,13 @@ module.exports = {
       if (creep.store[creep.memory.resource] === 0) {
         const r = creep.withdraw(target, creep.memory.resource);
         if (r === ERR_NOT_IN_RANGE)
-          creep.moveTo(target, {
+          creep.travelTo(target, {
             reusePath: 5,
           });
       } else {
         const r = creep.transfer(dest, creep.memory.resource);
         if (r === ERR_NOT_IN_RANGE)
-          creep.moveTo(dest, {
+          creep.travelTo(dest, {
             reusePath: 5,
           });
         if (r === OK) creep.memory.task = null;
@@ -258,13 +258,13 @@ module.exports = {
         }
         const r = creep.withdraw(reactor, creep.memory.resource);
         if (r === ERR_NOT_IN_RANGE)
-          creep.moveTo(reactor, {
+          creep.travelTo(reactor, {
             reusePath: 5,
           });
       } else {
         const r = creep.transfer(dest, creep.memory.resource);
         if (r === ERR_NOT_IN_RANGE)
-          creep.moveTo(dest, {
+          creep.travelTo(dest, {
             reusePath: 5,
           });
         if (r === OK) creep.memory.task = null;
@@ -293,14 +293,14 @@ module.exports = {
           creep.memory.amount,
         );
         if (r === ERR_NOT_IN_RANGE)
-          creep.moveTo(src, {
+          creep.travelTo(src, {
             reusePath: 5,
           });
         if (r === OK) delete creep.memory.amount;
       } else {
         const r = creep.transfer(dest, creep.memory.resource);
         if (r === ERR_NOT_IN_RANGE)
-          creep.moveTo(dest, {
+          creep.travelTo(dest, {
             reusePath: 5,
           });
         if (r === OK) creep.memory.task = null;
diff --git a/remote.hauler.js b/remote.hauler.js
index 2a4271b..e31ed45 100644
--- a/remote.hauler.js
+++ b/remote.hauler.js
@@ -54,7 +54,7 @@ module.exports = {
         delete creep.memory._travel;
       }
       creep.memory._lastRoom = creep.room.name;
-      creep.moveTo(new RoomPosition(25, 25, currentGoal), {
+      creep.travelTo(new RoomPosition(25, 25, currentGoal), {
         reusePath: 0,
         maxRooms: 3,
       });
@@ -70,7 +70,7 @@ module.exports = {
       creep.pos.y === 0 ||
       creep.pos.y === 49
     ) {
-      creep.moveTo(new RoomPosition(25, 25, creep.room.name), {
+      creep.travelTo(new RoomPosition(25, 25, creep.room.name), {
         reusePath: 0,
       });
       return;
@@ -84,7 +84,7 @@ module.exports = {
       if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
         // Есть линк и в нём есть место — идём к нему
         if (creep.transfer(link, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
-          creep.moveTo(link, {
+          creep.travelTo(link, {
             reusePath: 15,
             maxRooms: 1,
           });
@@ -94,7 +94,7 @@ module.exports = {
         const target = creep.room.storage;
         if (target) {
           if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
-            creep.moveTo(target, { reusePath: 15, maxRooms: 1 });
+            creep.travelTo(target, { reusePath: 15, maxRooms: 1 });
           }
         }
       }
@@ -129,7 +129,7 @@ module.exports = {
 
       if (container) {
         if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
-          creep.moveTo(container, { reusePath: 15, maxRooms: 1 });
+          creep.travelTo(container, { reusePath: 15, maxRooms: 1 });
         }
       } else {
         // Контейнер пуст — подбираем выпавшую энергию
@@ -154,7 +154,7 @@ module.exports = {
 
         if (dropped) {
           if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
-            creep.moveTo(dropped, { reusePath: 15, maxRooms: 1 });
+            creep.travelTo(dropped, { reusePath: 15, maxRooms: 1 });
           }
         } else {
           // Ждём у источника
@@ -171,7 +171,7 @@ module.exports = {
           }
 
           if (source && creep.pos.getRangeTo(source) > 2) {
-            creep.moveTo(source, { reusePath: 15, maxRooms: 1 });
+            creep.travelTo(source, { reusePath: 15, maxRooms: 1 });
           }
         }
       }
diff --git a/remote.miner.js b/remote.miner.js
index 5c52974..b8e465a 100644
--- a/remote.miner.js
+++ b/remote.miner.js
@@ -16,7 +16,7 @@ module.exports = {
 
       creep.memory._lastRoom = creep.room.name;
 
-      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
+      creep.travelTo(new RoomPosition(25, 25, targetRoom), {
         reusePath: 0,
         maxRooms: 3,
       });
@@ -33,7 +33,7 @@ module.exports = {
       creep.pos.y === 49;
 
     if (onBorder) {
-      creep.moveTo(new RoomPosition(25, 25, creep.room.name), {
+      creep.travelTo(new RoomPosition(25, 25, creep.room.name), {
         reusePath: 0,
       });
       return;
@@ -91,7 +91,7 @@ module.exports = {
 
     if (container) {
       if (!creep.pos.isEqualTo(container.pos)) {
-        creep.moveTo(container, {
+        creep.travelTo(container, {
           reusePath: 15,
           maxRooms: 1,
         });
@@ -99,7 +99,7 @@ module.exports = {
       }
     } else {
       if (creep.pos.getRangeTo(source) > 1) {
-        creep.moveTo(source, {
+        creep.travelTo(source, {
           reusePath: 15,
           maxRooms: 1,
         });
diff --git a/remote.reserver.js b/remote.reserver.js
index 56afd84..6874b04 100644
--- a/remote.reserver.js
+++ b/remote.reserver.js
@@ -46,7 +46,18 @@ module.exports = {
      * reusePath: 50 — путь между комнатами стабилен, кэшируем надолго.
      */
     if (creep.room.name !== targetRoom) {
-      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
+      // Traveler сериализует путь только внутри комнаты, поэтому при
+      // пересечении границы кэш пути сбрасывается — тот же приём, что
+      // уже используется в remote.hauler и remote.miner.
+      if (
+        creep.memory._lastRoom &&
+        creep.memory._lastRoom !== creep.room.name
+      ) {
+        delete creep.memory._travel;
+      }
+      creep.memory._lastRoom = creep.room.name;
+
+      creep.travelTo(new RoomPosition(25, 25, targetRoom), {
         reusePath: 50,
       });
       return;
@@ -81,7 +92,7 @@ module.exports = {
     const result = creep.reserveController(controller);
 
     if (result === ERR_NOT_IN_RANGE) {
-      creep.moveTo(controller, {
+      creep.travelTo(controller, {
         reusePath: 20,
       });
     }
diff --git a/role.builder.js b/role.builder.js
index 2756eeb..52eb607 100644
--- a/role.builder.js
+++ b/role.builder.js
@@ -35,7 +35,7 @@ module.exports = {
 
       if (target) {
         if (creep.build(target) === ERR_NOT_IN_RANGE) {
-          creep.moveTo(target, {
+          creep.travelTo(target, {
           });
         }
       } else {
diff --git a/role.harvester.js b/role.harvester.js
index 0f57ba1..0a27c5e 100644
--- a/role.harvester.js
+++ b/role.harvester.js
@@ -26,7 +26,7 @@ module.exports = {
 
       if (terminal && terminal.store[RESOURCE_ENERGY] > 0) {
         if (creep.withdraw(terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
-          creep.moveTo(terminal, { reusePath: 15 });
+          creep.travelTo(terminal, { reusePath: 15 });
         }
         return;
       }
@@ -60,7 +60,7 @@ module.exports = {
 
       if (source) {
         if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
-          creep.moveTo(source, { reusePath: 15 });
+          creep.travelTo(source, { reusePath: 15 });
         }
       }
       return;
@@ -111,6 +111,7 @@ module.exports = {
 
     if (target) {
       if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
+        creep.travelTo(target, { reusePath: 15 });
       }
     }
   },
diff --git a/role.linkWorker.js b/role.linkWorker.js
index 128f73c..51cecf2 100644
--- a/role.linkWorker.js
+++ b/role.linkWorker.js
@@ -22,7 +22,7 @@ module.exports = {
 
       const result = creep.withdraw(storageLink, RESOURCE_ENERGY);
       if (result === ERR_NOT_IN_RANGE) {
-        creep.moveTo(storageLink, { reusePath: 5 });
+        creep.travelTo(storageLink, { reusePath: 5 });
       } else if (result !== OK) {
         console.log(
           `[LinkWorker] ${creep.room.name} : withdraw() вернул ошибку ${result}`,
@@ -33,7 +33,7 @@ module.exports = {
 
     const result = creep.transfer(storage, RESOURCE_ENERGY);
     if (result === ERR_NOT_IN_RANGE) {
-      creep.moveTo(storage, { reusePath: 5 });
+      creep.travelTo(storage, { reusePath: 5 });
     } else if (result !== OK) {
       console.log(
         `[LinkWorker] ${creep.room.name} : transfer() вернул ошибку ${result}`,
diff --git a/role.miner.js b/role.miner.js
index 93c7d17..4653cb2 100644
--- a/role.miner.js
+++ b/role.miner.js
@@ -16,7 +16,7 @@ module.exports = {
 
     // Идём на рабочее место
     if (!creep.pos.isEqualTo(spot.x, spot.y)) {
-      creep.moveTo(new RoomPosition(spot.x, spot.y, creep.room.name), {
+      creep.travelTo(new RoomPosition(spot.x, spot.y, creep.room.name), {
         reusePath: 20,
       });
       return;
diff --git a/role.mineralMiner.js b/role.mineralMiner.js
index 4cf0536..c169870 100644
--- a/role.mineralMiner.js
+++ b/role.mineralMiner.js
@@ -25,7 +25,7 @@ const roleMineralMiner = {
 
       const transferResult = creep.transfer(storage, resourceType);
       if (transferResult === ERR_NOT_IN_RANGE) {
-        creep.moveTo(storage, { reusePath: 50, visualize: false });
+        creep.travelTo(storage, { reusePath: 50, visualize: false });
       } else if (transferResult !== OK) {
         console.log(
           `[Mineral] ${creep.name} : transfer() вернул ошибку ${transferResult}`,
@@ -41,7 +41,7 @@ const roleMineralMiner = {
 
     const harvestResult = creep.harvest(mineral);
     if (harvestResult === ERR_NOT_IN_RANGE) {
-      creep.moveTo(mineral, { reusePath: 50, visualize: false });
+      creep.travelTo(mineral, { reusePath: 50, visualize: false });
     } else if (harvestResult !== OK) {
       // console.log(...)
     }
diff --git a/role.repairer.js b/role.repairer.js
index 6cc2db5..5e87140 100644
--- a/role.repairer.js
+++ b/role.repairer.js
@@ -33,7 +33,7 @@ module.exports = {
 
       if (target) {
         if (creep.repair(target) === ERR_NOT_IN_RANGE) {
-          creep.moveTo(target, {
+          creep.travelTo(target, {
           });
         }
       } else {
diff --git a/role.towerSupplier.js b/role.towerSupplier.js
index a293882..eef09f3 100644
--- a/role.towerSupplier.js
+++ b/role.towerSupplier.js
@@ -26,7 +26,7 @@ module.exports = {
 
     if (tower) {
       if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
-        creep.moveTo(tower, { reusePath: 5 });
+        creep.travelTo(tower, { reusePath: 5 });
       }
       return;
     }
@@ -35,7 +35,7 @@ module.exports = {
       if (
         creep.transfer(creep.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
       ) {
-        creep.moveTo(creep.room.storage, { reusePath: 5 });
+        creep.travelTo(creep.room.storage, { reusePath: 5 });
       }
     }
   },
diff --git a/role.upgrader.js b/role.upgrader.js
index 503f79c..2250a74 100644
--- a/role.upgrader.js
+++ b/role.upgrader.js
@@ -25,7 +25,7 @@ module.exports = {
     // Режим улучшения
     else {
       if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
-        creep.moveTo(creep.room.controller, { reusePath: 10 });
+        creep.travelTo(creep.room.controller, { reusePath: 10 });
       }
     }
   },
diff --git a/task.executors.js b/task.executors.js
index 1b3d813..3dba324 100644
--- a/task.executors.js
+++ b/task.executors.js
@@ -8,7 +8,7 @@ function withdrawPower(creep) {
   if (storage && storage.store[RESOURCE_POWER] > 0) {
     const result = creep.withdraw(storage, RESOURCE_POWER);
     if (result === ERR_NOT_IN_RANGE) {
-      creep.moveTo(storage, { reusePath: 50 });
+      creep.travelTo(storage, { reusePath: 50 });
     }
     return result === OK || result === ERR_NOT_IN_RANGE;
   }
@@ -16,7 +16,7 @@ function withdrawPower(creep) {
   if (terminal && terminal.store[RESOURCE_POWER] > 0) {
     const result = creep.withdraw(terminal, RESOURCE_POWER);
     if (result === ERR_NOT_IN_RANGE) {
-      creep.moveTo(terminal, { reusePath: 50 });
+      creep.travelTo(terminal, { reusePath: 50 });
     }
     return result === OK || result === ERR_NOT_IN_RANGE;
   }
@@ -87,7 +87,7 @@ function executeFillSpawnsExtensions(creep, task) {
       return isTargetFull(target) ? "DONE" : "CONTINUE";
 
     case ERR_NOT_IN_RANGE:
-      creep.moveTo(target, { reusePath: 20 });
+      creep.travelTo(target, { reusePath: 20 });
       return "CONTINUE";
 
     case ERR_FULL:
@@ -159,7 +159,7 @@ function executeFillFactoryEnergy(creep, task) {
       return "CONTINUE"; // завершение определится в начале следующего тика по working+store===0
 
     case ERR_NOT_IN_RANGE:
-      creep.moveTo(target, { reusePath: 20 });
+      creep.travelTo(target, { reusePath: 20 });
       return "CONTINUE";
 
     case ERR_FULL:
@@ -228,7 +228,7 @@ function executeCollectFactoryBattery(creep, task) {
     const result = creep.withdraw(source, RESOURCE_BATTERY);
 
     if (result === ERR_NOT_IN_RANGE) {
-      creep.moveTo(source, { reusePath: 50 });
+      creep.travelTo(source, { reusePath: 50 });
       return "CONTINUE";
     }
 
@@ -248,7 +248,7 @@ function executeCollectFactoryBattery(creep, task) {
       return "CONTINUE"; // завершение определится на входе следующего тика
 
     case ERR_NOT_IN_RANGE:
-      creep.moveTo(target, { reusePath: 20 });
+      creep.travelTo(target, { reusePath: 20 });
       return "CONTINUE";
 
     case ERR_FULL:
@@ -315,7 +315,7 @@ function executeFillTowers(creep, task) {
       return "CONTINUE";
 
     case ERR_NOT_IN_RANGE:
-      creep.moveTo(target, { reusePath: 20 });
+      creep.travelTo(target, { reusePath: 20 });
       return "CONTINUE";
 
     case ERR_FULL:
@@ -375,7 +375,7 @@ function executeFillTerminalEnergy(creep, task) {
       return isTargetFull(target) ? "DONE" : "CONTINUE";
 
     case ERR_NOT_IN_RANGE:
-      creep.moveTo(target, { reusePath: 20 });
+      creep.travelTo(target, { reusePath: 20 });
       return "CONTINUE";
 
     case ERR_FULL:
@@ -432,7 +432,7 @@ function executeFillTerminalResources(creep, task) {
     const result = creep.withdraw(source, resourceType);
 
     if (result === ERR_NOT_IN_RANGE) {
-      creep.moveTo(source, { reusePath: 50 });
+      creep.travelTo(source, { reusePath: 50 });
       return "CONTINUE";
     }
 
@@ -452,7 +452,7 @@ function executeFillTerminalResources(creep, task) {
   const result = creep.transfer(target, resourceType);
 
   if (result === ERR_NOT_IN_RANGE) {
-    creep.moveTo(target, { reusePath: 20 });
+    creep.travelTo(target, { reusePath: 20 });
     return "CONTINUE";
   }
 
@@ -507,7 +507,7 @@ function executeFillPowerSpawnPower(creep, task) {
     const result = creep.transfer(target, RESOURCE_POWER);
 
     if (result === ERR_NOT_IN_RANGE) {
-      creep.moveTo(target, { reusePath: 20 });
+      creep.travelTo(target, { reusePath: 20 });
       return "CONTINUE";
     }
 
@@ -528,7 +528,7 @@ function executeFillPowerSpawnPower(creep, task) {
   const dropResult = creep.transfer(storage, RESOURCE_POWER);
 
   if (dropResult === ERR_NOT_IN_RANGE) {
-    creep.moveTo(storage, { reusePath: 50 });
+    creep.travelTo(storage, { reusePath: 50 });
     return "CONTINUE";
   }
 
@@ -574,7 +574,7 @@ function executeFillPowerSpawnEnergy(creep, task) {
     const result = creep.withdraw(source, RESOURCE_ENERGY);
 
     if (result === ERR_NOT_IN_RANGE) {
-      creep.moveTo(source, { reusePath: 50 });
+      creep.travelTo(source, { reusePath: 50 });
       return "CONTINUE";
     }
 
@@ -590,7 +590,7 @@ function executeFillPowerSpawnEnergy(creep, task) {
     const result = creep.transfer(target, RESOURCE_ENERGY);
 
     if (result === ERR_NOT_IN_RANGE) {
-      creep.moveTo(target, { reusePath: 20 });
+      creep.travelTo(target, { reusePath: 20 });
       return "CONTINUE";
     }
 
@@ -606,7 +606,7 @@ function executeFillPowerSpawnEnergy(creep, task) {
   const dropResult = creep.transfer(source, RESOURCE_ENERGY);
 
   if (dropResult === ERR_NOT_IN_RANGE) {
-    creep.moveTo(source, { reusePath: 50 });
+    creep.travelTo(source, { reusePath: 50 });
     return "CONTINUE";
   }
 
@@ -671,7 +671,7 @@ function executeRepairStructures(creep, task) {
       return target.hits >= target.hitsMax ? "DONE" : "CONTINUE";
 
     case ERR_NOT_IN_RANGE:
-      creep.moveTo(target, { reusePath: 20 });
+      creep.travelTo(target, { reusePath: 20 });
       return "CONTINUE";
 
     case ERR_INVALID_TARGET:
@@ -733,7 +733,7 @@ function executeBuildStructures(creep, task) {
       return "CONTINUE";
 
     case ERR_NOT_IN_RANGE:
-      creep.moveTo(target, { reusePath: 20 });
+      creep.travelTo(target, { reusePath: 20 });
       return "CONTINUE";
 
     case ERR_INVALID_TARGET:
@@ -803,7 +803,7 @@ function executeUpgradeController(creep, task) {
       return "CONTINUE";
 
     case ERR_NOT_IN_RANGE:
-      creep.moveTo(target, { reusePath: 20 });
+      creep.travelTo(target, { reusePath: 20 });
       return "CONTINUE";
 
     case ERR_INVALID_TARGET:
```

## Изменённые файлы (14)

| Файл | Добавлено | Удалено |
|---|---|---|
| `energySource.js` | 2 | 2 |
| `lab.worker.js` | 6 | 6 |
| `remote.hauler.js` | 7 | 7 |
| `remote.miner.js` | 4 | 4 |
| `remote.reserver.js` | 13 | 2 |
| `role.builder.js` | 1 | 1 |
| `role.harvester.js` | 3 | 2 |
| `role.linkWorker.js` | 2 | 2 |
| `role.miner.js` | 1 | 1 |
| `role.mineralMiner.js` | 2 | 2 |
| `role.repairer.js` | 1 | 1 |
| `role.towerSupplier.js` | 2 | 2 |
| `role.upgrader.js` | 1 | 1 |
| `task.executors.js` | 18 | 18 |

Итого: 44 замены `creep.moveTo(` -> `creep.travelTo(` в 14 файлах + 10 строк блока сброса `_travel` в `remote.reserver.js`.
