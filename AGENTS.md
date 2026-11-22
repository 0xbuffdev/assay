# Assay repository instructions

Follow the [public Assay specification](https://github.com/0xbuffdev/context/blob/main/repos/assay/specs/0001-evaluation-core.md) and [AY implementation tickets](https://github.com/0xbuffdev/context/blob/main/repos/assay/tickets.md). Those accepted planning documents do not establish implemented APIs or published releases.

## Architecture and authority

Assay evaluates bounded, explicitly defined technical evidence. It does not execute submitted code, authenticate a person, approve formal assessment admission, award academic credit or issue credentials. The root core must work without OEE, 0xNAND, model providers, accounts, React, network APIs or a runner.

Never default missing required references, empty criteria, truncation or comparator failure to `pass`. Keep `pass`, `fail`, `inconclusive`, `invalid_definition`, `invalid_evidence` and `evaluation_error` distinct. Host identity, execution provenance, secret reference protection and formal decisions stay outside the public library.

Do not commit internal product context, protected grader cases, learner data, secrets or personal identifiers. No compatibility bridge for previously unshipped APIs.

## Development

Use Node 24+ and pinned pnpm 11.2.2. tsdown owns ESM/types bundling, Vitest owns tests and Biome owns formatting/linting. Run `pnpm install --frozen-lockfile`, `pnpm check` and check the exact CI head. Use `moduleResolution: "bundler"` with **extensionless relative imports in TypeScript**; do not add `.js` to TypeScript source import specifiers. The package export map legitimately names emitted `.js` files. Add security and external packed-consumer checks as the relevant AY tickets land.

Use one focused branch/PR per ticket, add reproducible positive/negative cases, update docs, and record exactly which checks ran. Assay source is Apache-2.0 licensed; preserve its license and copyright notices. Do not change repository visibility/ownership, relicense the source, publish a package, tag, merge or deploy without explicit maintainer authorization.

AY-I01 exports versioned contract parsing and evidence coverage inspection. AY-I02 adds pure deterministic literal comparisons and technical outcome aggregation. AY-I03 adds a strictly bounded, injected observation port with claimed provenance and redacted restricted requests; review [observations](docs/observations.md) and [evaluation](docs/evaluation.md) for the boundaries. Never treat an adapter-reported pass as authenticated credit. Never infer `pass` from a valid parse, missing references, unverified execution or an advisory claim. See [contracts](docs/contracts.md).
