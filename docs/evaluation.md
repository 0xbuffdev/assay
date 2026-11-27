# Deterministic technical evaluation (AY-I02)

The full technical `EvaluationResult` may include restricted criterion IDs, evidence
references and aggregate conclusions influenced by protected checks. It is an
authorized **host-side record**, not a learner API response. For a bounded
learner-facing view, use [public result projection](projection.md) and enforce
access authorization in the host; do not directly serialize the full result.

Assay evaluates caller-authorized literal or content-bound reference criteria against bounded typed
observations. The source API is `evaluate(definition, evidence, references?)` and the
implementation is pure: no clock, random source, network request, dynamic
predicates, AI service, code runner or institutional grade writer.

The accepted [versioned data contracts](contracts.md) are validated on every
call. The definition content digest is recomputed before any evidence inspection
or comparison; mismatch returns `invalid_definition`. The evaluator also
verifies the schema-2 evidence digest, origin scope and definition lineage
before comparison; invalid evidence is never a learner mismatch. Neither a valid content
digest nor an evidence reference
authenticates a publisher, runner or learner; consumers that issue formal
credit must enforce those requirements independently.

## Example

```ts
import { createAssessmentDefinition, createEvidenceBundle, evaluate } from "@0xbuff/assay";

const created = createAssessmentDefinition({
  schemaVersion: 1,
  assessmentId: "example",
  revision: "rev1",
  policyVersion: "all-required-v1",
  criteria: [
    {
      id: "stdout",
      mode: "required",
      visibility: "public",
      kind: "exact_text",
      parameters: { expected: { type: "literal", value: "ok\\n" } },
    },
  ],
});
if (!created.ok) throw new Error("Invalid authored definition");
const definition = created.value;
const prepared = createEvidenceBundle(definition, {
  schemaVersion: 2,
  observations: [
    {
      criterionId: "stdout",
      evidenceRef: "stdout1",
      completeness: "complete",
      kind: "text",
      value: "ok\\n",
    },
  ],
});
if (!prepared.ok) throw new Error("Invalid evidence");
const evidence = prepared.value;

const assessment = evaluate(definition, evidence);
// assessment.outcome === "pass", a *technical finding* for this local literal rubric.
// This is not official credit and does not authenticate evidence.
```

The package remains unpublished and cannot be installed from npm yet. The
example describes its exported source package entry after a separately
approved release.

## Return values

For valid definitions and evidence, `evaluate` returns an immutable,
schema-2 `EvaluationResult`: `outcome`, definition lineage, evidenceDigest,
optional artifactDigest, policy version,
one finding per criterion in authored order, evaluator version, and bounded,
value-free warnings. Findings use `pass`, `fail`, `inconclusive` or `error`
and closed, outcome-specific uppercase reason codes. The sole warning is
`ADVISORY_UNRESOLVED`. Evaluator semantics version `v0.0.2` identifies this
closed contract; the package remains unreleased at version 0.0.0.

An invalid definition, reference bundle or evidence bundle returns a distinct
`EvaluationFailure` envelope with `outcome: "invalid_definition"` or
`"invalid_evidence"` or `"invalid_reference"` and deterministic structured diagnostics. There is
**no invented definition identity, findings or grade** on an invalid-input
envelope. A failure and a complete result form the discriminated
`EvaluationResponse` union. Internal comparator failures on structurally valid
inputs use `EvaluationResult.outcome: "evaluation_error"` and a value-free
`COMPARATOR_ERROR` reason (or `NUMERIC_OVERFLOW` for an overflowed relative
bound).

## Comparison semantics

| Criterion               | Exact behavior                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `exact_text`            | JavaScript UTF-16 code-unit equality (`===`); no hidden whitespace, case, line-ending or Unicode transformation                      |
| `normalized_text`       | Applies only explicitly declared transformations, in the fixed order below, to both actual and expected values                       |
| `number_with_tolerance` | Absolute difference <= `max(absoluteTolerance, relativeTolerance * abs(expected))`, inclusive; no coercion                           |
| `set_equivalence`       | Scalar equality within a declared string/number/boolean type, with authored order and duplicate policies                             |
| `observed_execution`    | Always inconclusive even if the AY-I03 optional observation port reports `confirmed`; the port does **not** authenticate correctness |
| `manual_evidence`       | Always inconclusive pending authorized review; presence of a document is never correctness                                           |

**Normalized text transformation order:**

1. `lineEndings: "lf"` converts CRLF and bare CR to LF; `"preserve"` does nothing.
2. `case: "fold"` applies locale-independent ECMAScript `toLowerCase()`;
   this is _not_ the complete Unicode CaseFolding mapping (e.g. `ß` does
   not equal `ss`). `"sensitive"` leaves case untouched.
