import assert from "node:assert/strict";
import test from "node:test";
import { createDraftStorage, sameStoredJson, type MiniToolStorageApi, type StorageEnvironment } from "../src/lib/storage";
import { ASSEMBLY_STORAGE_KEY, STYLE_STORAGE_KEY, loadDraftSession } from "../src/lib/draft-session";
import { createInitialState, getPlatforms, validateAssembly } from "../src/lib/assembly";
import { applyColorStyle } from "../src/lib/color-styles";
import { createCatalogStyleHint } from "../src/lib/catalog-style";
import { encodeConfig } from "../src/lib/config-code";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: [string, string][] = [];
  return {
    data, writes,
    getItem(key: string) { return data.get(key) ?? null; },
    setItem(key: string, value: string) { writes.push([key, value]); data.set(key, value); },
  };
}

function nativeEnvironment(api: MiniToolStorageApi, buildVersion?: number | string): StorageEnvironment {
  return {
    xhs: { launchOptions: buildVersion ? { miniToolEnv: { buildVersion } } : undefined, miniTool: api },
    getBrowserStorage() { throw new Error("Browser storage must not be used for a supported native client"); },
  };
}

test("native storage uses synchronous version, ignores compilation suffix and serializes data", async () => {
  const calls: unknown[] = [];
  let current = '{"draft":1}';
  const store = await createDraftStorage(nativeEnvironment({
    getLaunchOptions: async () => { throw new Error("sync version must take precedence"); },
    getStorage: async options => { calls.push(options); return { data: current }; },
    setStorage: async options => { calls.push(options); current = options.data; },
  }, 9462004));
  assert.equal(store.backend, "native");
  assert.deepEqual(await store.read("draft"), { ok: true, value: '{"draft":1}' });
  assert.equal(await store.write("draft", '{"draft":2}'), true);
  assert.deepEqual(calls, [{ key: "draft" }, { key: "draft", data: '{"draft":2}' }, { key: "draft" }]);
});

test("native storage supports the exact 9.46.0 boundary and asynchronous launch options", async () => {
  let launches = 0;
  const store = await createDraftStorage(nativeEnvironment({
    getLaunchOptions: async () => { launches++; return { miniToolEnv: { buildVersion: "9460000" } }; },
    getStorage: async () => ({ data: null }),
    setStorage: async () => {},
  }));
  assert.equal(store.backend, "native");
  assert.equal(launches, 1);
  assert.deepEqual(await store.read("missing"), { ok: true, value: null });
});

test("unsupported versions use browser storage even if native methods are present", async () => {
  const browser = memoryStorage({ draft: '{"legacy":true}' });
  const store = await createDraftStorage({
    xhs: { launchOptions: { miniToolEnv: { buildVersion: 9459999 } }, miniTool: {
      getStorage: async () => { throw new Error("must not call an unsupported API"); },
      setStorage: async () => { throw new Error("must not call an unsupported API"); },
    } },
    getBrowserStorage: () => browser,
  });
  assert.equal(store.backend, "browser");
  assert.deepEqual(await store.read("draft"), { ok: true, value: '{"legacy":true}' });
  assert.equal(await store.write("draft", '{"legacy":false}'), true);
  assert.equal(browser.data.get("draft"), '{"legacy":false}');
});

test("absent SDK, absent nested launch fields and failed version lookup safely use browser storage", async () => {
  const browser = memoryStorage();
  for (const xhs of [undefined, {}, { launchOptions: {} }, { miniTool: { getLaunchOptions: async () => { throw new Error("unavailable"); } } }]) {
    const store = await createDraftStorage({ xhs, getBrowserStorage: () => browser });
    assert.equal(store.backend, "browser");
    assert.deepEqual(await store.read("missing"), { ok: true, value: null });
  }
});

test("native read/write failures and missing methods never fall through to browser storage", async () => {
  for (const api of [{}, {
    getStorage: async () => { throw new Error("read denied"); },
    setStorage: async () => { throw new Error("quota exceeded"); },
  }]) {
    const store = await createDraftStorage(nativeEnvironment(api, 9460000));
    assert.equal(store.backend, "native");
    assert.deepEqual(await store.read("draft"), { ok: false });
    assert.equal(await store.write("draft", "{}"), false);
  }
});

