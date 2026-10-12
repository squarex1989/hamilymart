import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { addPlatform, createInitialState, getPlatforms, type AssemblyState } from "../src/lib/assembly";

type Snapshot = { state: AssemblyState; styleIndex: number };
type Setter<T> = T | ((previous: T) => T);
const apply = <T>(next: Setter<T>, previous: T): T => typeof next === "function" ? (next as (value: T) => T)(previous) : next;

function harness(appPath: string) {
  const source = ts.createSourceFile(appPath, readFileSync(new URL(appPath, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["giveInspiration", "commit", "select", "undo", "redo"];
  const declarations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? "")) declarations.push(node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(declarations.length, names.length);
  let state = createInitialState(), styleIndex = 3, history: Snapshot[] = [], future: Snapshot[] = [];
  state = { ...state, legHeight: 300, bedding: { mode: "thick", depth: 200 } };
  let selectedId: string | null = "base", activeProduct: string | null = "cube-house";
  const notices: string[] = [];
  const bindings = {
    get state() { return state; }, get styleIndex() { return styleIndex; },
    get platforms() { return getPlatforms(state); },
    get history() { return history; }, get future() { return future; },
    get selectedId() { return selectedId; }, get activeProduct() { return activeProduct; },
    ready: true,
    lastInspirationByPlatformCount: { current: {} as Record<number, string | undefined> },
    createInspiredDesign: (..._args: unknown[]): unknown => { throw new Error("missing helper fixture"); },
    setState: (next: Setter<AssemblyState>) => { state = apply(next, state); },
    setStyleIndex: (next: Setter<number>) => { styleIndex = apply(next, styleIndex); },
    setHistory: (next: Setter<Snapshot[]>) => { history = apply(next, history); },
    setFuture: (next: Setter<Snapshot[]>) => { future = apply(next, future); },
    setSelectedId: (next: string | null) => { selectedId = next; },
    setActiveProduct: (next: string | null) => { activeProduct = next; },
    setRotation() {},
    setViewResetKey() { assert.fail("inspiration must not reset the camera"); },
    notify: (message: string) => notices.push(message),
  };
  const context = vm.createContext(bindings);
  vm.runInContext(ts.transpileModule(declarations.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
  return { context, notices };
}

for (const path of ["../src/App.tsx", "../minitool/src/App.tsx"]) {
  test(`${path}: inspiration is one undoable edit that retains the active style and view`, () => {
    const { context, notices } = harness(path);
    const original = context.state as AssemblyState;
    const inspired = { ...original, removedCovers: ["H01"] };
    const calls: unknown[][] = [];
    context.createInspiredDesign = (...args: unknown[]) => {
      calls.push(args);
      return { ok: true, state: inspired, layout: { id: "one-courtyard", name: "转角小院" } };
    };
    context.giveInspiration();
    assert.deepEqual(calls, [[original, 3, undefined]]);
    assert.equal(context.state, inspired);
    assert.equal(context.state.legHeight, 300);
    assert.equal(context.state.bedding, original.bedding);
    assert.equal(context.styleIndex, 3);
    assert.equal(context.selectedId, null);
    assert.equal(context.activeProduct, null);
    assert.equal(context.history.length, 1);
    assert.equal(context.future.length, 0);
    assert.equal(context.lastInspirationByPlatformCount.current[1], "one-courtyard");
    assert.deepEqual(notices, ["转角小院"]);
    context.undo();
    assert.equal(context.state, original);
    assert.equal(context.styleIndex, 3);
    assert.equal(context.history.length, 0);
    assert.equal(context.future.length, 1);
    context.redo();
    assert.equal(context.state, inspired);
    assert.equal(context.styleIndex, 3);
    assert.equal(context.history.length, 1);
  });

  test(`${path}: readiness, failure and separate platform-count choices do not corrupt history`, () => {
    const { context, notices } = harness(path);
    let attempts = 0;
    const original = context.state;
    context.createInspiredDesign = () => { attempts++; return { ok: false, state: original, reason: "没有可用搭配" }; };
    context.ready = false;
    context.giveInspiration();
    assert.equal(attempts, 0);
    context.ready = true;
    context.giveInspiration();
    assert.equal(attempts, 1);
    assert.equal(context.state, original);
    assert.equal(context.history.length, 0);
    assert.equal(context.selectedId, "base");
    assert.deepEqual(notices, ["没有可用搭配"]);

    const next = addPlatform(original); assert(next.ok);
    context.setState(next.state);
    context.lastInspirationByPlatformCount.current[1] = "last-one";
    context.lastInspirationByPlatformCount.current[2] = "last-two";
    context.createInspiredDesign = (state: AssemblyState, style: number, previousId?: string) => {
      assert.equal(state, next.state); assert.equal(style, 3); assert.equal(previousId, "last-two");
      return { ok: true, state: { ...state, removedCovers: ["H01"] }, layout: { id: "next-two", name: "水岸探索" } };
    };
    context.giveInspiration();
    assert.equal(context.lastInspirationByPlatformCount.current[1], "last-one");
    assert.equal(context.lastInspirationByPlatformCount.current[2], "next-two");
    assert.equal(context.history.length, 1);
    assert.equal(context.styleIndex, 3);
  });
}
