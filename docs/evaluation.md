# Deterministic technical evaluation (AY-I02)

Assay evaluates caller-authorized _literal_ criteria against bounded typed
observations. The source API is `evaluate(definition, evidence)` and the
implementation is pure: no clock, random source, network request, dynamic
predicates, AI service, code runner or institutional grade writer.

The accepted [versioned data contracts](contracts.md) are validated on every
call. Neither a syntactically valid SHA-256 digest nor an evidence reference
authenticates a publisher, runner or learner; consumers that issue formal
credit must enforce those requirements independently.

## Example

```ts
import { evaluate } from "@0xbuff/assay";

const digest = `sha256:${"a".repeat(64)}`;
const definition = {
  schemaVersion: 1,
  assessmentId: "example",
  revision: "rev1",
  revisionDigest: digest,
  policyVersion: "policy1",
  criteria: [
    {
      id: "stdout",
      mode: "required",
      visibility: "public",
      kind: "exact_text",
      parameters: { expected: { type: "literal", value: "ok\\n" } },
    },
  ],
};
const evidence = {
  schemaVersion: 1,
  definition: { assessmentId: "example", revision: "rev1", revisionDigest: digest },
  observations: [
    {
      criterionId: "stdout",
      evidenceRef: "stdout1",
      completeness: "complete",
      kind: "text",
      value: "ok\\n",
    },
  ],
};

const assessment = evaluate(definition, evidence);
// assessment.outcome === "pass", a *technical finding* for this local literal rubric.
// This is not official credit and does not authenticate evidence.
```

The package remains unpublished and cannot be installed from npm yet. The
example describes its exported source package entry after a separately
approved release.

## Return values

For valid definitions and evidence, `evaluate` returns an immutable,
versioned `EvaluationResult`: `outcome`, definition lineage, policy version,
one finding per criterion in authored order, evaluator version, and bounded,
value-free warnings. Findings use `pass`, `fail`, `inconclusive` or `error`
and stable uppercase reason codes.

An invalid definition or evidence bundle returns a distinct
`EvaluationFailure` envelope with `outcome: "invalid_definition"` or
`"invalid_evidence"` and deterministic structured diagnostics. There is
**no invented definition identity, findings or grade** on an invalid-input
envelope. A failure and a complete result form the discriminated
`EvaluationResponse` union. Internal comparator failures on structurally valid
inputs use `EvaluationResult.outcome: "evaluation_error"` and a value-free
`COMPARATOR_ERROR` reason (or `NUMERIC_OVERFLOW` for an overflowed relative
bound).

## Comparison semantics

| Criterion               | Exact behavior                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exact_text`            | JavaScript UTF-16 code-unit equality (`===`); no hidden whitespace, case, line-ending or Unicode transformation                                                                     |
| `normalized_text`       | Applies only explicitly declared transformations, in the fixed order below, to both actual and expected values                                                                      |
| `number_with_tolerance` | Absolute difference <= `max(absoluteTolerance, relativeTolerance * abs(expected))`, inclusive; no coercion                                                                          |
| `set_equivalence`       | Scalar equality within a declared string/number/boolean type, with authored order and duplicate policies                                                                            |
| `observed_execution`    | Always inconclusive until an independently justified, verified observation port is designed; even `confirmed` assertions supplied by a caller are **not** authenticated correctness |
| `manual_evidence`       | Always inconclusive pending authorized review; presence of a document is never correctness                                                                                          |

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
`number`, so input producers must agree on units and precision beforehand.
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

The only implemented aggregation policy is **all required criteria must
pass**. The caller's `policyVersion` is an immutable lineage label, not
permission to replace this logic with arbitrary thresholds or weights.

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

Any `{ type: "reference", referenceId }` expectation remains
`REFERENCE_UNAVAILABLE`, not pass or fail. Assay does not resolve references
from attacker-controlled observation fields, and hidden expected values are
not copied into returned results. Execution assertion states are
**observations only**; `confirmed` is not proof of a trusted sandbox.
`manual_evidence` remains `REVIEW_REQUIRED` or `ARTIFACT_MISSING`.

Resolving restricted references, proving execution origin and recording
authorized review decisions belong to AY-I03 or host-owned security
boundaries, not to this deterministic comparator milestone.

## Verification

Run `pnpm check`: frozen toolchain, contracts, TypeScript typechecking,
read-only Biome checks, Vitest golden/negative fixtures, and tsdown ESM/type
bundling with compiled-package self-import verification. AY-I04 will add a
separate packed-tarball consumer test. No release, npm publication or
credential authority is implied by source success.