test("malformed native response is unreadable, not an empty draft", async () => {
  const store = await createDraftStorage(nativeEnvironment({
    getStorage: async () => ({}) as { data: string | null },
  }, 9460000));
  assert.deepEqual(await store.read("draft"), { ok: false });
});

test("browser storage access and quota failures return failure", async () => {
  const store = await createDraftStorage({ getBrowserStorage() { throw new Error("denied"); } });
  assert.deepEqual(await store.read("draft"), { ok: false });
  assert.equal(await store.write("draft", "{}"), false);
  const quotaStore = await createDraftStorage({ getBrowserStorage: () => ({ getItem: () => null, setItem: () => { throw new Error("quota"); } }) });
  assert.equal(await quotaStore.write("draft", "{}"), false);
});

test("a new user receives the starter house, pool and no bedding, then saves through the selected adapter", async () => {
  const browser = memoryStorage();
  const session = await loadDraftSession(await createDraftStorage({ getBrowserStorage: () => browser }));
  assert.equal(session.writeBlocked, false);
  assert.equal(session.state.bedding.mode, "none");
  assert.equal(getPlatforms(session.state)[0].baseInsert, "pool");
  assert.deepEqual(session.state.items.map(item => item.productId).sort(), ["planter", "roof-cottage", "villa"]);
  assert.equal(await session.persist(session.state, session.styleIndex), true);
  assert.deepEqual(validateAssembly(JSON.parse(browser.data.get(ASSEMBLY_STORAGE_KEY)!)), session.state);
});

test("valid saved design and matching palette are restored before any write", async () => {
  const state = applyColorStyle(createInitialState(), 1);
  const browser = memoryStorage({
    [ASSEMBLY_STORAGE_KEY]: JSON.stringify(state),
    [STYLE_STORAGE_KEY]: JSON.stringify(createCatalogStyleHint(1, encodeConfig(state))),
  });
  const session = await loadDraftSession(await createDraftStorage({ getBrowserStorage: () => browser }));
  assert.deepEqual(session.state, state);
  assert.equal(session.styleIndex, 1);
  assert.equal(browser.writes.length, 0);
});

test("unreadable drafts stay untouched on mount; edits back up the original before saving", async () => {
  for (const original of ["broken JSON", JSON.stringify({ ...createInitialState(), catalogVersion: 999 })]) {
    const browser = memoryStorage({ [ASSEMBLY_STORAGE_KEY]: original });
    const session = await loadDraftSession(await createDraftStorage({ getBrowserStorage: () => browser }));
    assert.equal(session.writeBlocked, true);
    assert.match(session.messages.join(""), /原存档保留/);
    assert.equal(await session.persist(session.state,0),false);
    assert.equal(browser.writes.length,0);
    const edited=applyColorStyle(createInitialState(),2);
    assert.equal(await session.persist(edited, 2), true);
    assert.equal(JSON.parse(browser.data.get(`${ASSEMBLY_STORAGE_KEY}.recovery`)!).original, original);
    assert.deepEqual(JSON.parse(browser.data.get(ASSEMBLY_STORAGE_KEY)!),edited);
    assert.equal(session.writeBlocked,false);
    const reopened=await loadDraftSession(await createDraftStorage({getBrowserStorage:()=>browser}));
    assert.deepEqual(reopened.state,edited);
  }
});

test("native read rejection preserves the unknown original and blocks future save attempts", async () => {
  let writes = 0;
  const store = await createDraftStorage(nativeEnvironment({
    getStorage: async () => { throw new Error("cannot read"); },
    setStorage: async () => { writes++; },
  }, 9460000));
  const session = await loadDraftSession(store);
  assert.equal(session.writeBlocked, true);
  assert.equal(await session.persist(createInitialState(), 0), false);
  assert.equal(writes, 0);
});

