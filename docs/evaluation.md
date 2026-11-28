# Deterministic technical evaluation

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
verifies the schema-4 evidence digest, origin scope and definition lineage
before comparison; invalid evidence is never a learner mismatch. Neither a valid content
digest nor an evidence reference
authenticates a publisher, runner or learner; consumers that issue formal
credit must enforce those requirements independently.

## Example

```ts
import { createAssessmentDefinition, createEvidenceBundle, evaluate } from "@0xbuff/assay";

const created = createAssessmentDefinition({
  schemaVersion: 4,
  assessmentId: "example",
  revision: "rev1",
  policyVersion: "composed-required-v1",
  composition: {
    rootGroupId: "root",
    groups: [{ id: "root", operator: "all", children: [{ kind: "criterion", id: "stdout" }] }],
  },
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
  schemaVersion: 4,
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

## Return values

For valid definitions and evidence, `evaluate` returns an immutable,
schema-4 `EvaluationResult`: `outcome`, definition lineage, evidenceDigest,
optional artifactDigest, policy version,
one finding per criterion in authored order, evaluator version, and bounded,
value-free warnings. Findings use `pass`, `fail`, `inconclusive` or `error`
and closed, outcome-specific uppercase reason codes. The sole warning is
`ADVISORY_UNRESOLVED`. Evaluator semantics version `v0.0.5` identifies this
closed contract, independently of the npm package version.

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

| Criterion               | Exact behavior                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `exact_text`            | JavaScript UTF-16 code-unit equality (`===`); no hidden whitespace, case, line-ending or Unicode transformation               |
| `normalized_text`       | Applies only explicitly declared transformations, in the fixed order below, to both actual and expected values                |
| `number_with_tolerance` | Absolute difference <= `max(absoluteTolerance, relativeTolerance * abs(expected))`, inclusive; no coercion                    |
| `set_equivalence`       | Scalar equality within a declared string/number/boolean type, with authored order and duplicate policies                      |
| `observed_execution`    | Always inconclusive even if the optional observation port reports `confirmed`; the port does **not** authenticate correctness |
| `manual_evidence`       | Always inconclusive pending authorized review; presence of a document is never correctness                                    |

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

A `qualitative_review` criterion is always advisory and inconclusive: missing uses EVIDENCE_MISSING, truncated uses EVIDENCE_TRUNCATED and complete uses REVIEW_REQUIRED. No model or human claim can establish a binding outcome. Feedback and citations stay in privileged verified evidence, not findings.

## Required versus advisory decisions

The only supported binding policy is `composed-required-v1`. Every required criterion belongs exactly once to an explicit nonempty bounded group tree; advisory findings are outside it. All criteria are validated and compared in authored order, even when an alternative is already decisive. Each group combines its direct children (leaves or child groups).

| Operator | First decisive outcome | Otherwise                    | Otherwise                     | Otherwise       |
| -------- | ---------------------- | ---------------------------- | ----------------------------- | --------------- |
| all      | any fail → fail        | any error → evaluation_error | any unresolved → inconclusive | all pass → pass |
| any      | any pass → pass        | any error → evaluation_error | any unresolved → inconclusive | all fail → fail |

An unresolved or erroneous alternative is never itself a pass. A malformed definition, supplied reference bundle or evidence record anywhere is rejected before comparison, regardless of which group might otherwise decide the result. Preserve each original finding, even if another branch determines the root. There is one shared aggregation implementation for evaluation and projection. A missing observation or missing reference is not a learner mismatch. Advisory warnings never change the root.

## Unresolved expectations and provider boundary

Current objective expectations can be compared using an optional caller-supplied
`ReferenceBundle` as the third argument to `evaluate`. Definition integrity
is checked first, then the entire supplied reference bundle (including records
for advisory or unobserved criteria), then evidence. The bundle must match the
verified definition lineage and every supplied reference must match its declared
ID, kind, digest, unit or set item type. Invalid reference material returns
`invalid_reference` with value-free diagnostics and no findings.
Objective reference declarations require content digests; supplied bundles must bind the exact definition identity.

The [optional observation port](observations.md) collects bounded typed facts and claimed run/adapter provenance. Resolving restricted references, proving
execution origin and recording authorized review decisions still require an
independent host-owned security boundary, not the comparator or the port.

## Protected comparison example

After creating the definition and reference bundle as shown in [integrity](integrity.md#current-generation-reference-integrity), supply evidence whose definition lineage matches the bundle:

```ts
const result = evaluate(definition, evidence, references);
// A matching protected expectation may now pass; an absent record is inconclusive.
const publicView = projectPublicResult(definition, result);
// A restricted criterion withholds the aggregate outcome.
```

The authorized caller resolves and stores references outside Assay. The optional
observation port receives neither the bundle nor expected values. Evidence and result lineage bind the assessment and its observations.

## Verification

Run `pnpm check` for source validation, typechecking, style, tests, build and independent offline installed-package verification. See [development](development.md) for details.

## Additional objective comparisons

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

The structural result parser admits only the current evaluator version.

## Typed execution facts

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

Assertion-only `observed_execution` criteria remain inconclusive even if confirmed. The schema-4 canonical algorithm includes the selector and origin termination in the digest.

Supply selected execution facts through `createEvidenceBundle`, or use [the optional collector](observations.md#selected-execution-facts-and-cancellation) for eligible missing public facts. Evaluation remains synchronous.
The host owns authentication, capture accuracy, execution and isolation.
