declare global {
  interface RoomMemory {
    tasks?: Record<string, any[]>;
    terminalExports?: Record<string, number>;
    terminalResourcesFrom?: Record<string, number>;
    mineral?: any;
    links?: any;
    structureCache?: any;
    lastWallHits?: number;
    underAttack?: boolean;
    role?: string;
    minerSpots?: any[];
    labWorkerIndex?: number;
  }

  interface CreepMemory {
    role?: string;
    homeRoom?: string;
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
