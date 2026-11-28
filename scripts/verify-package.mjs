/**
 * AY-I04: independently pack, inspect and install the actual Assay npm archive.
 *
 * Quality-only: npm pack is local, npm install is offline with scripts ignored,
 * and no publish, network service, credential, tag or workspace link is used.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// npm.cmd is a Windows batch shim. Node 24 deliberately rejects spawning it
// without a shell, and enabling a shell would be unsafe with temp paths.
// Resolve the npm JavaScript entry alongside the active Node installation
// and launch it using process.execPath on every platform.
const nodeDirectory = path.dirname(process.execPath);
const npmEntryCandidates = [
  path.resolve(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
  path.resolve(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  path.resolve(nodeDirectory, "..", "node_modules", "npm", "bin", "npm-cli.js"),
];
const npmEntry = npmEntryCandidates.find((candidate) => existsSync(candidate));
assert.ok(
  npmEntry,
  "npm's JavaScript CLI must be installed alongside the active Node.js executable",
);
const fixtureDir = path.join(root, "tests", "consumer");
const expectedArchiveFiles = [
  "CHANGELOG.md",
  "COPYRIGHT.md",
  "LICENSE",
  "README.md",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/index.js.map",
  "package.json",
].sort();

function command(program, args, cwd, environment = {}) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_offline: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
      ...environment,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      "Independent consumer verification failed: " +
        [program, ...args].join(" ") +
        "\n" +
        (result.stderr || result.stdout || result.error?.message || "").slice(0, 6000),
    );
  }
  return result.stdout;
}

const workspace = await mkdtemp(path.join(tmpdir(), "assay-ay-i04-"));
try {
  const archiveDir = path.join(workspace, "archive");
  const consumerDir = path.join(workspace, "consumer");
  await mkdir(archiveDir);
  await mkdir(consumerDir);

  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.name, "@0xbuff/assay");
  assert.equal(manifest.version, "0.0.1", "Verify the approved first release candidate");
  assert.equal(manifest.private, false, "Approved publishable package metadata");
  assert.deepEqual(manifest.publishConfig, {
    access: "public",
    registry: "https://registry.npmjs.org/",
  });
  assert.equal(manifest.license, "Apache-2.0", "Approved source license must remain intact");
  assert.equal(manifest.type, "module", "The public entry must be ESM");
  assert.deepEqual(manifest.exports, {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js",
    },
  });
  for (const field of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
    "bundledDependencies",
    "bundleDependencies",
  ]) {
    assert.equal(
      Object.keys(manifest[field] ?? {}).length,
      0,
      `The standalone public package must not require runtime/peer dependencies: ${field}`,
    );
  }
  for (const field of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
    "devDependencies",
  ]) {
    for (const spec of Object.values(manifest[field] ?? {})) {
      assert.equal(typeof spec, "string", "Dependency specifier must be a literal string");
      assert.ok(
        !/^(workspace:|catalog:|file:|link:|git\+|github:|https?:)/.test(spec),
        "Source package must not depend on a workspace, private path, Git or remote URL",
      );
    }
  }
  for (const name of [
    "prepack",
    "postpack",
    "prepare",
    "prepublish",
    "prepublishOnly",
    "publish",
    "postpublish",
    "preinstall",
    "install",
    "postinstall",
  ]) {
    assert.equal(
      Object.hasOwn(manifest.scripts ?? {}, name),
      false,
      `Package lifecycle scripts must not execute while installing the archive: ${name}`,
    );
  }

  const packed = JSON.parse(
    command(
      process.execPath,
      [
        npmEntry,
        "pack",
        "--ignore-scripts",
        "--offline",
        "--json",
        "--pack-destination",
        archiveDir,
      ],
      root,
    ),
  );
  assert.equal(packed.length, 1);
  const item = packed[0];
  assert.equal(item.name, manifest.name);
  assert.equal(item.version, manifest.version);
  assert.ok(/^[A-Za-z0-9._-]+\.tgz$/.test(item.filename), "Archive path must be a safe basename");
  assert.deepEqual(
    (item.files ?? []).map((file) => file.path).sort(),
    expectedArchiveFiles,
    "Strict tarball file allowlist must exclude test, internal docs, fixtures and secrets",
  );

  const archive = path.join(archiveDir, item.filename);
  assert.ok(existsSync(archive), "The packed archive must exist on disk");
  const consumerManifest = {
    name: "assay-independent-consumer-fixture",
    version: "0.0.0",
    private: true,
    type: "module",
  };
  await writeFile(
    path.join(consumerDir, "package.json"),
    `${JSON.stringify(consumerManifest, null, 2)}\n`,
  );

  // npm install from a local tarball, from outside the repository:
  // no workspace imports, registry calls, installation scripts or dev dependencies.
  command(
    process.execPath,
    [
      npmEntry,
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--no-save",
      "--omit=dev",
      archive,
    ],
    consumerDir,
  );
  const nodeModules = path.join(consumerDir, "node_modules");
  assert.deepEqual(
    (await readdir(nodeModules)).filter((name) => !name.startsWith(".")).sort(),
    ["@0xbuff"],
    "Only the packed Assay package is permitted in the independent consumer",
  );
  assert.deepEqual(await readdir(path.join(nodeModules, "@0xbuff")), ["assay"]);

  const installed = path.join(nodeModules, "@0xbuff", "assay");
  const installedManifest = JSON.parse(
    await readFile(path.join(installed, "package.json"), "utf8"),
  );
  assert.equal(installedManifest.name, "@0xbuff/assay");
  assert.equal(installedManifest.version, manifest.version);
  assert.equal(installedManifest.type, manifest.type);
  assert.deepEqual(installedManifest.engines, manifest.engines);
  assert.equal(installedManifest.private, false);
  assert.deepEqual(installedManifest.publishConfig, manifest.publishConfig);
  assert.equal(installedManifest.license, "Apache-2.0");
  assert.deepEqual(installedManifest.exports, manifest.exports);
  assert.match(
    await readFile(path.join(installed, "LICENSE"), "utf8"),
    /Apache License\s+Version 2\.0/,
  );
  assert.match(
    await readFile(path.join(installed, "COPYRIGHT.md"), "utf8"),
    /Copyright 2026 0xBUFF/,
  );

  // Inspect built source, sourcemap and declarations for known canaries from
  // tests. An allowlist is essential; substring scanning is supplemental and
  // cannot substitute a broader source/license/security review.
  for (const name of ["dist/index.js", "dist/index.js.map", "dist/index.d.ts"]) {
    const contents = await readFile(path.join(installed, name), "utf8");
    assert.ok(contents.length > 0, "Every compiled payload must be nonempty");
    for (const canary of [
      "PRIVATE_TEST_REF",
      "PRIVATE_CANARY_MUST_NOT_ECHO",
      "SECRET_ACCESS_TOKEN_IN_RUNNER_ERROR",
      "SENSITIVE_EXCEPTION",
      "AYI25_PRIVATE_",
      "AYI08_PRIVATE_",
      "AYI27_PRIVATE_",
      "AYI28_PRIVATE_",
    ]) {
      assert.ok(!contents.includes(canary), "Test or private sentinel entered the shipped package");
    }
  }

  await writeFile(
    path.join(consumerDir, "consumer.mjs"),
    await readFile(path.join(fixtureDir, "consumer.mjs"), "utf8"),
  );
  command(process.execPath, ["consumer.mjs"], consumerDir);
  await writeFile(
    path.join(consumerDir, "version-vectors.mjs"),
    await readFile(path.join(fixtureDir, "version-vectors.mjs"), "utf8"),
  );
  command(process.execPath, ["version-vectors.mjs"], consumerDir);
  await writeFile(
    path.join(consumerDir, "standalone-assessments.mjs"),
    await readFile(path.join(fixtureDir, "standalone-assessments.mjs"), "utf8"),
  );
  const scenarioOutput = command(process.execPath, ["standalone-assessments.mjs"], consumerDir);
  assert.match(scenarioOutput, /AY-I25 installed standalone assessment scenarios passed/);
  assert.match(scenarioOutput, /AY-I28 installed expanded assessment scenarios passed/);
  console.log(scenarioOutput.trim());

  // Execute the exact shipped README example against the installed entry.
  const readme = await readFile(path.join(installed, "README.md"), "utf8");
  const quickStart = /## Quick start\r?\n[\s\S]*?```ts\r?\n([\s\S]*?)\r?\n```/.exec(readme)?.[1];
  assert.ok(quickStart, "The shipped README must include its quick-start example");
  await writeFile(path.join(consumerDir, "quick-start.mjs"), quickStart);
  assert.equal(command(process.execPath, ["quick-start.mjs"], consumerDir).trim(), "pass");
  // A separate tiny host console declaration keeps the package typecheck free of DOM/Node types.
  await writeFile(
    path.join(consumerDir, "quick-start.ts"),
    `declare const console: { log(value: unknown): void };\n${quickStart}`,
  );
  await writeFile(
    path.join(consumerDir, "consumer.ts"),
    await readFile(path.join(fixtureDir, "consumer.ts.txt"), "utf8"),
  );
  await writeFile(
    path.join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
          lib: ["ES2022"],
        },
        include: ["consumer.ts", "quick-start.ts"],
      },
      null,
      2,
    )}\n`,
  );
  const compiler = path.join(root, "node_modules", "typescript", "bin", "tsc");
  assert.ok(existsSync(compiler), "The authoring toolchain must include TypeScript");
  // The compiler executable comes from the authoring dev toolchain. Its
  // module/type resolution starts in the isolated consumer directory.
  command(process.execPath, [compiler, "--project", "tsconfig.json"], consumerDir);
  console.log("AY-I28 installed expanded TypeScript contracts verified");
  const archiveBytes = await readFile(archive);
  const archiveMetadata = {
    name: item.name,
    version: item.version,
    bytes: archiveBytes.byteLength,
    sha256: createHash("sha256").update(archiveBytes).digest("hex"),
    files: item.files.map(({ path, size }) => ({ path, size })),
  };
  const retainDirectory = process.env.ASSAY_ARCHIVE_DIR;
  if (retainDirectory !== undefined) {
    assert.ok(path.isAbsolute(retainDirectory), "Use a new absolute archive directory");
    await mkdir(retainDirectory);
    await writeFile(path.join(retainDirectory, "assay.tgz"), archiveBytes, { flag: "wx" });
    await writeFile(
      path.join(retainDirectory, "manifest.json"),
      `${JSON.stringify(archiveMetadata, null, 2)}\n`,
      { flag: "wx" },
    );
  }
  console.log("AY-I26 candidate archive", JSON.stringify(archiveMetadata));
  console.log(
    "AY-I04 packed consumer verified: exact file allowlist, Apache-2.0, no runtime deps, " +
      "offline no-script install, public ESM API, hostile cases and isolated TypeScript declarations",
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
