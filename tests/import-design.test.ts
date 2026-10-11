import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, setBedding } from "../src/lib/assembly";
import { encodeConfig } from "../src/lib/config-code";
import { decodePastedDesign } from "../src/lib/import-design";

const state = createInitialState();
const code = encodeConfig(state);
test("imports raw codes and full order lists with Unicode names and prices", () => {
  for (const text of [code, ` \n${code}\n `, `HamilyMart 搭配清单\n平台 × 1 | ¥30.00\n合计：¥30.00\n搭配编号：\r\n${code}\r\n`]) {
    assert.equal(encodeConfig(decodePastedDesign(text).state), code);
  }
});
test("rejects conflicting designs instead of choosing one silently", () => {
  const next = setBedding(state, { mode: "thick", depth: 200 });
  assert.ok(next.ok);
  assert.throws(() => decodePastedDesign(`${code}\n${encodeConfig(next.state)}`), /多个搭配编号/);
  assert.equal(encodeConfig(decodePastedDesign(`${code}\n${code}`).state), code);
});
test("keeps strict version, checksum, and length checks for pasted lists", () => {
  const changed = code.slice(0, -1) + (code.endsWith("0") ? "1" : "0");
  assert.throws(() => decodePastedDesign(`搭配编号：\n${changed}`), /校验失败/);
  assert.throws(() => decodePastedDesign(`${code}0`), /完整/);
  assert.throws(() => decodePastedDesign(`HM9.${code.split(".").slice(1).join(".")}`), /版本/);
  assert.throws(() => decodePastedDesign("只有价格清单，没有编号"), /没有找到/);
  assert.throws(() => decodePastedDesign("x".repeat(200_001)), /过长/);
});
