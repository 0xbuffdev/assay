# Assay

**Deterministic technical evaluation from explicit criteria and bounded evidence.**

Assay is a standalone TypeScript library for checking technical observations against versioned assessment definitions. It produces reproducible criterion-level findings, distinguishes missing evidence from incorrect results, and can construct a deliberately restricted public-facing view.

Assay evaluates evidence; it does **not** execute learner code, authenticate a submitted observation, resolve protected reference answers, issue grades or award credentials. Those responsibilities stay with the application using it.

**Availability:** The Apache-2.0 source is public. The npm package is **not published**; its source version remains 0.0.0 with the private publication guard enabled. There is no supported npm install command yet.

## How it works

1. **Define the requirements.** Author typed criteria for exact or normalized text, numeric values with explicit tolerances and units, sets, reported execution assertions, or manual evidence. Every assessment needs at least one required criterion.
2. **Bind the definition to its content.** Use [definition integrity](docs/integrity.md) to create or verify a deterministic, versioned SHA-256 digest. A hash identifies content; it does not authenticate its publisher.
3. **Supply observations.** Pass bounded, typed evidence directly or use an [optional injected observation port](docs/observations.md). A provider's claimed provenance is not independent proof of execution.
4. **Evaluate.** Compare observations using the deterministic [evaluation semantics](docs/evaluation.md). Required findings determine the technical outcome; advisory findings cannot manufacture a pass. Invalid, missing and truncated evidence are handled distinctly.
5. **Present only appropriate findings.** The full technical record is for an authorized host. Use the [learner-safe projection](docs/projection.md) to omit restricted findings, evidence references and hidden aggregate outcomes. The host must still decide who is allowed to see any result.

The pure library has **no runtime dependencies**, network requirement, model provider, private workspace or mandatory executor.

## Develop from source

Requires Node.js 24+ and pnpm 11.2.2.

~~~sh
git clone https://github.com/0xbuffdev/assay.git
cd assay
corepack enable
pnpm install --frozen-lockfile
pnpm check
~~~

The full check validates contracts, security cases, TypeScript, Biome, the tsdown ESM/types build and an **independent offline consumer of the actual npm tarball**. It does not publish or deploy anything.

Use these commands for focused work:

~~~sh
pnpm test
pnpm typecheck
pnpm check:style
pnpm build
pnpm verify:package
~~~

The last command checks the packed package after a build, using a temporary isolated ESM/TypeScript consumer. Authored TypeScript files use extensionless relative imports.

## Documentation

The [contract reference](docs/contracts.md) defines accepted input and result types. [Architecture](docs/architecture.md) explains the responsibilities of the evaluator and host. [Release and package verification](docs/releasing.md) describes the current source-quality gate and remaining publication approvals.

For changes to Assay, follow [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [specification](https://github.com/0xbuffdev/context/blob/main/repos/assay/specs/0001-evaluation-core.md). Accepted implementation history and decisions are maintained in the [canonical tickets](https://github.com/0xbuffdev/context/blob/main/repos/assay/tickets.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [copyright and attribution](COPYRIGHT.md). Public source availability does not authorize an npm release.
