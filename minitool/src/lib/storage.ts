/** Only the public, documented mini-tool APIs are used here. */
export interface LaunchOptions {
  miniToolEnv?: { buildVersion?: number | string };
}

export interface MiniToolStorageApi {
  getLaunchOptions?: () => Promise<LaunchOptions>;
  getStorage?: (options: { key: string }) => Promise<{ data: string | null }>;
  getStorageInfo?: () => Promise<{ keys: string[]; usedBytes?: number; limitBytes?: number }>;
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
  getLastWriteError?: () => string | null;
  /** One-time, read-only upgrade source, available only after native reports the key missing. */
  readLegacyForMigration?: (key: string) => Promise<StorageRead>;
}

/** Empty host values contain no JSON draft; nonempty malformed data stays recoverable. */
export function normalizeStoredValue(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}
export function sameStoredJson(actual: string | null, expected: string): boolean {
  if (actual === expected) return true;
  if (actual === null) return false;
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
    return JSON.stringify(value);
  };
  try { return canonical(JSON.parse(actual)) === canonical(JSON.parse(expected)); } catch { return false; }
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
    let lastWriteError: string | null = null;
    const store: DraftStorage = {
      backend: "native",
      getLastWriteError: () => lastWriteError,
      async read(key) {
        if (timedOut || !miniTool || typeof miniTool.getStorage !== "function") return { ok: false };
        try {
          const result = await withTimeout(miniTool.getStorage({ key }), timeoutMs);
          if (!result || (result.data !== null && typeof result.data !== "string")) throw new Error("Unreadable storage response");
          const value = normalizeStoredValue(result.data);
          if (value === null) missingKeys.add(key);
          else missingKeys.delete(key);
          return { ok: true, value };
        } catch (error) {
          // Reads have no late-write race: a later edit may retry after a timeout.
          missingKeys.delete(key);
          // Some hosts reject missing keys. Only a successful key inventory can
          // establish absence; a generic read failure must never overwrite a draft.
          if (!timedOut && typeof miniTool.getStorageInfo === "function") {
            try {
              const info = await withTimeout(miniTool.getStorageInfo(), timeoutMs);
              if (Array.isArray(info?.keys) && info.keys.every(value => typeof value === "string") && !info.keys.includes(key)) {
                missingKeys.add(key);
                return { ok: true, value: null };
              }
            } catch { /* A later read can retry; no write has started. */ }
          }
          return { ok: false };
        }
      },
      async write(key, data) {
        if (timedOut || !miniTool || typeof miniTool.setStorage !== "function") { lastWriteError = "存储接口暂时不可用"; return false; }
        try {
          await withTimeout(miniTool.setStorage({ key, data }), timeoutMs);
          missingKeys.delete(key);
          // Resolving setStorage is not proof of persistence. Verify the actual value.
          let check = await store.read(key);
          if (!check.ok || !sameStoredJson(check.value, data)) {
            await new Promise(resolve => setTimeout(resolve, 100));
            check = await store.read(key);
          }
          if (!check.ok) { lastWriteError = "无法读取并核对刚保存的搭配"; return false; }
          if (!sameStoredJson(check.value, data)) {
            lastWriteError = check.value === null ? "存储接口写入后仍返回空内容" : "存储接口读回的内容与写入不一致";
            return false;
          }
          lastWriteError = null;
          return true;
        } catch (error) {
          // A timed-out write may still finish later. Never start a newer write it could overwrite.
          if (error instanceof StorageTimeoutError) timedOut = true;
          lastWriteError = error instanceof StorageTimeoutError ? "存储写入超时，请重新打开后重试" : "存储接口拒绝了本次写入";
          return false;
        }
      },
      async readLegacyForMigration(key) {
        if (timedOut || !missingKeys.has(key)) return { ok: false };
        const previous = legacyReads.get(key);
        if (previous) return previous;
        let result: StorageRead;
        try {
          result = { ok: true, value: normalizeStoredValue(environment.getBrowserStorage().getItem(key)) };
        } catch {
          result = { ok: false };
        }
        legacyReads.set(key, result);
        return result;
      },
    };
    return store;
  }
  return {
    backend: "browser",
    async read(key) {
      try {
        return { ok: true, value: normalizeStoredValue(environment.getBrowserStorage().getItem(key)) };
      } catch {
        return { ok: false };
      }
    },
    async write(key, data) {
      try {
        const browser = environment.getBrowserStorage();
        browser.setItem(key, data);
        return sameStoredJson(normalizeStoredValue(browser.getItem(key)), data);
      } catch {
        return false;
      }
    },
  };
}
