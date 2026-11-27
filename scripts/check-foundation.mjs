import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tsCompiler from "typescript";

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
assert.equal(pkg.scripts["verify:package"], "node scripts/verify-package.mjs");
assert.match(pkg.scripts.check, /verify:package/, "Pack must be included in full quality checks");
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

const sourcePaths = new Set([
  "src/contracts/common.ts",
  "src/contracts/definition.ts",
  "src/contracts/evidence.ts",
  "src/contracts/observation.ts",
  "src/contracts/projection.ts",
  "src/contracts/reference.ts",
  "src/contracts/result.ts",
  "src/contracts/validation.ts",
  "src/evaluation/aggregate.ts",
  "src/evaluation/comparators/finding.ts",
  "src/evaluation/comparators/number.ts",
  "src/evaluation/comparators/review.ts",
  "src/evaluation/comparators/set.ts",
  "src/evaluation/comparators/text.ts",
  "src/evaluation/compare.ts",
  "src/evaluation/evaluate.ts",
  "src/index.ts",
  "src/integrity/canonical.ts",
  "src/integrity/definition.ts",
  "src/integrity/evidence.ts",
  "src/integrity/reference.ts",
  "src/integrity/sha256.ts",
  "src/observation/collect.ts",
  "src/projection/public.ts",
  "src/validation/coverage.ts",
  "src/validation/definition.ts",
  "src/validation/evidence.ts",
  "src/validation/observation.ts",
  "src/validation/reference.ts",
  "src/validation/result.ts",
  "src/validation/shared.ts",
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
  ...sourcePaths,
  "tests/evaluate.test.ts",
  "tests/observation.test.ts",
  "tests/numeric-units.test.ts",
  "tests/integrity.test.ts",
  "tests/reference.test.ts",
  "tests/evidence-integrity.test.ts",
  "tests/projection.test.ts",
  "tests/contracts.test.ts",
  "tests/fixtures/contracts.ts",
  "docs/contracts.md",
  "docs/integrity.md",
  "docs/projection.md",
  "docs/evaluation.md",
  "docs/observations.md",
  "tests/foundation.test.ts",
  "tests/aggregation.test.ts",
  "scripts/verify-dist.mjs",
  "scripts/verify-package.mjs",
  "tests/consumer/consumer.mjs",
  "tests/consumer/consumer.ts.txt",
  ".github/workflows/ci.yml",
]) {
  assert.ok((await stat(locate(file))).isFile(), `Missing required file: ${file}`);
}

const entry = await readFile(locate("src/index.ts"), "utf8");
assert.match(entry, /parseAssessmentDefinition/, "AY-I01 must expose contract validation");
assert.match(entry, /parseEvidenceBundle/, "AY-I01 must expose evidence validation");
assert.match(entry, /evaluate/, "AY-I02 must expose deterministic comparison");
assert.match(entry, /collectObservations/, "AY-I03 must expose optional observation collection");
assert.match(entry, /verifyAssessmentDefinition/, "Expose definition integrity verification");
assert.doesNotMatch(entry, /evaluateVerified|collectVerifiedObservations/, "No redundant aliases");
assert.match(entry, /projectPublicResult/, "AY-I07 must expose restricted-safe projections");

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

// The package root is the only public entry; implementation modules never import it.
const edges = new Map();
const allowedLayers = {
  contracts: ["contracts"],
  validation: ["contracts", "validation"],
  integrity: ["contracts", "integrity", "validation"],
  evaluation: ["contracts", "evaluation", "validation", "integrity"],
  observation: ["contracts", "observation", "validation", "integrity"],
  projection: ["contracts", "projection", "validation", "integrity", "evaluation"],
};

for (const file of sourcePaths) {
  const source = await readFile(locate(file), "utf8");
  const dependencies = [];
  const syntax = tsCompiler.createSourceFile(file, source, tsCompiler.ScriptTarget.ES2022, true);
  const imports = [];
  function inspect(node) {
    if (tsCompiler.isImportDeclaration(node) || tsCompiler.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        assert.ok(tsCompiler.isStringLiteral(node.moduleSpecifier), `Nonliteral import in ${file}`);
        imports.push(node.moduleSpecifier.text);
      }
    } else if (tsCompiler.isImportTypeNode(node)) {
      assert.ok(
        tsCompiler.isLiteralTypeNode(node.argument) &&
          tsCompiler.isStringLiteral(node.argument.literal),
        `Nonliteral type import in ${file}`,
      );
      imports.push(node.argument.literal.text);
    } else if (
      tsCompiler.isImportEqualsDeclaration(node) ||
      (tsCompiler.isCallExpression(node) &&
        (node.expression.kind === tsCompiler.SyntaxKind.ImportKeyword ||
          (tsCompiler.isIdentifier(node.expression) && node.expression.text === "require")))
    ) {
      assert.fail(`Use static ESM dependencies in source: ${file}`);
    }
    tsCompiler.forEachChild(node, inspect);
  }
  inspect(syntax);
  for (const specifier of imports) {
    assert.ok(specifier.startsWith("."), `External source import in ${file}: ${specifier}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    const target = `${resolved}.ts`;
    assert.ok(sourcePaths.has(target), `Untracked module in ${file}: ${target}`);
    assert.notEqual(target, "src/index.ts", `Internal dependency on public root: ${file}`);
    if (file !== "src/index.ts") {
      const layer = file.split("/")[1];
      const targetLayer = target.split("/")[1];
      assert.ok(
        allowedLayers[layer]?.includes(targetLayer),
        `Forbidden dependency: ${file} -> ${target}`,
      );
      if (file.startsWith("src/evaluation/comparators/")) {
        assert.ok(
          targetLayer === "contracts" || target.startsWith("src/evaluation/comparators/"),
          `Comparator depends on orchestration: ${file} -> ${target}`,
        );
      }
      if (file === "src/evaluation/aggregate.ts") {
        assert.equal(targetLayer, "contracts", "Aggregation must remain a pure contract operation");
      }
      if (layer === "projection" && targetLayer === "evaluation") {
        assert.equal(target, "src/evaluation/aggregate.ts");
      }
      if (layer === "evaluation" && targetLayer === "integrity") {
        assert.equal(file, "src/evaluation/evaluate.ts");
      }
      if (layer === "observation" && targetLayer === "integrity") {
        assert.equal(file, "src/observation/collect.ts");
      }
    }
    dependencies.push(target);
  }
  edges.set(file, dependencies);
}

// Reject untracked source files and cycles rather than silently omitting new modules.
const pendingSources = ["src"];
while (pendingSources.length > 0) {
  const directory = pendingSources.pop();
  if (!directory) break;
  for (const item of await readdir(locate(directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, item.name);
    if (item.isDirectory()) pendingSources.push(relative);
    else if (item.isFile() && /\.tsx?$/.test(item.name)) {
      assert.ok(sourcePaths.has(relative), `Untracked source file: ${relative}`);
    }
  }
}
for (const consumer of ["src/evaluation/evaluate.ts", "src/projection/public.ts"]) {
  assert.ok(
    edges.get(consumer).includes("src/evaluation/aggregate.ts"),
    `Required aggregation must share one owner: ${consumer}`,
  );
}

const active = new Set();
const visited = new Set();
function visit(file) {
  assert.ok(!active.has(file), `Cyclic source dependency: ${file}`);
  if (visited.has(file)) return;
  active.add(file);
  for (const target of edges.get(file)) visit(target);
  active.delete(file);
  visited.add(file);
}
for (const file of sourcePaths) visit(file);

console.log("Assay foundation metadata and source import checks passed");
