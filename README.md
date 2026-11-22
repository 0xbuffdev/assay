# Assay

**Deterministic technical evaluation against explicit criteria and bounded evidence.**

Assay is a standalone, provider-neutral TypeScript library being developed to validate versioned technical assessment definitions, compare typed observations and return reproducible criterion-level findings.

Assay **does not** execute untrusted programs, verify learner identity, award academic credit, issue certificates or depend on OEE/0xNAND. Consumers own execution provenance, official assessment admission and final decisions.

> **AY-I04 release-readiness checks implemented; still unreleased.** The source supports validated contracts, deterministic comparisons, and optional injected observations. The CI gate now installs and tests an offline tarball in an independent ESM/TypeScript consumer. Provenance and execution trust remain host responsibilities; the npm package is still private and unpublished.

## Implemented behavior and planned boundaries

- Strictly validate versioned definitions, bounded evidence and comparison policy.
- Compare exact/normalized text, numbers with explicit tolerance and sets under declared semantics.
- Distinguish `pass`, `fail`, `inconclusive`, `invalid_definition`, `invalid_evidence` and `evaluation_error`.
- Keep required criteria separate from advisory findings. Empty requirements, missing references and provider errors never silently pass.
- Return reproducible, versioned findings rather than a host-controlled grade.

Strict validation, objective deterministic comparison and optional bounded observation collection are implemented. Verified execution provenance, protected reference resolution, and formal host decisions are **not**. The accepted [specification](https://github.com/0xbuffdev/context/blob/main/repos/assay/specs/0001-evaluation-core.md) and [AY implementation tickets](https://github.com/0xbuffdev/context/blob/main/repos/assay/tickets.md) govern the work.

## Development

The source exports strict schema validation, pure deterministic `evaluate()` and optional async `collectObservations()`. On Node.js 24+ with pnpm 11.2.2:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

Use `pnpm format` to apply Biome formatting; `pnpm format:check` and `pnpm lint` run non-mutating checks. Relative TypeScript imports use extensionless specifiers (for example `../src/index`); the emitted ESM package still uses `.js` distribution filenames.

`AY-I01` provides validated contracts; `AY-I02` provides objective comparators and fail-closed aggregation; `AY-I03` adds a bounded injected observation port and claimed provenance receipts. `AY-I04` now validates the actual local tarball with an independently installed Node/TypeScript consumer and strict packaging/security gates. Run `pnpm verify:package` after `pnpm build` to repeat that check. Quality acceptance is not a publication authorization.

See the [optional observation port and threat boundaries](docs/observations.md), [evaluation semantics](docs/evaluation.md), [contract API and safety limits](docs/contracts.md), [architecture](docs/architecture.md), [development](docs/development.md), [package acceptance and release policy](docs/releasing.md), [contributing](CONTRIBUTING.md) and [security](SECURITY.md).

## License

Assay is licensed under the [Apache License, Version 2.0](LICENSE). See [copyright and attribution](COPYRIGHT.md) for details. The package remains `private: true` to prevent premature npm publication; this flag does not restrict the open-source permissions granted by Apache-2.0. No npm release has been authorized.
