declare global {
  interface RoomMemory {
    tasks?: Record<string, any[]>;
    terminalExports?: Record<string, number>;
    terminalResourcesFrom?: Record<string, number>;
    mineral?: any;
    links?: any;
    structureCache?: any;
    underAttack?: boolean;
    // Порог прочности стен для башенного ремонта: растёт на
    // TOWER.WALL_THRESHOLD_STEP каждый скан, когда стен ниже порога нет.
    wallThreshold?: number;
    role?: string;
    minerSpots?: any[];
    labWorkerIndex?: number;
    // ── лабораторное производство (lab.recipes / LAB_PLAN) ────────────────
    // Тройки лабораторий: labs…labs5 — производственные (с двумя рецептами
    // recipeA/recipeB и порогами low/high), boostLab — буст-лаба комнаты
    // (в производстве не участвует), boostConfig — её ресурсы.
    labs?: any;
    labs2?: any;
    labs3?: any;
    labs4?: any;
    labs5?: any;
    boostLab?: string;
    boostConfig?: { labId?: string; boost?: string[] };
  }

  interface CreepMemory {
    role?: string;
    homeRoom?: string;
    // ── режимы ролей ─────────────────────────────────────────────────────
    working?: boolean;
    // ── Task System (worker.runner) ──────────────────────────────────────
    // Ссылка на взятую (зарезервированную) Task из FIFO Memory.rooms[*].tasks.
    task?: any;
    // Категория (ключ TASK_CHAIN) удерживаемой Task. Хранится строкой, а не
    // индексом цепочки: порядок TASK_CHAIN — конфиг приоритета.
    taskType?: string;
    // Устаревшее поле старой версии (категория как индекс TASK_CHAIN).
    // Не используется; оставлено, чтобы старые записи Memory не роняли tsc.
    taskIndex?: number;
    // ── пачечная добыча (role.miner / remote.miner) ──────────────────────
    harvestInterval?: number;
    harvestPerCall?: number;
    // ── дальняя добыча (remote.*) ────────────────────────────────────────
    targetRoom?: string | null;
    sourceId?: string | null;
    containerId?: string | null;
    containerSiteId?: string | null;
    containerCheckedAt?: number;
    droppedId?: string | null;
    waitSourceId?: string | null;
    nextHaulSearch?: number;
    // Позиция контроллера удалённой комнаты: маршрут резервера идёт к ней,
    // а не к центру комнаты (см. docs/REMOTE-BORDER-PING-PONG.md).
    controllerPos?: { x: number; y: number } | null;
    // ── Traveler (traveler.js) ───────────────────────────────────────────
    _travel?: any;
    _lastRoom?: string;
    // ── бустирование (boost.manager) ─────────────────────────────────────
    // Фаза «обеспечить запас в буст-лабе»: крип везёт буст из storage/terminal.
    boostLab?: { labId: string; resource: string; parts: number; sourceId?: string };
    // Фаза «бустить»: крип идёт к буст-лабе и вызывает lab.boostCreep().
    boostTask?: { labId: string; resource: string; parts: number };
    // Тик, до которого попытка буста не повторяется (ресурса не было).
    boostWait?: number;
    // Тик старта текущей процедуры буста: по нему жёсткий лимит
    // LAB_BOOST.MAX_BUSY_TICKS отдаёт управление роли (буст оппортунистический).
    boostSince?: number;
  }

  interface Memory {
    _taskIdSeq?: number;
    remoteRoleCache?: any;
    remoteRoleCacheCount?: number;
    remoteRoleCacheUpdatedAt?: number;
    reserverConfig?: any;
    towerState?: Record<string, any>;
    cpuMonitorEnabled?: boolean;
    cpuStats?: { total: number; count: number; average: number };
    rallyOverride?: any;
    attackAlert?: { room: string; time: number };
    // Диагностика бустирования (boost.manager.mark) — по комнате строка
    // текущего состояния: "need XKH2O" / "boosted XKH2O" / "partial XKH2O" /
    // "no stock" (реально нет запаса) / "бусты выданы" (все квоты политики уже
    // закрыты — это норма, а не дефицит) / "boost abandoned" / "лаба занята …" /
    // "ждём очистки лабы".
    __boostMetric?: Record<string, string>;
    // Журнал сделок по X (market.manager.logXDeal): последние 5 записей вида
    // {t: тик, a: "buy"|"sell", r: комната, n: объём, p: цена}.
    __xDeal?: Array<{ t: number; a: string; r: string; n: number; p: number }>;
    // Явный выключатель бустов (LAB_BOOST.OFF_FLAG).
    labBoostOff?: boolean;
    // Счётчики событий Task System (task.manager.noteTaskEvent): ключи вида
    // "событие:категория" — "pickup:fillFactoryEnergy", "done:…", "skip:…",
    // "preempt:…". Нужны живым замерам, чтобы различать «задачу никто не взял» и
    // «взял, но бросил ради более приоритетной». Накопительные, сбрасываются
    // явно через taskManager.clearTaskEvents(); потолок размера — 4 × 11 ключей.
    __taskEvents?: Record<string, number>;
    // Журнал автозакупки реагентов лаб (market.manager.logLabDeal): последние 5
    // записей {t, r: комната-получатель, res: ресурс, n: объём, p: цена}.
    // Отдельно от __xDeal: тот читают live-скрипты как журнал ИМЕННО X.
    __labBuys?: Array<{
      t: number;
      r: string;
      res: string;
      n: number;
      p: number;
    }>;
    // Диагностика автозакупки лаб: ресурсы, признанные дефицитом на последнем
    // запуске рынка, строками "РЕСУРС:запас/порог". Пишется только при дефиците.
    __labImport?: { t: number; need: string[] };
  }

  interface _HasId {
    store?: any;
    hits?: number;
    hitsMax?: number;
    ticksToDowngrade?: number;
    mineralAmount?: number;
    cooldown?: number;
    transferEnergy?: (...args: any[]) => any;
    structureType?: string;
    room?: any;
    pos?: any;
    amount?: number;
    energy?: number;
    runReaction?: (...args: any[]) => any;
    mineralType?: string;
    observeRoom?: (...args: any[]) => any;
  }
  interface Creep {
  travelTo?: (destination: any, options?: any) => any;
}

  var _: any;
  var global: any;
}

export { };