test("asynchronous native save rejection cannot be reported as saved", async () => {
  const store = await createDraftStorage(nativeEnvironment({
    getStorage: async ({ key }) => ({ data: key === ASSEMBLY_STORAGE_KEY ? JSON.stringify(createInitialState()) : null }),
    setStorage: async () => { await Promise.resolve(); throw new Error("write failed"); },
  }, 9460000));
  const session = await loadDraftSession(store);
  assert.equal(await session.persist(session.state, session.styleIndex), false);
});

test("asynchronous saves are serialized so an older draft cannot finish after the latest one", async () => {
  const writes: [string, string][] = [];
  let releaseFirst: (() => void) | undefined;
  const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve; });
  const persisted = new Map([[ASSEMBLY_STORAGE_KEY, JSON.stringify(createInitialState())]]);
  const store = await createDraftStorage(nativeEnvironment({
    getStorage: async ({ key }) => ({ data: persisted.get(key) ?? null }),
    setStorage: async ({ key, data }) => {
      writes.push([key, data]);
      if (writes.length === 1) await firstWrite;
      persisted.set(key, data);
    },
  }, 9460000));
  const session = await loadDraftSession(store);
  const first = createInitialState();
  const last = applyColorStyle(first, 2);
  const savingFirst = session.persist(first, 0);
  const savingLast = session.persist(last, 2);
  await Promise.resolve();
  assert.equal(writes.length, 1);
  releaseFirst!();
  assert.deepEqual(await Promise.all([savingFirst, savingLast]), [true, true]);
  assert.deepEqual(writes.filter(([key]) => key === ASSEMBLY_STORAGE_KEY).map(([, data]) => JSON.parse(data)), [first, last]);
  assert.equal(JSON.parse(writes[3][1]).configurationCode, encodeConfig(last));
});

test("an upgraded client restores its browser design and palette into native storage without deleting the legacy copy", async () => {
  const state = applyColorStyle(createInitialState(), 2);
  const hint = JSON.stringify(createCatalogStyleHint(2, encodeConfig(state)));
  const original = JSON.stringify(state);
  const browser = memoryStorage({ [ASSEMBLY_STORAGE_KEY]: original, [STYLE_STORAGE_KEY]: hint });
  let legacyReads = 0;
  const native = memoryStorage();
  const environment: StorageEnvironment = {
    xhs: { launchOptions: { miniToolEnv: { buildVersion: 9460000 } }, miniTool: {
      getStorage: async ({ key }) => ({ data: native.getItem(key) }),
      setStorage: async ({ key, data }) => { native.setItem(key, data); },
    } },
    getBrowserStorage: () => ({ getItem: key => { legacyReads++; return browser.getItem(key); }, setItem: browser.setItem }),
  };
  const session = await loadDraftSession(await createDraftStorage(environment));
  assert.equal(session.writeBlocked, false);
  assert.deepEqual(session.state, state);
  assert.equal(session.styleIndex, 2);
  assert.equal(legacyReads, 2);
  assert.equal(await session.persist(session.state, session.styleIndex), true);
  assert.equal(native.data.get(ASSEMBLY_STORAGE_KEY), original);
  assert.equal(native.data.get(STYLE_STORAGE_KEY), hint);
  assert.equal(browser.data.get(ASSEMBLY_STORAGE_KEY), original);
  assert.equal(browser.writes.length, 0);
  const reopened = await loadDraftSession(await createDraftStorage(environment));
  assert.deepEqual(reopened.state, state);
  assert.equal(legacyReads, 2, "a populated native store must not consult legacy data again");
});

test("legacy migration lookups require successful native null and are read once per key", async () => {
  let legacyReads = 0;
  const store = await createDraftStorage({
    ...nativeEnvironment({ getStorage: async () => ({ data: null }) }, 9460000),
    getBrowserStorage: () => ({ getItem: () => { legacyReads++; return "old"; }, setItem: () => { throw new Error("legacy writes prohibited"); } }),
  });
  assert.deepEqual(await store.readLegacyForMigration!("draft"), { ok: false });
  await store.read("draft");
  assert.deepEqual(await store.readLegacyForMigration!("draft"), { ok: true, value: "old" });
  assert.deepEqual(await store.readLegacyForMigration!("draft"), { ok: true, value: "old" });
  assert.equal(legacyReads, 1);
});

