# DATA OWNERSHIP

## Главный принцип

Каждая система владеет только своими данными.

Другие системы:

- могут читать данные;
- могут отправлять requests;
- НЕ могут напрямую изменять чужое состояние.

---

# EconomyManager

Владеет:

- global economy state;
- resource priorities;
- strategic reserves;
- deficit analysis;
- surplus analysis;
- production goals;
- strategic resource values.

---

# FactoryDirector

Владеет:

- production queues;
- factory assignments;
- production execution;
- factory status.

FactoryDirector НЕ имеет права:

- менять strategic priorities;
- менять global economy state.

---

# MarketManager

Владеет:

- market orders;
- trade execution;
- price tracking;
- market statistics.

MarketManager НЕ имеет права:

- менять strategic reserves;
- менять production priorities.

---

# LogisticsDirector

Владеет:

- resource routing;
- delivery priorities;
- transfer scheduling;
- balancing operations.

---

# RoomManager

Владеет:

- local room state;
- local tasks;
- room infrastructure status.

RoomManager НЕ имеет права:

- менять global economy state.

---

# FORBIDDEN

Запрещено:

- direct cross-manager mutation;
- hidden state modification;
- uncontrolled global writes;
- managers overriding each other.

---

# FINAL PRINCIPLE

Изменять данные может только владелец данных.
