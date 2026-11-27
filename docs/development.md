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
pnpm verify:package
# See docs/integrity.md for authored definition digest vectors and guarded APIs
```

To apply formatting run `pnpm format`. `pnpm check` runs all foundation, type, style, test and build checks. CI executes equivalent read-only checks; no workflow publishes a package.

## Import convention

Relative TypeScript imports are **extensionless**:

```ts
import { validateDefinition } from "./validation/definition";
```

Do not write relative `.js` specifiers in TypeScript source. The build produces valid ESM files in `dist/`, and the package export map uses the generated `dist/index.js` and `dist/index.d.ts`. That emitted filename is not a source import style.

`tsdown.config.ts` uses the same general tsdown entry/build setup as Throughline, but no React, MDX, compiler extension adapter, browser UI or CLI is needed. `vitest.config.ts` targets Node tests only.

## Internal modules

Use the [source organization](architecture.md#source-organization) to locate the owner of a contract, validator, comparator, integrity operation, observation boundary or public projection. Import focused modules internally, never the package root. Keep the root's public exports intentional and maintain the foundation module/dependency checks when the accepted layout changes.

## Scope of the current checks

The tests verify versioned definitions, observations, findings, safety bounds and evidence coverage. The dist verifier checks that tsdown emitted executable ESM and declarations; it also smoke-tests deterministic comparison using the built ESM package. AY-I01 tests cover strict schema validation, bounded inputs, deterministic diagnostics and evidence coverage; AY-I02 tests cover comparator boundaries, replay, required/advisory precedence and unverified evidence. AY-I03 tests cover mock ports, provenance consistency, truncation, forged trust flags, restricted inputs, unsafe text and thrown provider errors. AY-I04 adds a standalone offline tarball installation, exact archive allowlist and Apache-2.0 notice audit, hostile-input ESM consumer, and isolated TypeScript declaration consumer. The pack check runs in `pnpm check` and as its own CI step after `pnpm build` on Ubuntu and Windows. It starts npm's JavaScript CLI through the active Node executable (never a Windows `.cmd` shim or shell invocation).

Assay source is Apache-2.0 licensed; the npm package remains unpublished and deliberately unpublishable until separately approved. The package remains `private: true`. A green packed-consumer check is not release authorization.

## Version metadata and runtime compatibility

AY-I22 separates package release (`package.json`) from evaluator semantics and
canonical domains (authored in `scripts/version-metadata.mjs`). The generated
`src/contracts/version.ts` is checked in for source consumers. Run
`pnpm generate:version` only after an approved identity change; foundation and
build verification reject stale generated metadata without rewriting it.
The package manifest remains the public package-version authority, while the
existing evaluator export and technical result identify evaluator semantics.
See [version compatibility](integrity.md#version-compatibility-ay-i22).

## Conformance and adversarial verification (AY-I24)

The conformance suite targets evaluator semantics `v0.0.3`, schema-1 and
schema-2 definition profiles, and schema-2 reference/evidence profiles.
It uses only synthetic records and the public source entry point. Node's
`crypto` and an independent property-list JSON serializer check generated
canonical hashes; fixed authored byte/hash vectors in the existing integrity
suites remain the compatibility anchors. Generated corpora are deterministic:
no random seed, clock, network, provider service or new dependency is needed.

| Requirement    | Verification in the mandatory Vitest/foundation/package gates                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ASY-27, ASY-38 | `adversarial.test.ts`, `serialized.test.ts`, `resources.test.ts`: malformed transport mutations, decoded duplicate keys, hostile objects, bounded resource limits, redacted failures       |
| ASY-28–31      | `conformance.test.ts`, existing evaluator and execution-fact suites: independent comparator outcomes, replay, closed results, required/advisory precedence, missing and truncated evidence |
| ASY-32         | Foundation module/export checks and isolated packed consumer; no source layout or API changes                                                                                              |
| ASY-33         | Conditional qualitative observations remain deferred; existing manual/unverified review paths remain non-authoritative                                                                     |
| ASY-34–36      | `adversarial.test.ts`, `observation.test.ts`: stream-specific truncation permutations, empty/unsolicited reports, scoped origins, cancellation and late settlement                         |
| ASY-37         | `adversarial.test.ts`, `projection.test.ts`: repeated protected probes, criterion order and advisory/required permutations, opaque rejection, fixed public bytes across hidden outcomes    |
| ASY-39         | `conformance.test.ts`, existing fixed integrity vectors and generated metadata gate: independent hashes, version identity, unsupported versions                                            |
| ASY-40         | All preceding checks plus exact installed ESM/TypeScript and archive verification; realistic additional standalone assessment integration is AY-I25                                        |

Run the new suites independently, or use the full quality gate:

```sh
git rev-parse HEAD
node --version
pnpm --version
pnpm exec vitest run tests/conformance.test.ts tests/adversarial.test.ts tests/resources.test.ts
pnpm check
```

The resource suite samples each fixed workload five times after one warm-up.
Workloads cover the exact serialized byte/node cap with multibyte text,
escape-heavy maximum-length strings, maximum depth, and 64 large criteria
with corresponding evidence, including sealing, evaluation and projection.
The protected-reference object-input workload separately measures evaluation
with 64 distinct content-bound JSON references at exactly 262,144 counted
string/key bytes, matching structured observations, and a verified definition.
Independent accounting reports actual snapshot sizes and serialized size; the
same shape with one additional payload byte, independently sealed and bound,
must return invalid_reference. This is the object snapshot boundary, not a
claim that the same JSON fits the serialized transport cap.
Adjacent invalid inputs must reject; machine-dependent time and memory are
observations, not pass/fail thresholds. Logs report the Node version, platform,
architecture, OS release, CI checkout SHA (for pull requests this may be the
test-merge commit), elapsed times, heap/RSS deltas and cumulative process
maximum RSS. Local runs must record the checked-out SHA separately. Heap/RSS
deltas can be negative due to garbage collection; cumulative maximum RSS is
not an isolated per-workload peak. These are reproducible boundary workloads,
not a proof of worst-case complexity, a memory ceiling or host isolation.

Preserve the actual CI run and reviewed-head/tree identity when reporting
acceptance, including any failed or unexecuted commands. Source review does
not establish execution evidence, and the resource samples do not authorize
publication. AY-I08 and AY-I23 remain conditional and excluded.