test("a native read failure does not consult or overwrite an available legacy draft", async () => {
  let legacyReads = 0;
  let nativeWrites = 0;
  const store = await createDraftStorage({
    ...nativeEnvironment({
      getStorage: async () => { throw new Error("native read denied"); },
      setStorage: async () => { nativeWrites++; },
    }, 9460000),
    getBrowserStorage: () => { legacyReads++; return memoryStorage({ [ASSEMBLY_STORAGE_KEY]: JSON.stringify(createInitialState()) }); },
  });
  const session = await loadDraftSession(store);
  assert.equal(session.writeBlocked, true);
  assert.equal(await session.persist(session.state, 0), false);
  assert.equal(legacyReads, 0);
  assert.equal(nativeWrites, 0);
});

test("an unreadable legacy design is preserved and cannot be masked by a new native draft", async () => {
  for (const original of ["bad json", JSON.stringify({ ...createInitialState(), catalogVersion: 999 })]) {
    const browser = memoryStorage({ [ASSEMBLY_STORAGE_KEY]: original });
    let writes = 0;
    const store = await createDraftStorage({
      ...nativeEnvironment({ getStorage: async () => ({ data: null }), setStorage: async () => { writes++; } }, 9460000),
      getBrowserStorage: () => browser,
    });
    const session = await loadDraftSession(store);
    assert.equal(session.writeBlocked, true);
    assert.equal(await session.persist(createInitialState(), 0), false);
    assert.equal(writes, 1, "unverified backup prevents replacing the original");
    assert.equal(browser.data.get(ASSEMBLY_STORAGE_KEY), original);
  }
});

test("a native-empty client with no legacy draft can save its starter design natively", async () => {
  const native = memoryStorage();
  const store = await createDraftStorage({
    ...nativeEnvironment({ getStorage: async ({key}) => ({ data: native.getItem(key) }), setStorage: async ({ key, data }) => { native.setItem(key, data); } }, 9460000),
    getBrowserStorage: () => memoryStorage(),
  });
  const session = await loadDraftSession(store);
  assert.equal(session.writeBlocked, false);
  assert.equal(session.state.items.length, 3);
  assert.equal(await session.persist(session.state, session.styleIndex), true);
  assert.equal(native.writes.length, 2);
});

test("a hung version lookup returns a locked session without browser fallback or retries", async () => {
  let launches = 0;
  let reads = 0;
  let writes = 0;
  let browserAccesses = 0;
  const store = await createDraftStorage({
    xhs: { miniTool: {
      getLaunchOptions: () => { launches++; return new Promise(() => {}); },
      getStorage: async () => { reads++; return { data: null }; },
      setStorage: async () => { writes++; },
    } },
    getBrowserStorage: () => { browserAccesses++; return memoryStorage(); },
    nativeTimeoutMs: 5,
  });
  const session = await loadDraftSession(store);
  assert.equal(session.writeBlocked, true);
  assert.equal(await session.persist(createInitialState(), 0), false);
  assert.equal(launches, 1);
  assert.equal(reads + writes + browserAccesses, 0);
});

test("a timed-out read can retry after recovery without overwriting before a user edit", async () => {
  let reads = 0;
  let writes = 0;
  let finish: ((result: { data: string | null }) => void) | undefined;
  const pending = new Promise<{ data: string | null }>(resolve => { finish = resolve; });
  const store = await createDraftStorage({
    ...nativeEnvironment({ getStorage: () => { reads++; return pending; }, setStorage: async () => { writes++; } }, 9460000),
    nativeTimeoutMs: 5,
  });
  const session = await loadDraftSession(store);
  assert.equal(session.writeBlocked, true);
  const startedReads = reads;
  finish!({ data: JSON.stringify(createInitialState()) });
  await Promise.resolve();
  assert.deepEqual(await store.read(ASSEMBLY_STORAGE_KEY), { ok: true, value: JSON.stringify(createInitialState()) });
  assert.equal(await session.persist(session.state, 0), false);
  assert.equal(reads, startedReads+1);
  assert.equal(writes, 0);
});

