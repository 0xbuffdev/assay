import assert from "node:assert/strict";
import { stat } from "node:fs/promises";

for (const output of ["dist/index.js", "dist/index.d.ts"]) {
  assert.ok((await stat(new URL(`../${output}`, import.meta.url))).isFile(), `Missing ${output}`);
}

const entry = await import("@0xbuff/assay");
assert.deepEqual(Object.keys(entry), [], "No evaluation functions may be exported before AY-I01");

console.log("Built ESM entry and declarations verified");
