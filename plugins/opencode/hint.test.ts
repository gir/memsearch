import assert from "node:assert/strict";
import test from "node:test";
import { HintCache } from "./hint.ts";

test("hint cache never blocks and spawns at most once per ttl", async () => {
  let calls = 0; let clock = 0;
  const cache = new HintCache(async () => `hint${++calls}`, 1000, () => clock);
  assert.equal(cache.get(), "");
  for (let i = 0; i < 50; i++) cache.get();
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 1);
  assert.equal(cache.get(), "hint1");
  clock = 999; cache.get(); assert.equal(calls, 1);
  clock = 1000; assert.equal(cache.get(), "hint1");
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 2);
  assert.equal(cache.get(), "hint2");
});

test("hint cache keeps the previous value when refresh fails", async () => {
  let fail = false; let clock = 0;
  const cache = new HintCache(async () => { if (fail) throw new Error("x"); return "ok"; }, 10, () => clock);
  cache.get(); await new Promise(r => setImmediate(r));
  fail = true; clock = 20; cache.get(); await new Promise(r => setImmediate(r));
  assert.equal(cache.get(), "ok");
});
