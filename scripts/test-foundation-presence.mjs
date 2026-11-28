import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "tests/conformance.test.ts",
  "tests/adversarial.test.ts",
  "tests/resources.test.ts",
  "tests/expanded-conformance.test.ts",
  "tests/expanded-resources.test.ts",
  "tests/consumer/consumer.mjs",
  "tests/consumer/consumer.ts.txt",
  "tests/consumer/version-vectors.mjs",
  "tests/consumer/standalone-assessments.mjs",
];

function foundation() {
  const result = spawnSync(process.execPath, ["scripts/check-foundation.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.ifError(result.error);
  return result;
}

assert.equal(foundation().status, 0, "Foundation must pass before omission probes");
for (const file of files) {
  const original = path.join(root, file);
  const hidden = `${original}.presence-probe`;
  await rename(original, hidden);
  try {
    const result = foundation();
    assert.equal(result.status, 1, `Missing suite must fail: ${file}`);
    assert.ok(result.stderr.includes(`Missing required file: ${file}`), result.stderr);
  } finally {
    await rename(hidden, original);
  }
}
assert.equal(foundation().status, 0, "Foundation must pass after restoring all fixtures");
console.log("Mandatory suite and consumer fixture omission probes passed");
