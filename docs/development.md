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
See [version compatibility](integrity.md#version-contract).

## Conformance and adversarial verification (AY-I24)

The conformance suite targets evaluator semantics `v0.0.5` and the sole generation-4 canonical profiles.
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
| ASY-33         | Attributed qualitative observations are advisory-only; manual/unverified review paths remain non-authoritative                                                                             |
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
publication. AY-I08 replaces generation 3 and adds qualitative contract and disclosure regressions. AY-I27 and AY-I28 remain independent expanded-candidate gates.

## Expanded conformance and resource verification (AY-I27)

The independent source tests `tests/expanded-conformance.test.ts` and
`tests/expanded-resources.test.ts` supplement rather than replace AY-I24 and the
ticket-local composition and review tests. They exercise current generation 4,
evaluator v0.0.5, with no compatibility paths or new runtime exports.

- Enumerate 2,048 four-leaf cases (all 256 outcome assignments for each of
  eight operator combinations); use a set-membership precedence oracle rather
  than the implementation fold. Independently serialize and hash all three
  domains with Node crypto, verify authored leaf order, structural coverage,
  warning, projection and cloned-input replay.
- Probe hidden objective/review outcomes and serialized public-byte invariance;
  reject independently sealed malformed alternatives and review claims,
  graph mutations, duplicate serialized keys and forged projection results.
- Measure a single graph with all five structural caps simultaneously
  (64 groups, 64 required leaves, 64 root children, 127 edges, eight levels)
  and reject adjacent graph-limit violations.
- Measure 63 advisory reviews with 504 citations plus one required objective;
  use independent snapshot accounting to hit 262144 counted bytes exactly
  while one feedback record reaches 4096 bytes. Reject one additional byte.
  Measure three valid records padded to 262144 serialized bytes each
  (786432 combined); reject an extra byte on each individual decoder call.
  The combined request transport cap remains host-enforced.

Run the focused suites and the full unchanged gate:

```sh
git rev-parse HEAD
node --version
pnpm --version
pnpm exec vitest run tests/expanded-conformance.test.ts tests/expanded-resources.test.ts
pnpm check
```

CI reports one warm-up and five measured samples per resource workload with
checkout SHA, Node, OS, architecture, elapsed time, heap/RSS deltas and cumulative
process max RSS. Measurements are observations, not portable performance or
memory guarantees; no timing or memory threshold is used for acceptance.
Garbage collection, process history and machine load affect samples. Retain
the actual run and exact reviewed tree identity on both platforms. These tests
use synthetic inputs and do not establish provenance, actual citation validity,
host isolation, release readiness or the separate AY-I28 installed scenarios.

## Standalone engineering assessment integration (AY-I25)

The mandatory packed-consumer gate copies and executes
`tests/consumer/standalone-assessments.mjs` outside this repository against the
same offline-installed tarball as the existing ESM and TypeScript fixtures.
The fixture imports only the package root and Node built-ins. Its records are
synthetic; it does not run submitted code, access a service, resolve real
protected material or establish genuine provenance.

The sensor-calibration scenario compares a measured voltage against an
inclusive tolerance and a Boolean device-status expectation without a
provider. It covers matching and out-of-range measurements, missing facts and
wrong units. Its public projection includes the overall technical outcome
because every criterion is public.

The inventory-summary scenario compares a CLI's public stdout and exit status
with authored expectations and a separate protected structured result with a
content-bound JSON reference. An injected mock adapter supplies only missing
public execution facts; a separate synthetic host-owned origin supplies the
restricted observation. The scenarios exercise matching and mismatching
protected values, missing reference material, altered reference content and
lineage, altered evidence and foreign definition lineage, empty and truncated
reports, provider errors, public mismatch precedence, deterministic serialized
replay and identical public bytes across hidden outcomes. A zero exit status
does not establish correctness. The verifier checks that known synthetic
private canaries are absent from the compiled payloads.

### Host integration prerequisites

1. Authorize the exact versioned definition, reference records and binding
   policy independently of the submission. Keep reference values, reference
   digests and restricted criteria in a privileged comparison environment;
   content identity is not a signature or proof of publisher authority.
2. Authenticate the submission and artifact association in the host.
   Apply per-record and combined transport limits before decoding untrusted
   bytes. Reject invalid UTF-8, then use `decodeSerializedRecord` before
   integrity validation. Never accept a self-sealed record as an authenticated
   observation. Bound request concurrency and retained evidence independently.
3. Acquire observations only through a host-authorized, isolated execution
   environment or independently verified measurement source. The public port
   receives only eligible public fact descriptors and scope metadata, not
   expected values. Protected execution and reference access must remain
   outside that port's privileges. Its definition and artifact digests are
   scope metadata, not secrets or proof of execution; restrict access to
   recipients authorized to know them.
4. Enforce real execution, memory, time, capture and network limits in the
   host, and verify adapter/run/artifact provenance independently. Supply
   typed facts and honest completeness/termination claims. An empty report
   leaves missing evidence; an error or cancellation is an acquisition
   failure, not learner deficiency. Do not fabricate facts, attach a
   successful receipt after an error, or interpret cancellation as proof
   that a runner stopped. See [observation acquisition](observations.md).
5. Verify the exact sealed definition, reference bundle and evidence before
   evaluation. Distinguish invalid inputs from complete technical results;
   preserve exact inputs, policy/evaluator identity, evidence lineage and
   claimed receipts privately for authorized audit/replay. Corrections
   produce new sealed evidence, not mutable history.
6. Authorize disclosure separately. Send only the validated public projection
   (or a host-defined opaque failure response), never technical findings,
   protected data, digests or raw diagnostic messages. Restrict logs,
   repeated submissions, timing and metadata disclosure; the projection
   alone is not a side-channel defense or access-control system. See
   [public projection](projection.md).
7. Independently test admission, origin verification, execution isolation,
   authorization and formal decision policy in the actual host. A technical
   pass is not a grade, credential, identity proof or trusted execution.
   This package has no runner, model, grading authority or service dependency.

Run the complete gate on the exact candidate with Node.js 24+ and pnpm 11.2.2:

```sh
git rev-parse HEAD
node --version
pnpm --version
pnpm check
# To rerun only the packed-consumer gate:
pnpm build
pnpm verify:package
```

The verifier retains the original exact archive allowlist, offline
no-script install, dependency/license checks and isolated declaration
typecheck. Its standalone-assessment success marker must appear on both
Ubuntu and Windows. The temporary installation is removed after verification;
no registry publication or release version selection is part of AY-I25.
