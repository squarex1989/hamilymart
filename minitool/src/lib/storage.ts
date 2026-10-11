/** Only the public, documented mini-tool APIs are used here. */
export interface LaunchOptions {
  miniToolEnv?: { buildVersion?: number | string };
}

export interface MiniToolStorageApi {
  getLaunchOptions?: () => Promise<LaunchOptions>;
  getStorage?: (options: { key: string }) => Promise<{ data: string | null }>;
  setStorage?: (options: { key: string; data: string }) => Promise<unknown>;
}

export interface StorageEnvironment {
  xhs?: { launchOptions?: LaunchOptions; miniTool?: MiniToolStorageApi };
  getBrowserStorage: () => Pick<Storage, "getItem" | "setItem">;
  nativeTimeoutMs?: number;
}

export type StorageRead = { ok: true; value: string | null } | { ok: false };
export interface DraftStorage {
  backend: "native" | "browser";
  read: (key: string) => Promise<StorageRead>;
  write: (key: string, serializedData: string) => Promise<boolean>;
  /** One-time, read-only upgrade source, available only after native reports the key missing. */
  readLegacyForMigration?: (key: string) => Promise<StorageRead>;
}

const NATIVE_TIMEOUT_MS = 5000;
class StorageTimeoutError extends Error {}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new StorageTimeoutError("Native storage timed out")), timeoutMs);
    Promise.resolve(operation).then(value => {
      clearTimeout(timer);
      resolve(value);
    }, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function readBuildVersion(options: LaunchOptions | undefined): number {
  const value = Number(options && options.miniToolEnv && options.miniToolEnv.buildVersion);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function getBuildVersion(environment: StorageEnvironment, timeoutMs: number): Promise<number> {
  const xhs = environment.xhs;
  const syncBuildVersion = readBuildVersion(xhs && xhs.launchOptions);
  if (syncBuildVersion) return syncBuildVersion;
  const miniTool = xhs && xhs.miniTool;
  if (!miniTool || typeof miniTool.getLaunchOptions !== "function") return 0;
  try {
    return readBuildVersion(await withTimeout(miniTool.getLaunchOptions(), timeoutMs));
  } catch (error) {
    if (error instanceof StorageTimeoutError) throw error;
    return 0;
  }
}

function currentEnvironment(): StorageEnvironment {
  const host = window as Window & { xhs?: StorageEnvironment["xhs"] };
  return { xhs: host.xhs, getBrowserStorage: () => host.localStorage };
}

/** Choose once at startup, so a failed native operation never splits a draft across stores. */
export async function createDraftStorage(environment = currentEnvironment()): Promise<DraftStorage> {
  const timeoutMs = environment.nativeTimeoutMs && environment.nativeTimeoutMs > 0 ? environment.nativeTimeoutMs : NATIVE_TIMEOUT_MS;
  let buildVersion: number;
  try {
    buildVersion = await getBuildVersion(environment, timeoutMs);
  } catch {
    // An unresolved SDK may later report a supported version. Do not write elsewhere meanwhile.
    return { backend: "native", read: async () => ({ ok: false }), write: async () => false };
  }
  const miniTool = environment.xhs && environment.xhs.miniTool;
  if (Math.floor(buildVersion / 1000) >= 9460) {
    let timedOut = false;
    const missingKeys = new Set<string>();
    const legacyReads = new Map<string, StorageRead>();
    return {
      backend: "native",
      async read(key) {
        if (timedOut || !miniTool || typeof miniTool.getStorage !== "function") return { ok: false };
        try {
          const result = await withTimeout(miniTool.getStorage({ key }), timeoutMs);
          if (!result || (result.data !== null && typeof result.data !== "string")) return { ok: false };
          if (result.data === null) missingKeys.add(key);
          else missingKeys.delete(key);
          return { ok: true, value: result.data };
        } catch (error) {
          if (error instanceof StorageTimeoutError) timedOut = true;
          missingKeys.delete(key);
          return { ok: false };
        }
      },
      async write(key, data) {
        if (timedOut || !miniTool || typeof miniTool.setStorage !== "function") return false;
        try {
          await withTimeout(miniTool.setStorage({ key, data }), timeoutMs);
          missingKeys.delete(key);
          return true;
        } catch (error) {
          // A timed-out write may still finish later. Never start a newer write it could overwrite.
          if (error instanceof StorageTimeoutError) timedOut = true;
          return false;
        }
      },
      async readLegacyForMigration(key) {
        if (timedOut || !missingKeys.has(key)) return { ok: false };
        const previous = legacyReads.get(key);
        if (previous) return previous;
        let result: StorageRead;
        try {
          result = { ok: true, value: environment.getBrowserStorage().getItem(key) };
        } catch {
          result = { ok: false };
        }
        legacyReads.set(key, result);
        return result;
      },
    };
  }
  return {
    backend: "browser",
    async read(key) {
      try {
        return { ok: true, value: environment.getBrowserStorage().getItem(key) };
      } catch {
        return { ok: false };
      }
    },
    async write(key, data) {
      try {
        environment.getBrowserStorage().setItem(key, data);
        return true;
      } catch {
        return false;
      }
    },
  };
}
