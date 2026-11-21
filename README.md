# Assay

**Deterministic technical evaluation against explicit criteria and bounded evidence.**

Assay is a standalone, provider-neutral TypeScript library being developed to validate versioned technical assessment definitions, compare typed observations and return reproducible criterion-level findings.

Assay **does not** execute untrusted programs, verify learner identity, award academic credit, issue certificates or depend on OEE/0xNAND. Consumers own execution provenance, official assessment admission and final decisions.

> **Foundation only.** No evaluation API, distributed package or npm release exists yet. The npm package is intentionally unpublishable until the license and release are separately approved.

## Planned behavior

- Strictly validate versioned definitions, bounded evidence and comparison policy.
- Compare exact/normalized text, numbers with explicit tolerance and sets under declared semantics.
- Distinguish `pass`, `fail`, `inconclusive`, `invalid_definition`, `invalid_evidence` and `evaluation_error`.
- Keep required criteria separate from advisory findings. Empty requirements, missing references and provider errors never silently pass.
- Return reproducible, versioned findings rather than a host-controlled grade.

These are **requirements, not implemented features**. The accepted [specification](https://github.com/0xbuffdev/context/blob/main/repos/assay/specs/0001-evaluation-core.md) and [AY implementation tickets](https://github.com/0xbuffdev/context/blob/main/repos/assay/tickets.md) govern the work.

## Development

The foundation provides a placeholder ESM entry with no exported evaluation behavior. On Node.js 24+ with pnpm 11.2.2:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

`AY-I01` introduces the first validated contracts; `AY-I02` adds deterministic comparators; `AY-I03` adds optional observation ports; and `AY-I04` establishes external package, security and release acceptance. TypeScript compilation, distributable declarations and packed-consumer verification will be introduced with implementation work, not claimed by this foundation.

See [architecture](docs/architecture.md), [development](docs/development.md), [release policy](docs/releasing.md), [contributing](CONTRIBUTING.md) and [security](SECURITY.md).

## License

No open-source license grant is approved yet. The repository uses `UNLICENSED` and `private: true` in its package metadata until a separate maintainer decision. Repository visibility and npm publishing are different from source licensing; do not assume reuse rights.
