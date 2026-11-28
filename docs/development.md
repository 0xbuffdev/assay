# Development

Assay is a TypeScript/ESM package with no runtime dependencies. Its public entry exposes validation, integrity, deterministic evaluation, optional observation collection and public projection. Build tools are development dependencies.

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

To apply formatting run `pnpm format`. `pnpm check` runs the foundation, type, style, test, build and offline package checks. CI executes equivalent read-only checks; no workflow publishes a package.

## Import convention

Relative TypeScript imports are **extensionless**:

```ts
import { validateDefinition } from "./validation/definition";
```

Do not write relative `.js` specifiers in TypeScript source. The build produces valid ESM files in `dist/`, and the package export map uses the generated `dist/index.js` and `dist/index.d.ts`. That emitted filename is not a source import style.

`tsdown.config.ts` builds the ESM entry and declarations. `vitest.config.ts` targets Node tests.

## Internal modules

Use the [source organization](architecture.md#source-organization) to locate the owner of a contract, validator, comparator, integrity operation, observation boundary or public projection. Import focused modules internally, never the package root. Keep the root's public exports intentional and maintain the foundation module/dependency checks when the accepted layout changes.

## Scope of the current checks

Tests cover contract validation, comparator boundaries, deterministic replay, required/advisory precedence, evidence coverage, provenance, truncation, malformed inputs and protected-data disclosure. The distribution verifier checks executable ESM and declarations. The offline package verifier checks the exact archive, Apache-2.0 notice, dependencies, hostile inputs and installed ESM/TypeScript consumer. Both Ubuntu and Windows run these checks. The verifier invokes npm's JavaScript CLI through the active Node executable to avoid platform-specific shell shims.

Assay is Apache-2.0 licensed. The public 0.0.1 package candidate remains unpublished. See the [release policy](releasing.md) for approval requirements.

## Version metadata and runtime compatibility

The package version lives in `package.json`; evaluator semantics and canonical domains are defined in `scripts/version-metadata.mjs`. The generated
`src/contracts/version.ts` is checked in for source consumers. Run
`pnpm generate:version` only after an approved identity change; foundation and
build verification reject stale generated metadata without rewriting it.
The package manifest remains the public package-version authority, while the
existing evaluator export and technical result identify evaluator semantics.
See [version compatibility](integrity.md#version-contract).

## Conformance and adversarial verification

The conformance suite targets evaluator semantics `v0.0.5` and the sole generation-4 canonical profiles.
It uses only synthetic records and the public source entry point. Node's
`crypto` and an independent property-list JSON serializer check generated
canonical hashes; fixed authored byte/hash vectors in the existing integrity
suites remain the compatibility anchors. Generated corpora are deterministic:
no random seed, clock, network, provider service or new dependency is needed.

The mandatory suites cover:

- Malformed transport, duplicate keys, hostile objects, resource bounds and redacted failures: `adversarial.test.ts`, `serialized.test.ts`, `resources.test.ts`.
- Independent comparator outcomes, replay, closed results, composition, missing and truncated evidence: `conformance.test.ts` and evaluator suites.
- Module boundaries, exports, archive contents and installed ESM/TypeScript: foundation and packed-consumer checks.
- Advisory-only qualitative observations and non-authoritative manual review.
- Stream truncation, unsolicited reports, scoped origins, cancellation and late settlement: `adversarial.test.ts` and `observation.test.ts`.
- Protected outcome permutations, opaque rejection and invariant public bytes: `adversarial.test.ts` and `projection.test.ts`.
- Independent hashes, fixed canonical vectors, version identity and unsupported versions: integrity suites, `conformance.test.ts` and generated metadata checks.

Run the focused suites or the full check:

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
publication.

## Expanded conformance and resource verification

The independent source tests `tests/expanded-conformance.test.ts` and
`tests/expanded-resources.test.ts` supplement the comparator, composition and review suites. They exercise schema 4 and evaluator v0.0.5.

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
host isolation or release readiness. Installed-package scenarios run separately.

## Standalone engineering assessment integration

The packed-consumer check copies and executes
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
the check does not select a release version or publish to the registry.

## Expanded standalone assessment integration

The offline packed-consumer check also runs expanded assessment scenarios in `tests/consumer/standalone-assessments.mjs` and compiles
`tests/consumer/consumer.ts.txt` against the same installed declarations. A
synthetic design-check assessment requires a common output and either of two
explicit demonstrations, including a protected content-bound alternative.
Provider-free evaluation retains every leaf outcome and cannot bypass the
common output. Public projection withholds the aggregate and omits protected
branch and review material even when the hidden outcome changes.

A separate all-public design defense requires manual evidence; favorable
attributed review remains advisory, and absent, truncated and complete review
records cannot satisfy the manual leaf. The scenarios exercise human/model
claims, independently resealed malformed review and alternate-branch records,
reference tampering, serialized replay, forged projections and port omission.
The installed declaration fixture checks typed composition, protected reference,
review and manual observations, public result shape and negative type cases.
The verifier requires success markers for both sets of runtime scenarios and scans compiled payloads for synthetic private canaries. It also enforces the exact archive and license checks. Run `pnpm check` on the exact candidate on Ubuntu and Windows; record
actual source SHA and CI output, including the isolated TypeScript marker.
The examples do not prove real reviewer authority, actual citation validity,
execution isolation or academic credit. Release approval is a separate decision.
