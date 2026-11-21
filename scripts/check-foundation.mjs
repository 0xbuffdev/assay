import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const locate = (relative) => path.join(root, relative);
const pkg = JSON.parse(await readFile(locate("package.json"), "utf8"));
const ts = JSON.parse(await readFile(locate("tsconfig.json"), "utf8"));

assert.equal(pkg.name, "@0xbuff/assay");
assert.equal(pkg.type, "module");
assert.equal(pkg.private, true, "Never publish before independent release approval");
assert.equal(pkg.license, "Apache-2.0", "Assay source must retain its approved license");
assert.deepEqual(Object.keys(pkg.exports), ["."]);
assert.equal(pkg.exports["."].types, "./dist/index.d.ts");
assert.equal(pkg.exports["."].import, "./dist/index.js");
assert.equal(pkg.packageManager, "pnpm@11.2.2");
assert.ok(pkg.files.includes("LICENSE"), "Include license in eventual package artifacts");
assert.ok(
  pkg.files.includes("COPYRIGHT.md"),
  "Include copyright notice in eventual package artifacts",
);
assert.equal(pkg.engines.node, ">=24");
assert.equal(ts.compilerOptions.moduleResolution, "bundler");
assert.equal(ts.compilerOptions.module, "ESNext");
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, "Pure core must have no runtime deps");
assert.deepEqual(Object.keys(pkg.devDependencies ?? {}).sort(), [
  "@biomejs/biome",
  "@types/node",
  "tsdown",
  "typescript",
  "vitest",
]);

for (const file of [
  "README.md",
  "LICENSE",
  "COPYRIGHT.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "docs/architecture.md",
  "docs/development.md",
  "docs/releasing.md",
  "pnpm-lock.yaml",
  "biome.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "tsdown.config.ts",
  "vitest.config.ts",
  "src/index.ts",
  "src/contracts.ts",
  "src/validation.ts",
  "src/evaluate.ts",
  "tests/evaluate.test.ts",
  "tests/contracts.test.ts",
  "tests/fixtures/contracts.ts",
  "docs/contracts.md",
  "docs/evaluation.md",
  "tests/foundation.test.ts",
  "scripts/verify-dist.mjs",
  ".github/workflows/ci.yml",
]) {
  assert.ok((await stat(locate(file))).isFile(), `Missing required file: ${file}`);
}

const entry = await readFile(locate("src/index.ts"), "utf8");
assert.match(entry, /parseAssessmentDefinition/, "AY-I01 must expose contract validation");
assert.match(entry, /parseEvidenceBundle/, "AY-I01 must expose evidence validation");
assert.match(entry, /evaluate/, "AY-I02 must expose deterministic comparison");

// Prevent extensionful .js specifiers in all authored TypeScript modules.
for (const rootDirectory of ["src", "tests"]) {
  const pending = [rootDirectory];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;

    for (const item of await readdir(locate(directory), { withFileTypes: true })) {
      const relativePath = path.join(directory, item.name);
      if (item.isDirectory()) {
        pending.push(relativePath);
      } else if (item.isFile() && /\.tsx?$/.test(item.name)) {
        const content = await readFile(locate(relativePath), "utf8");
        const imports = content.matchAll(
          /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/g,
        );
        for (const match of imports) {
          assert.ok(
            !match[1].endsWith(".js"),
            `Use an extensionless TypeScript import in ${relativePath}: ${match[1]}`,
          );
        }
      }
    }
  }
}

console.log("Assay foundation metadata and source import checks passed");
