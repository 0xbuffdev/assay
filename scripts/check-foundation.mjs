import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const locate = (relative) => path.join(root, relative);
const pkg = JSON.parse(await readFile(locate("package.json"), "utf8"));

assert.equal(pkg.name, "@0xbuff/assay");
assert.equal(pkg.type, "module");
assert.equal(pkg.private, true, "Never publish before independent release approval");
assert.equal(pkg.license, "UNLICENSED", "License approval is a separate decision");
assert.equal(pkg.exports["."], "./src/index.ts");
assert.equal(pkg.packageManager, "pnpm@11.2.2");
assert.equal(pkg.engines.node, ">=24");
for (const key of ["dependencies", "peerDependencies", "devDependencies"]) {
  assert.equal(Object.keys(pkg[key] ?? {}).length, 0, `Unexpected foundation ${key}`);
}
for (const file of [
  "README.md", "AGENTS.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md",
  "SECURITY.md", "CHANGELOG.md", "docs/architecture.md",
  "docs/development.md", "docs/releasing.md", "pnpm-lock.yaml",
  "tsconfig.json", "src/index.ts", "tests/foundation.test.ts",
  ".github/workflows/ci.yml",
]) {
  assert.ok((await stat(locate(file))).isFile(), `Missing required file: ${file}`);
}
assert.match(await readFile(locate("src/index.ts"), "utf8"), /export \{\}/);
console.log("Assay foundation checks passed");
