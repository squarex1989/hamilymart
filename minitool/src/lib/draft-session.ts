import { createInitialState, migrateAssembly, validateAssembly, type AssemblyState } from "./assembly";
import { createCatalogStyleHint, restoreCatalogStyle } from "./catalog-style";
import { encodeConfig } from "./config-code";
import { createNewUserState } from "./starter-assembly";
import { createDraftStorage, sameStoredJson, type DraftStorage } from "./storage";

export const ASSEMBLY_STORAGE_KEY = "hamilymart.assembly.v2";
export const STYLE_STORAGE_KEY = "hamilymart.catalog-style.v1";

export interface DraftSession {
  state: AssemblyState;
  messages: string[];
  styleIndex: number;
  writeBlocked: boolean;
  saveError?: string | null;
  persist: (state: AssemblyState, styleIndex: number) => Promise<boolean>;
}

/** Hydrate before showing editable controls; a slow read must never replace a user's edits. */
export async function loadDraftSession(storage?: DraftStorage): Promise<DraftSession> {
  const store = storage || await createDraftStorage();
  let [stored, storedStyle] = await Promise.all([store.read(ASSEMBLY_STORAGE_KEY), store.read(STYLE_STORAGE_KEY)]);
  let migratedLegacy = false;
  // A successful null is the only signal that permits consulting the old browser draft.
  // API failures are not evidence that native storage is empty.
  if (stored.ok && stored.value === null && store.readLegacyForMigration) {
    const legacy = await store.readLegacyForMigration(ASSEMBLY_STORAGE_KEY);
    // Browser migration is optional once native storage has confirmed no draft exists.
    if (legacy.ok && legacy.value !== null) stored = legacy;
    migratedLegacy = legacy.ok && legacy.value !== null;
    if (migratedLegacy && storedStyle.ok && storedStyle.value === null) {
      storedStyle = await store.readLegacyForMigration(STYLE_STORAGE_KEY);
    }
  }
  let state = createNewUserState();
  let messages: string[] = [];
  let writeBlocked = !stored.ok;
  let failureReason = "存储接口暂时不可用";
  if (stored.ok && stored.value !== null) {
    try {
      const result = migrateAssembly(JSON.parse(stored.value));
      state = result.state;
      messages = migratedLegacy ? ["已载入升级前的搭配，将保存到本地缓存；旧存档仍保留。", ...result.messages] : result.messages;
    } catch (error) {
      failureReason = error instanceof SyntaxError ? "存档内容不完整或格式错误" : error instanceof Error ? error.message : "存档格式不正确";
      state = createInitialState();
      writeBlocked = true;
    }
  }
  if (writeBlocked) {
    messages = [`本地搭配未能载入：${failureReason}。原存档保留；修改后会先备份原存档，再保存新搭配。`];
  }
  const styleIndex = restoreCatalogStyle(state, encodeConfig(state), storedStyle.ok ? storedStyle.value : null);
  let pending: Promise<boolean> = Promise.resolve(true);

  return {
    state, messages, styleIndex, get writeBlocked() { return writeBlocked; },
    get saveError() { return store.getLastWriteError?.() ?? null; },
    persist(nextState, nextStyleIndex) {
      // React saves once on mount too. Only an actual edit/import may replace a failed draft.
      if (writeBlocked && nextState === state) return Promise.resolve(false);
      let serializedState: string;
      let serializedStyle: string;
      try {
        serializedState = JSON.stringify(validateAssembly(nextState));
        serializedStyle = JSON.stringify(createCatalogStyleHint(nextStyleIndex, encodeConfig(nextState)));
      } catch {
        return Promise.resolve(false);
      }
      // Native writes may finish out of order. Serializing keeps the latest design last.
      pending = pending.then(async () => {
        if (writeBlocked) {
          // A failed read is not proof that no original exists. Retry before touching it.
          if (!stored.ok) stored = await store.read(ASSEMBLY_STORAGE_KEY);
          if (!stored.ok) return false;
          if (stored.value !== null) {
            const backup = JSON.stringify({ original: stored.value, style: storedStyle.ok ? storedStyle.value : null });
            let key = `${ASSEMBLY_STORAGE_KEY}.recovery`;
            const existing = await store.read(key);
            if (!existing.ok) return false;
            if (existing.value !== null && existing.value !== backup) {
              key += `.${Date.now()}`;
              const slot = await store.read(key);
              if (!slot.ok || (slot.value !== null && slot.value !== backup)) return false;
            }
            if (!await store.write(key, backup)) return false;
            const verified = await store.read(key);
            if (!verified.ok || !sameStoredJson(verified.value, backup)) return false;
          }
        }
        if (!await store.write(ASSEMBLY_STORAGE_KEY, serializedState)) return false;
        writeBlocked = false;
        // An unreadable preference is preserved too; its design does not prevent normal editing.
        if (storedStyle.ok) await store.write(STYLE_STORAGE_KEY, serializedStyle).catch(() => false);
        return true; // All component colors are already in the successfully saved design.
      }).catch(() => false);
      return pending;
    },
  };
}
