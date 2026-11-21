import assert from "node:assert/strict";
import test from "node:test";
import * as assay from "../src/index.ts";

test("foundation exports no unreviewed public evaluation contract", () => {
  assert.deepEqual(Object.keys(assay), []);
});

test("root TypeScript entry imports without optional dependencies", async () => {
  const entry = await import("../src/index.ts");
  assert.equal(typeof entry, "object");
});