test("a hung native write fails visibly and prevents newer writes racing its late completion", async () => {
  let writes = 0;
  let finish: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const store = await createDraftStorage({
    ...nativeEnvironment({
      getStorage: async ({ key }) => ({ data: key === ASSEMBLY_STORAGE_KEY ? JSON.stringify(createInitialState()) : null }),
      setStorage: () => { writes++; return pending; },
    }, 9460000),
    nativeTimeoutMs: 5,
  });
  const session = await loadDraftSession(store);
  assert.equal(await session.persist(session.state, 0), false);
  assert.equal(await session.persist(applyColorStyle(session.state, 1), 1), false);
  finish!();
  await Promise.resolve();
  assert.equal(await session.persist(session.state, 0), false);
  assert.equal(writes, 1);
});


test("unavailable legacy browser storage cannot lock an empty, working native store", async () => {
  const native = memoryStorage();
  const store = await createDraftStorage(nativeEnvironment({
    getStorage: async ({key}) => ({data:native.getItem(key)}),
    setStorage: async ({key,data}) => native.setItem(key,data),
  },9460000));
  const session = await loadDraftSession(store);
  assert.equal(session.writeBlocked,false);
  assert.equal(await session.persist(session.state,session.styleIndex),true);
  assert.deepEqual(validateAssembly(JSON.parse(native.data.get(ASSEMBLY_STORAGE_KEY)!)),session.state);
});

test("optional palette failure does not report a successfully saved design as unsaved", async () => {
  for (const readFails of [true,false]) {
    const native = memoryStorage();
    const session = await loadDraftSession({backend:"native",
      read:async key => key===STYLE_STORAGE_KEY && readFails ? {ok:false} : {ok:true,value:null},
      write:async (key,data) => {if(key===STYLE_STORAGE_KEY)return false;native.setItem(key,data);return true;},
    });
    assert.equal(await session.persist(session.state,session.styleIndex),true);
    assert.deepEqual(validateAssembly(JSON.parse(native.data.get(ASSEMBLY_STORAGE_KEY)!)),session.state);
  }
});

test("missing-key errors need a native inventory confirming absence before first save", async () => {
  for (const keys of [[],[ASSEMBLY_STORAGE_KEY]]) {
    const native=memoryStorage();
    const session=await loadDraftSession(await createDraftStorage(nativeEnvironment({
      getStorage:async ({key})=>{const value=native.getItem(key);if(value!==null)return {data:value};throw new Error("key unavailable");},getStorageInfo:async()=>({keys:[...keys,...native.data.keys()]}),
      setStorage:async({key,data})=>native.setItem(key,data),
    },9460000)));
    assert.equal(session.writeBlocked,keys.length>0);
    assert.equal(await session.persist(session.state,session.styleIndex),keys.length===0);
    assert.equal(native.writes.length,keys.length===0?2:0);
  }
});

for(const failAt of ['backup-write','backup-read','current-write']) test(`recovery ${failAt} failure never reports saved or destroys the original`,async()=>{
 const original='unreadable old draft';const data=new Map([[ASSEMBLY_STORAGE_KEY,original]]);let backed=false;
 const session=await loadDraftSession({backend:'native',read:async key=>failAt==='backup-read'&&backed&&key.includes('recovery')?{ok:false}:{ok:true,value:data.get(key)??null},write:async(key,value)=>{if(failAt==='backup-write'&&key.includes('recovery')||failAt==='current-write'&&key===ASSEMBLY_STORAGE_KEY)return false;data.set(key,value);backed=true;return true;}});
 assert.equal(await session.persist(applyColorStyle(createInitialState(),1),1),false);
 assert.equal(data.get(ASSEMBLY_STORAGE_KEY),original);assert.equal(session.writeBlocked,true);
});
test('recovery preserves an earlier backup and serializes subsequent edits',async()=>{
 const browser=memoryStorage({[ASSEMBLY_STORAGE_KEY]:'bad draft',[`${ASSEMBLY_STORAGE_KEY}.recovery`]:'older recovery'});
 const session=await loadDraftSession(await createDraftStorage({getBrowserStorage:()=>browser}));
 const first=applyColorStyle(createInitialState(),1),last=applyColorStyle(createInitialState(),2);
 assert.deepEqual(await Promise.all([session.persist(first,1),session.persist(last,2)]),[true,true]);
 assert.equal(browser.data.get(`${ASSEMBLY_STORAGE_KEY}.recovery`),'older recovery');
 assert(browser.writes.some(([key,value])=>key.includes('.recovery.')&&JSON.parse(value).original==='bad draft'));
 assert.deepEqual(JSON.parse(browser.data.get(ASSEMBLY_STORAGE_KEY)!),last);
});

