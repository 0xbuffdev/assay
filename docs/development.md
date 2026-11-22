# Development

Assay is a single TypeScript/ESM package. Its foundation has **no runtime dependencies** and exports validated data contracts, evidence-coverage inspection, pure deterministic objective comparison, and optional injected observation collection. There are still no runtime dependencies. The build tools are development-only.

## Toolchain

- Node.js 24+
- pnpm 11.2.2 with a committed lockfile
- tsdown for ESM JavaScript and declaration bundling
- Vitest for automated tests
- Biome for formatting, import organization and linting
- TypeScript with `moduleResolution: "bundler"`

Run:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check:foundation
pnpm typecheck
pnpm format:check
pnpm lint
pnpm test
pnpm build
```

To apply formatting run `pnpm format`. `pnpm check` runs all foundation, type, style, test and build checks. CI executes equivalent read-only checks; no workflow publishes a package.

## Import convention

Relative TypeScript imports are **extensionless**:

```ts
import { validateDefinition } from "./validation/definition";
```

Do not write relative `.js` specifiers in TypeScript source. The build produces valid ESM files in `dist/`, and the package export map uses the generated `dist/index.js` and `dist/index.d.ts`. That emitted filename is not a source import style.

`tsdown.config.ts` uses the same general tsdown entry/build setup as Throughline, but no React, MDX, compiler extension adapter, browser UI or CLI is needed. `vitest.config.ts` targets Node tests only.

## Scope of the current checks

The tests verify versioned definitions, observations, findings, safety bounds and evidence coverage. The dist verifier checks that tsdown emitted executable ESM and declarations; it also smoke-tests deterministic comparison using the built ESM package. AY-I01 tests cover strict schema validation, bounded inputs, deterministic diagnostics and evidence coverage; AY-I02 tests cover comparator boundaries, replay, required/advisory precedence and unverified evidence. AY-I03 tests cover mock ports, provenance consistency, truncation, forged trust flags, restricted inputs, unsafe text and thrown provider errors. AY-I04 additionally requires a packed third-party consumer and release-security tests.

Assay source is Apache-2.0 licensed; the npm package remains unpublished and deliberately unpublishable until separately approved. A green check is not release authorization.
