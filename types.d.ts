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
  }

  interface CreepMemory {
    role?: string;
    homeRoom?: string;
    // ── режимы ролей ─────────────────────────────────────────────────────
    working?: boolean;
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
