# AGENTS.md

Repository-wide instructions for working on Assay.

## Contract and scope

Assay compares bounded technical evidence against explicit, versioned criteria. It returns technical findings, not authenticated execution, learner identity, grades or credentials.

- Before changing behavior, read the [Assay architecture and specification index](https://github.com/0xbuffdev/context/tree/main/repos/assay), the [implementation tickets](https://github.com/0xbuffdev/context/blob/main/repos/assay/tickets.md), and the accepted ADRs/specifications governing the requested change. Check ticket dependencies and acceptance criteria.
- Accepted contracts govern intended behavior; source, tests and package exports establish implemented behavior. Proposed contracts, merged documentation and historical passing checks do not by themselves authorize source work or establish release readiness. Report conflicts rather than silently choosing semantics.
- Write public guides around current behavior and reader tasks. Keep implementation ticket IDs, requirement crosswalks and historical acceptance records in the canonical tracker and review records; link to specifications by subject. Preserve actual version identities, API names and diagnostic codes.
- Read [architecture](docs/architecture.md), [development](docs/development.md), [contributing](CONTRIBUTING.md) and [release policy](docs/releasing.md) as relevant. Use the focused documents under `docs/` for contract, integrity, evaluation, observation and projection details; do not duplicate their rules here.
- Keep Assay independently usable, provider-neutral and offline. No runtime dependencies, OEE/0xNAND imports, private packages, UI, embedded runner, model client, network or host-account requirements. Dependency, public contract and architectural changes require explicit review.

## Working on a ticket

- Start from current `main` on a focused branch unless continuing an existing PR. Inspect the working tree and preserve unrelated changes. Keep one accepted ticket per implementation PR; do not implement blocked or conditional follow-ups opportunistically.
- Map the requested work to its requirements and acceptance tests. For nontrivial work, identify the affected contracts, boundary owners and tests before editing.
- Keep contracts, validation, integrity, comparison, aggregation, observation acquisition and public projection responsibilities separate; follow the accepted layout and dependency direction. Do not introduce speculative abstractions, duplicate validation/aggregation paths, compatibility aliases or parallel implementations. Remove superseded code only within the approved migration.
- Maintain the smallest intentional public API through `src/index.ts`; update source, types, tests, examples and package checks together when an approved change affects the contract. Never treat a planned export as implemented. Do not preserve unreleased APIs merely for backward compatibility; obey accepted version and migration rules.

## Evaluation and security invariants

- Validate untrusted inputs at the applicable boundary; enforce closed discriminants, supported versions, declared policies, shape and resource limits. Treat inputs as inert data, not executable JavaScript. Do not use `eval`, dynamic predicates or implicit coercion. Object validation is not a sandbox for hostile executable objects.
- Keep evaluation deterministic for identical validated inputs and versioned semantics: no clock, randomness, network, locale-dependent comparison or mutable global state. Preserve authored ordering, explicit normalization, finite numeric arithmetic, exact unit agreement and declared collection semantics. Do not change canonical digest bytes or version semantics accidentally.
- Required criteria cannot be empty. Missing, truncated, unavailable or unverified evidence cannot silently pass. Keep `pass`, `fail`, `inconclusive`, `invalid_definition`, `invalid_evidence` and `evaluation_error` distinct under the accepted aggregation policy. Malformed input or internal failure is not learner deficiency; advisory findings cannot override required outcomes.
- Keep definition, reference, evidence and result lineage coherent under the accepted integrity contract. A content digest proves content identity, not authenticity or authority. Never invent missing provenance or interpret an adapter-reported verdict as authenticated credit.
- Observation acquisition is an optional injected boundary, not part of pure evaluation. Validate returned facts and claimed receipts; obey eligibility and limits. Do not expose protected expected values or references to an unprivileged port.
- Full technical results are privileged records. Use the explicit public projection for learner-facing disclosure; validate lineage and prevent restricted identifiers, evidence, expected values and hidden aggregate outcomes from leaking through diagnostics, errors, logs or serialized results. Host authorization and execution isolation remain host responsibilities.
- Use synthetic fixtures and private-data canaries, never real learner records, credentials, protected cases or internal product material. Follow [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Toolchain and conventions

Use Node.js 24+, pnpm 11.2.2, strict TypeScript, ESM, tsdown, Vitest and Biome as configured in the repository. Use extensionless relative TypeScript imports with bundler resolution; emitted package paths use `.js`. Prefer explicit types at public boundaries, exhaustive discriminated-union handling and type-only imports where required. Follow Biome rather than inventing formatting rules. Do not hand-edit generated `dist/` files.

From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec vitest run tests/<file>.test.ts
pnpm check
```

Replace `<file>` with an existing test basename. Use `pnpm format` for formatting and `pnpm check:style` for non-mutating style checks. `pnpm check` runs foundation checks, typechecking, style, tests, build/distribution verification and the independent offline packed-consumer gate. For package-only verification, run `pnpm build` followed by `pnpm verify:package`.

## Tests and review

- Add reproducible positive, negative and boundary cases for changed behavior, including relevant missing/invalid evidence, version/lineage mismatch, numeric overflow, policy precedence, deterministic replay and restricted-data leakage. Derive expected outcomes independently from the implementation.
- Keep package-boundary tests in `tests/consumer/` aligned with approved export changes; preserve the offline isolated ESM/TypeScript consumer, exact archive allowlist, license/notice checks and Windows/Ubuntu compatibility. Do not weaken assertions, skip tests or relax verification to make a change pass. Update layout/export guards only to reflect an accepted contract change.
- Run focused tests while developing and `pnpm check` before requesting review. Record the tested commit, commands, results, and any checks not run or failed. CI evidence must match the reviewed head; unavailable CI or a passing local test is not proof of unexecuted checks.

## Review rules

Flag fail-open evaluation, invalid outcome/lineage handling, nondeterministic comparison, unauthorized contract changes, resource-bound bypasses, restricted-data disclosure, dependency leaks and weakened acceptance gates. Prioritize reproducible correctness and security findings over formatting handled by Biome. Include file/line, triggering input or condition, impact and a testable correction.

## Pull requests and release

- Include the ticket (when applicable), requirement coverage, changes, tests and exact outstanding limitations in the PR. Do not mark work complete before required review, merge and acceptance evidence.
- Preserve Apache-2.0 licensing and copyright notices. The approved public `0.0.1` preparation is limited to metadata, documentation and verification. Follow the [release policy](docs/releasing.md); publishable metadata does not authorize publication. No publication, version tag, deployment, signing on behalf of the maintainer, merge, or repository ownership/visibility change without explicit authorization.