for(const empty of ['', '  \n\t']) test(`host blank ${JSON.stringify(empty)} means no draft, including recovery slots`,async()=>{
 const native=memoryStorage();const environment={...nativeEnvironment({getStorage:async({key})=>({data:native.getItem(key)??empty}),setStorage:async({key,data})=>native.setItem(key,data)},9460000),getBrowserStorage:()=>memoryStorage()};
 const session=await loadDraftSession(await createDraftStorage(environment));
 assert.equal(session.writeBlocked,false);assert.equal(session.messages.length,0);assert.equal(session.state.items.length,3);
 assert.equal(await session.persist(session.state,0),true);
 const edited=applyColorStyle(session.state,2);assert.equal(await session.persist(edited,2),true);
 const reopened=await loadDraftSession(await createDraftStorage(environment));assert.deepEqual(reopened.state,edited);
});
test('blank native entry still migrates an intact browser draft',async()=>{
 const saved=applyColorStyle(createInitialState(),1),native=memoryStorage(),browser=memoryStorage({[ASSEMBLY_STORAGE_KEY]:JSON.stringify(saved)});
 const environment={...nativeEnvironment({getStorage:async({key})=>({data:native.getItem(key)??''}),setStorage:async({key,data})=>native.setItem(key,data)},9460000),getBrowserStorage:()=>browser};
 const session=await loadDraftSession(await createDraftStorage(environment));assert.deepEqual(session.state,saved);assert.equal(await session.persist(session.state,1),true);assert.equal(browser.writes.length,0);
});
test('nonempty truncated JSON is backed up even when all absent keys return blank',async()=>{
 const original='{"version":1,"items":[';const native=memoryStorage({[ASSEMBLY_STORAGE_KEY]:original});
 const environment=nativeEnvironment({getStorage:async({key})=>({data:native.getItem(key)??''}),setStorage:async({key,data})=>native.setItem(key,data)},9460000);
 const session=await loadDraftSession(await createDraftStorage(environment));assert.equal(session.writeBlocked,true);assert.match(session.messages[0],/不完整/);
 assert.equal(await session.persist(session.state,0),false);assert.equal(native.writes.length,0);
 const edited=applyColorStyle(createInitialState(),2);assert.equal(await session.persist(edited,2),true);
 assert.equal(JSON.parse(native.getItem(ASSEMBLY_STORAGE_KEY+'.recovery')!).original,original);
 assert.deepEqual((await loadDraftSession(await createDraftStorage(environment))).state,edited);
});
for(const response of ['', '{"incomplete":', '{"different":true}'])test(`successful write with bad readback ${JSON.stringify(response)} is not reported saved`,async()=>{
 const store=await createDraftStorage(nativeEnvironment({getStorage:async()=>({data:response}),setStorage:async()=>{}},9460000));
 assert.equal(await store.write('draft','{"correct":true}'),false);assert.match(store.getLastWriteError!()!,/空内容|不一致/);
});
test('write verification accepts equivalent JSON and rejects reordered array data',async()=>{
 assert(sameStoredJson('{"b":2,"a":[1,2]}','{ "a": [1,2], "b":2 }'));
 assert(!sameStoredJson('{"a":[2,1]}','{"a":[1,2]}'));
 let saved='';const store=await createDraftStorage(nativeEnvironment({getStorage:async()=>({data:saved}),setStorage:async({data})=>{saved=JSON.stringify(JSON.parse(data),null,2)}},9460000));assert.equal(await store.write('draft','{"a":1}'),true);
});