3. `unicode: "NFC" | "NFKC"` applies that specific Unicode normalization
   form; `"none"` does nothing.
4. `whitespace: "collapse"` replaces each contiguous ECMAScript Unicode
   `\\s` run with one ASCII space; `"preserve"` leaves it as-is.
5. `trim: "both"` removes leading/trailing ECMAScript whitespace;
   `"none"` does nothing.

No implicit normalization is performed. A changed policy is a changed
assessment revision, which the caller must version and authenticate.

**Numeric semantics:** Every number, expected value, and tolerance must
already be finite. Tolerances must be nonnegative, with both absolute and
relative components explicitly declared. Comparisons use IEEE-754 JavaScript
`number`. If a numeric criterion declares `parameters.unit`, its numeric
observation **must** declare an identical `unit` identifier. If the criterion
omits `unit`, the observation must omit it too. Missing or mismatched units
produce `invalid_evidence` with a value-free `MISMATCHED_OBSERVATION`
diagnostic at the observation's `.unit` path. No automatic unit conversion,
unit inference or precision normalization occurs; producers remain responsible
for declaring and converting measurements before assessment.
A nonfinite intermediate relative bound yields `evaluation_error`, never a
spurious `pass`. A difference overflowing to infinity against a finite
bound is a definite mismatch. The relative bound is based on the magnitude
of the **expected**, not the observed, value.

**Set semantics:** `order: "preserve"` uses sequence equality.
`duplicates: "ignore"` removes repeated items while preserving their
first occurrence for ordered comparisons. Unordered/ignore compares set
membership; unordered/respect compares multiset counts. Scalar types are
never coerced; `0` and `-0` compare equal, consistent with JavaScript
Map/Set. The input validator rejects NaN and infinity.

## Required versus advisory decisions

The only supported binding policy is `all-required-v1`: all required criteria
must pass. Unknown policy identities are rejected before comparison, including
in advisory-only evidence paths. No arbitrary thresholds or weights are accepted.

- Any _decisive required failure_ yields overall `fail`, even alongside
  unresolved requirements; all finding-level reasons remain visible.
- Otherwise, a required comparator error yields `evaluation_error`, not
  an incorrect-learner verdict.
- Otherwise, any missing, truncated, unverified or review-pending required
  criterion yields `inconclusive`.
- Otherwise, all required criteria passed, so the technical outcome is
  `pass`. An advisory failure does not change this outcome, and unresolved
  advisory work only adds the `ADVISORY_UNRESOLVED` warning.

Malformed/unsupported contracts return invalid input envelopes _before_
comparison. Missing required evidence is not malformed input: it produces
an `inconclusive` finding. Text mismatch for a complete literal criterion
is a legitimate `fail`; a successful process exit or a forged `trusted`
field is not proof. The engine never emits expected answer values, exception
messages, HTML or raw observations in its findings.

## Unresolved expectations and provider boundary

Schema-2 objective expectations can be compared using an optional caller-supplied
`ReferenceBundle` as the third argument to `evaluate`. Definition integrity
is checked first, then the entire supplied reference bundle (including records
for advisory or unobserved criteria), then evidence. The bundle must match the
verified definition lineage and every supplied reference must match its declared
ID, kind, digest, unit or set item type. Invalid reference material returns
`invalid_reference` with value-free diagnostics and no findings. Schema-1
ID-only references remain unavailable; supplying a bundle to a schema-1
definition returns `invalid_definition` (unsupported definition version for
reference binding). Omitted or partial bundles are allowed; a complete
observation without its requested record yields `REFERENCE_UNAVAILABLE`.
Missing/truncated observations retain their existing reasons. The same objective
comparison rules apply to literal and verified referenced values, including
normalization, tolerance, order and duplicates. The engine never fetches
reference material or accepts expected values from observations. Do not expose
full results or reference digests to learners; use the public projection. Execution assertion states are
**observations only**; `confirmed` is not proof of a trusted sandbox.
`manual_evidence` remains `REVIEW_REQUIRED` or `ARTIFACT_MISSING`.

AY-I03 adds an [optional port for bounded typed observation collection](observations.md)
and claimed run/adapter provenance. Resolving restricted references, proving
execution origin and recording authorized review decisions still require an
independent host-owned security boundary, not the comparator or the port.

## Protected comparison example

