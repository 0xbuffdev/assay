# Versioned Assay contracts (AY-I01)

Assay validates versioned assessment definitions, bounded typed evidence and
technical finding records. AY-I02 adds deterministic literal comparisons
through `evaluate` as described in [evaluation](evaluation.md); it still does
**not execute submitted code, authenticate evidence, declare competence or award academic credit**.

## Minimal example

```ts
import {
  parseAssessmentDefinition,
  parseEvidenceBundle,
  inspectEvidenceCoverage,
} from "@0xbuff/assay";

const definition = {
  schemaVersion: 1,
  assessmentId: "sample",
  revision: "rev1",
  revisionDigest: "sha256:" + "a".repeat(64),
  policyVersion: "v1",
  criteria: [
    {
      id: "output",
      mode: "required",
      visibility: "public",
      kind: "exact_text",
      parameters: { expected: { type: "literal", value: "ok" } },
    },
  ],
};

const observed = {
  schemaVersion: 1,
  definition: {
    assessmentId: "sample",
    revision: "rev1",
    revisionDigest: "sha256:" + "a".repeat(64),
  },
  observations: [],
};

const parsedDefinition = parseAssessmentDefinition(definition);
const parsedEvidence = parseEvidenceBundle(observed);
const coverage = inspectEvidenceCoverage(definition, observed);
// coverage.value.missingRequired = ["output"] when coverage.ok === true
// This is NOT a pass or fail: the required observation is missing.
```

The example's digest is a syntactically valid **placeholder**, not proof that
the source was hashed, signed or approved. A production caller must derive and
authenticate the canonical definition identity outside Assay. The source package
remains unreleased; the import shown represents the future package entry.

## Definition rules

- A definition has `schemaVersion: 1`, `assessmentId`, immutable
  `revision` and `revisionDigest`, `policyVersion` and 1–64 criteria.
- At least one criterion must be `required`. IDs must be distinct; the
  sentinel revision `latest` is not a stable identity.
- The digest syntax is lowercase `sha256:` followed by 64 hex digits. The
  validator checks **format only**. It does not authenticate a publisher,
  verify hash correctness or sign a definition.
- Each criterion declares `mode`, `visibility`, `kind` and closed
  `parameters`. There are no executable callback predicates, implicit
  thresholds or default normalization rules.
- Text comparisons declare a literal or reference expectation; normalized text
  also declares line-ending, Unicode, case, whitespace and trim choices.
- Numeric criteria require explicit finite, nonnegative absolute **and**
  relative tolerances; no implicit string-to-number coercion. Numeric observations
  have an optional `unit` identifier. If the criterion declares `unit`, its
  observation must carry the **same** identifier; if omitted, both must omit
  it. Mismatch or absence returns `invalid_evidence` before comparison,
  without any unit conversion.
- Set criteria declare element type, ordering and duplicate policy.
- Execution criteria declare assertion and reference IDs, **not** an embedded
  command or code runner.
- Manual criteria mark review as required. Their mere presence never passes a
  requirement. Restricted criteria require reference IDs rather than embedding
  private literal expected answers.

These are **validated shapes** consumed by the AY-I02
[deterministic comparator](evaluation.md). AY-I03 additionally provides the [optional observation port](observations.md)
with bounded claimed provenance and protected-reference redaction. Verified
execution trust and protected answer resolution remain host responsibilities.

## Evidence rules

`parseEvidenceBundle` accepts `schemaVersion: 1`, an assessment identity,
an optional artifact digest, and observations tagged `text`, `number`,
`set`, `execution` or `manual`. Each observation declares a criterion
ID, unique evidence reference and completeness (`complete` or `truncated`).
Unknown fields, bogus `trusted` claims, duplicate observation IDs, unsupported
values and malformed data are rejected.

**Absent observations and truncated data are structurally valid.** A caller can
use `inspectEvidenceCoverage` to identify missing or incomplete _required_
criteria (including truncated output, missing execution assertions and empty manual artifacts) and reject mismatched definition identities, unknown criterion IDs or
incompatible observation kinds. This helper does not compare observations
against expected values or conclude `pass`/`fail`; `evaluate` performs
local literal comparisons under the documented conditions.

The library cannot establish that submitted observation values came from
a trustworthy runner. A caller cannot turn `evidenceRef`, `revisionDigest`
or `runRef` strings into authenticated proof by naming them.

## Findings

`parseEvaluationResult` validates the shape of a typed, versioned technical
finding record, with criterion outcomes, reason codes, evidence references,
evaluator identity and warnings. It is **structural validation, not attestation**:
parsing a caller-supplied `"pass"` is not verification of correctness or
official credit.

There are no grade, enrollment, credential, learner identity or entitlement
fields in the public contracts. Unknown fields are errors. AY-I02 now returns
real criterion-level findings for complete local literal comparisons through
[`evaluate`](evaluation.md). Unresolved reference IDs, unverified execution
claims and manual review remain inconclusive; verified observation integration
and restricted-reference handling belong to AY-I03. Technical findings do not
authenticate evidence or award official credit.

## Validation and safety limits

`CONTRACT_LIMITS` exposes and tests the exact bounds. They apply to an
individual input object; no implicit network or model access occurs.

| Limit                                             |                  Maximum |
| ------------------------------------------------- | -----------------------: |
| Object/array depth                                |                       12 |
| Visited nodes                                     |                    4,096 |
| UTF-8 budget for input strings and property names |            262,144 bytes |
| Individual string length                          | 16,384 UTF-16 code units |
| Object fields                                     |                       32 |
| Array elements                                    |                      128 |
| Definition criteria                               |                       64 |
| Evidence observations                             |                      128 |
| Set elements                                      |                      128 |
| Evidence references per finding                   |                       32 |
| Returned structured diagnostics                   |                       32 |

The parser copies and freezes accepted data. It rejects cycles, sparse
arrays, accessor properties, custom prototypes, non-finite numbers, functions,
symbols and prototype-pollution keys. Dense arrays are rejected by
length before their indexed properties are inspected; objects with too many
enumerable fields are rejected before property-descriptor inspection.
Failed validation returns bounded, ordered `{ path, code }` diagnostics and
a domain (`invalid_definition`, `invalid_evidence` or `invalid_result`).
Diagnostics include safe, published schema field paths (for example,
`$.criteria[0].parameters.expected.value`) but never submitted values or
unknown field names.

The validators accept JavaScript values, **not raw JSON text**. If a caller
needs to reject duplicate keys in serialized JSON or cryptographically bind
a published document, that requirement must be handled before passing a
decoded value to Assay. JavaScript Proxy traps may execute when a host accesses
a Proxy; callers must not treat an in-process arbitrary object as a sandboxed
format. Host security and independent evidence-origin verification remain
outside the portable library.

## API surface

`parseAssessmentDefinition(input: unknown)`,
`parseEvidenceBundle(input: unknown)`,
`parseEvaluationResult(input: unknown)` and
`inspectEvidenceCoverage(definition: unknown, evidence: unknown)`
return discriminated `ValidationResult<T>` values. On success the data is
deeply cloned and frozen; on error the output reports only diagnostic codes
and paths. The separate `evaluate(definition, evidence)` operation produces
versioned technical findings or an invalid-input diagnostic envelope as
documented in [evaluation](evaluation.md). No compatibility layer is promised
for unshipped versions.

Run `pnpm check` to validate the frozen dependency tree, TypeScript, Biome,
Vitest and the tsdown ESM/type-declaration build. No package release is
authorized by this milestone.
