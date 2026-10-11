import { createInitialState, migrateAssembly, type AssemblyState } from "./assembly";
import { createCatalogStyleHint, restoreCatalogStyle } from "./catalog-style";
import { encodeConfig } from "./config-code";
import { createNewUserState } from "./starter-assembly";
import { createDraftStorage, type DraftStorage } from "./storage";

export const ASSEMBLY_STORAGE_KEY = "hamilymart.assembly.v2";
export const STYLE_STORAGE_KEY = "hamilymart.catalog-style.v1";

export interface DraftSession {
  state: AssemblyState;
  messages: string[];
  styleIndex: number;
  writeBlocked: boolean;
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
    if (!legacy.ok || legacy.value !== null) stored = legacy;
    migratedLegacy = legacy.ok && legacy.value !== null;
    if (migratedLegacy && storedStyle.ok && storedStyle.value === null) {
      storedStyle = await store.readLegacyForMigration(STYLE_STORAGE_KEY);
    }
  }
  let state = createNewUserState();
  let messages: string[] = [];
  let writeBlocked = !stored.ok;
  if (stored.ok && stored.value !== null) {
    try {
      const result = migrateAssembly(JSON.parse(stored.value));
      state = result.state;
      messages = migratedLegacy ? ["已载入升级前的搭配，将保存到本地缓存；旧存档仍保留。", ...result.messages] : result.messages;
    } catch {
      state = createInitialState();
      writeBlocked = true;
    }
  }
  if (writeBlocked) {
    messages = ["本地搭配暂时无法载入，原存档已保留。本次修改不会覆盖原存档；可粘贴编号恢复，并在清单中手动复制保存。"];
  }
  const styleIndex = restoreCatalogStyle(state, encodeConfig(state), storedStyle.ok ? storedStyle.value : null);
  let pending: Promise<boolean> = Promise.resolve(true);

  return {
    state, messages, styleIndex, writeBlocked,
    persist(nextState, nextStyleIndex) {
      if (writeBlocked) return Promise.resolve(false);
      let serializedState: string;
      let serializedStyle: string;
      try {
        serializedState = JSON.stringify(nextState);
        serializedStyle = JSON.stringify(createCatalogStyleHint(nextStyleIndex, encodeConfig(nextState)));
      } catch {
        return Promise.resolve(false);
      }
      // Native writes may finish out of order. Serializing keeps the latest design last.
      pending = pending.then(async () => {
        if (!await store.write(ASSEMBLY_STORAGE_KEY, serializedState)) return false;
        // An unreadable preference is preserved too; its design does not prevent normal editing.
        if (!storedStyle.ok) return false;
        return store.write(STYLE_STORAGE_KEY, serializedStyle);
      }).catch(() => false);
      return pending;
    },
  };
}