After creating the definition and reference bundle as shown in [integrity](integrity.md#canonical-digest-algorithm-v2-ay-i13), supply evidence whose definition lineage matches the bundle:

```ts
const result = evaluate(definition, evidence, references);
// A matching protected expectation may now pass; an absent record is inconclusive.
const publicView = projectPublicResult(definition, result);
// A restricted criterion withholds the aggregate outcome.
```

The authorized caller resolves and stores references outside Assay. The optional
observation port receives neither the bundle nor expected values. This ticket
changes only objective reference comparison. AY-I15 adds content-bound
evidence and result lineage; the broader result-union migration remains AY-I16.

## Verification

Run `pnpm check`: frozen toolchain, contracts, TypeScript typechecking,
read-only Biome checks, Vitest golden/negative fixtures, and tsdown ESM/type
bundling with compiled-package self-import verification. AY-I04 will add a
separate packed-tarball consumer test. No release, npm publication or
credential authority is implied by source success.

## AY-I17 objective comparisons (schema 2)

- `boolean_equality` compares a `boolean` observation with a strict boolean expectation.
- `number_range` compares a `number` observation against an expected interval
  with finite `min`, `max`, `minInclusive` and `maxInclusive` fields. Both
  inclusivity flags are mandatory. Reversed and empty intervals are invalid.
  Equal endpoints require both flags to be true. Units agree exactly, including
  deliberate absence. Comparison uses direct inequalities, not subtraction.
- `json_equality` compares a `json` observation with a structured JSON value.
  Object key order is immaterial, array order is significant, strings and keys
  are exact, and negative zero equals zero. No coercion or normalization applies.

Each criterion declares `parameters.expected` using the same literal or
content-bound reference contract. Reference record kinds are respectively
`boolean`, `range` (with matching optional unit), and `json`. A JSON null or
boolean false is a real expected value, not an unavailable reference.
Missing or truncated observations are inconclusive. Malformed inputs fail at
validation, before any comparison. Restricted literals remain forbidden.

The new kinds require schema-2 definitions; existing schema-1 definitions
and canonical hash profiles are unchanged. AY-I17 introduced evaluator version `v0.0.2` for the expanded comparator set.
The structural result parser admits only the current evaluator version.

## AY-I18 typed execution facts (schema 2)

An objective criterion may declare an optional top-level `executionFact`.
The supplied observation must declare the same selector and typed value.
A selected observation requires an origin with a source reference, run
reference and explicit `termination`: `exited`, `timeout` or `crash`.
The existing objective comparator checks the value, not a runner's verdict.

| Selector                                 | Objective criterion kinds               | Observation kind |
| ---------------------------------------- | --------------------------------------- | ---------------- |
| `stdout`, `stderr`                       | `exact_text`, `normalized_text`         | `text`           |
| `exit_status`                            | `number_with_tolerance`, `number_range` | `number`         |
| `boolean_property`                       | `boolean_equality`                      | `boolean`        |
| `structured_stdout`, `structured_stderr` | `json_equality`                         | `json`           |

An exit status is a signed safe integer with no unit. A boolean property's
identity is its authored criterion ID; a host derives the property value.
Structured values are caller-supplied bounded JSON associated with the
specified stream, not a new embedded parser. Missing or unavailable facts
are omitted; do not substitute empty output, zero, false or null. Those
values are legitimate only when actually observed. Captured partial facts
are marked truncated. A timeout or crash is inconclusive
(`EXECUTION_INCOMPLETE`), not a mismatch even when a partial value exists.
A truncated observation uses `EVIDENCE_TRUNCATED` first.

The complete bundle checks run termination consistency and relevant
truncation. A complete fact contradicting known truncation is invalid
evidence, including when it omits provenance. Truncation of stderr does not
invalidate selected stdout and vice versa; exit status is independent of
stream truncation. For boolean properties and unselected facts whose
stream attribution is unknown, either stream's truncation is conservative.
For a single source/run pair, complete observations of the same selected
stdout, stderr, exit status or structured stream must agree on their raw
value. JSON equality ignores object key order and distinguishes array order;
text is compared exactly before criterion normalization and numbers exactly
before tolerance. Boolean property identity is the criterion ID, so separate
properties may differ. Repeated equal facts and distinct runs are permitted.
Conflicting complete values are invalid evidence, never learner mismatch.

Conflicting termination claims are invalid; a complete observation cannot
omit termination for a run known to have timed out or crashed. An exited run or zero exit
status alone is not proof of other required output or properties.

Schema-1 definitions cannot declare a selector. Existing generic criteria
and observations, and assertion-only `observed_execution`, retain their
meaning. Assertions remain inconclusive even if confirmed. The schema-2
canonical algorithm hashes every supplied field, including the new
selector and origin termination, without changing historical bytes.
Evaluator semantics are now `v0.0.3`.

Selected execution facts are supplied directly through
`createEvidenceBundle` and evaluated synchronously; the existing collector
does not request them until AY-I19 specifies their report/request contract.
The host owns authentication, capture accuracy, execution and isolation.
