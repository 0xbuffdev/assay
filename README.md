# Assay

**Deterministic technical evaluation against explicit criteria and bounded evidence.**

Assay is a standalone, provider-neutral TypeScript library being developed to validate versioned technical assessment definitions, compare typed observations and return reproducible criterion-level findings.

Assay **does not** execute untrusted programs, verify learner identity, award academic credit, issue certificates or depend on OEE/0xNAND. Consumers own execution provenance, official assessment admission and final decisions.

> **AY-I01 source implemented, unreleased.** Versioned contract validation and evidence-coverage inspection are available in source. Comparators and final technical evaluation are not yet implemented. The npm package remains unpublishable until a separate release authorization.

## Planned behavior

- Strictly validate versioned definitions, bounded evidence and comparison policy.
- Compare exact/normalized text, numbers with explicit tolerance and sets under declared semantics.
- Distinguish `pass`, `fail`, `inconclusive`, `invalid_definition`, `invalid_evidence` and `evaluation_error`.
- Keep required criteria separate from advisory findings. Empty requirements, missing references and provider errors never silently pass.
- Return reproducible, versioned findings rather than a host-controlled grade.

Validated input contracts and evidence coverage are implemented; comparison and evaluation behavior are **not**. The accepted [specification](https://github.com/0xbuffdev/context/blob/main/repos/assay/specs/0001-evaluation-core.md) and [AY implementation tickets](https://github.com/0xbuffdev/context/blob/main/repos/assay/tickets.md) govern the work.

## Development

The source exports strict schema validation but no comparison/evaluation function. On Node.js 24+ with pnpm 11.2.2:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

Use `pnpm format` to apply Biome formatting; `pnpm format:check` and `pnpm lint` run non-mutating checks. Relative TypeScript imports use extensionless specifiers (for example `../src/index`); the emitted ESM package still uses `.js` distribution filenames.

`AY-I01` establishes the source contract validation implemented here. `AY-I02` adds deterministic comparators; `AY-I03` adds optional observation ports; and `AY-I04` establishes external package, security and release acceptance. The scaffold already builds an ESM bundle and type declarations using tsdown and verifies them with a self-import. Formal packed-consumer acceptance remains an AY-I04 release gate.

See the [AY-I01 contract API and safety limits](docs/contracts.md), [architecture](docs/architecture.md), [development](docs/development.md), [release policy](docs/releasing.md), [contributing](CONTRIBUTING.md) and [security](SECURITY.md).

## License

Assay is licensed under the [Apache License, Version 2.0](LICENSE). See [copyright and attribution](COPYRIGHT.md) for details. The package remains `private: true` to prevent premature npm publication; this flag does not restrict the open-source permissions granted by Apache-2.0. No npm release has been authorized.
