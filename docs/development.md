# Development

The foundation is an intentionally small one-package ESM project, with zero runtime or development dependencies. It is not yet a distributable library.

## Run foundation checks

Node.js 24+ and pnpm 11.2.2:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

The check validates repository metadata, required files and the absence of accidentally enabled publishing. The test imports the placeholder TypeScript entry using Node's built-in type stripping; it does **not** satisfy Assay's evaluation test matrix.

## Next changes

AY-I01 introduces reviewed type contracts and tests. At that stage add pinned TypeScript and test/build tooling, lockfile updates, a real `tsc` typecheck, emitted ESM/declarations and a separate consumer installation check. Do not ship source-only `src/index.ts` as an npm package export. Keep the core provider-neutral and avoid a monorepo or premature UI/CLI/service layers.

CI remains read-only and cannot publish. PR merge, package license, signed tags and release approval are separate maintainer decisions.
