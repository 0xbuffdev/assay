# Versioned Assay contracts (AY-I01)

Assay validates versioned assessment definitions, bounded typed evidence and
technical finding records. AY-I02 adds deterministic literal comparisons
through `evaluate` as described in [evaluation](evaluation.md); it still does
**not execute submitted code, authenticate evidence, declare competence or award academic credit**.

## Minimal example

```ts
import {
  createAssessmentDefinition,
  createEvidenceBundle,
  parseAssessmentDefinition,
  parseEvidenceBundle,
  inspectEvidenceCoverage,
} from "@0xbuff/assay";

const created = createAssessmentDefinition({
  schemaVersion: 3,
  assessmentId: "sample",
  revision: "rev1",
  policyVersion: "composed-required-v1",
  composition: {
    rootGroupId: "root",
    groups: [{ id: "root", operator: "all", children: [{ kind: "criterion", id: "output" }] }],
  },
  criteria: [
    {
      id: "output",
      mode: "required",
      visibility: "public",
      kind: "exact_text",
      parameters: { expected: { type: "literal", value: "ok" } },
    },
  ],
});
if (!created.ok) throw new Error("Invalid authored definition");
const definition = created.value;

const prepared = createEvidenceBundle(definition, {
  schemaVersion: 3,
  observations: [],
});
if (!prepared.ok) throw new Error("Invalid evidence");
const observed = prepared.value;

const parsedDefinition = parseAssessmentDefinition(definition);
const parsedEvidence = parseEvidenceBundle(observed);
const coverage = inspectEvidenceCoverage(definition, observed);
// coverage.value.missingRequired = ["output"] when coverage.ok === true
// This is NOT a pass or fail: the required observation is missing.
```

For new definitions, use [canonical content integrity](integrity.md) to create a
validated, content-bound digest from an unsigned draft. `evaluate` checks
this integrity before comparing evidence; the structural APIs shown here do
not independently authenticate or verify a publisher.

Use Assay's `computeDefinitionDigest` or `createAssessmentDefinition` to derive
the canonical hash. Evaluation, acquisition and public projection verify it
automatically; `verifyAssessmentDefinition` is available for explicit checks.
**The host** must authenticate the publisher and independently decide
whether that definition or digest is authorized; a matching hash alone cannot
establish origin or grading authority. The source package remains unreleased;
the import shown represents the future package entry.

## Definition rules

- A definition has `schemaVersion: 3`, `assessmentId`, immutable
  `revision` and `revisionDigest`, `policyVersion` an explicit `composition`, and 1–64 criteria.
- At least one criterion must be `required`. IDs must be distinct; the
  sentinel revision `latest` is not a stable identity.
- The digest syntax is lowercase `sha256:` followed by 64 hex digits.
  **Generation 3 uses digest profile v3**; all older runtime schemas are rejected. A new canonicalization profile requires a new schema version. Structural parsing
  checks digest **format only**; the integrity-checking APIs check
  content correctness. Neither authenticates a publisher or signs a definition.
- Each criterion declares `mode`, `visibility`, `kind` and closed
  `parameters`. There are no executable callback predicates, implicit
  thresholds or default normalization rules.
- Text comparisons declare a literal or reference expectation; normalized text
  also declares line-ending, Unicode, case, whitespace and trim choices.
  Schema-2 objective references require both `referenceId` and `referenceDigest`;
  schema 1 retains its original ID-only format and digest profile.
- `number_with_tolerance` requires explicit finite, nonnegative absolute **and**
  relative tolerances; `number_range` instead declares finite bounds and explicit
  endpoint inclusion. Neither coerces strings to numbers. For both kinds, numeric
  observations carry the criterion's exact optional `unit` identifier, including
  deliberate absence. A mismatch returns `invalid_evidence` before comparison,
  without unit conversion. See [evaluation semantics](evaluation.md#ay-i17-objective-comparisons-schema-3).
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

## Criterion composition (AY-I23)

The sole policy is `composed-required-v1`. The required `composition` object contains `rootGroupId` and an authored array of groups, each with an ID, operator `all` or `any`, and nonempty children. Each child has exactly `kind: "criterion" | "group"` and `id`. IDs are disjoint and unique across groups and criteria; root has no parent, every other group exactly one, all are reachable, and cycles and sharing are forbidden. Every required criterion must appear once; advisory criteria cannot be included. Ordinary conjunction is one explicit all group.

The composition is bounded to 64 groups, 64 children per group, eight group levels and 127 child edges. All ordinary snapshot limits still apply. Authored order participates in the definition digest. See [aggregation semantics](evaluation.md#required-versus-advisory-decisions).

## Content-bound reference contracts (AY-I13)

Use `createReferenceRecord` to construct a frozen, privileged schema-3 reference
record and `verifyReferenceBundle` to validate separately supplied records
against a verified schema-3 definition. The bundle names the exact assessment,
revision and revision digest; each record has an ID, kind, typed value and
content digest. Number and range records carry the criterion's exact optional
unit; set records declare a matching item type. Unknown, duplicate, malformed,
wrong-kind, wrong-unit or tampered references are invalid input, not learner
failure. Definitions cannot repeat an objective reference ID in schema 3.
An empty or partial bundle is permitted, not a completeness claim.

AY-I14 adds optional reference bundles to `evaluate(definition, evidence, references?)`.
Valid supplied records use the same objective comparator as literals; missing
records are inconclusive, and malformed material returns an `invalid_reference`
failure envelope. Execution assertions retain ID-only metadata and remain non-authoritative;
AY-I18 owns their replacement with typed execution facts. See
[the canonical profiles](integrity.md#current-generation-reference-integrity).

## Evidence rules

`parseEvidenceBundle` accepts `schemaVersion: 3`, an assessment identity,
a required evidenceDigest, an optional artifact digest, and observations tagged `text`, `number`,
`set`, `boolean`, `json`, `execution` or `manual`. Each observation declares a criterion
ID, unique evidence reference and completeness (`complete` or `truncated`).
Use `createEvidenceBundle(definition, draft)` to derive definition lineage and
seal content. A structural parse checks digest syntax, not integrity;
`verifyEvidenceBundle`, evaluation and acquisition recompute it. Unsigned or superseded-generation bundles are rejected. Unknown fields, bogus `trusted` claims, duplicate observation IDs, unsupported
values and malformed data are rejected.

An optional origin claims `kind: "independent" | "artifact"`, sourceRef,
optional runRef and optional bounded provenance. Artifact origins require
the exact bundle artifactDigest; independent origins cannot carry one. A
scoped bundle requires every observation to declare its origin. Unscoped
observations may omit origin, but cannot claim an artifact. Execution run
references must match any stated origin. Claims for the same source/run
cannot conflict in scope or provenance. A supplied provenance record must
match source/run. Known output truncation applies to every observation
claiming the same source/run pair, including observations that omit their
own provenance. Without stream attribution, complete claims for that run
are rejected; distinct source/run pairs retain their own completeness. A correction
creates a new sealed evidence bundle. See [integrity](integrity.md#current-generation-evidence-integrity).

**Absent observations and truncated data are structurally valid.** A caller can
use `inspectEvidenceCoverage` to identify missing or incomplete _required_
leaves (including unselected alternatives, truncated output, missing execution assertions and empty manual artifacts) and reject mismatched definition identities, unknown criterion IDs or
incompatible observation kinds. Coverage is an inventory, not the composed aggregate. This helper does not compare observations
against expected values or conclude `pass`/`fail`; `evaluate` performs
local literal and content-bound reference comparisons under the documented conditions.

The library cannot establish that submitted observation values came from
a trustworthy runner. A caller cannot turn `evidenceRef`, `revisionDigest`
or `runRef` strings into authenticated proof by naming them.

## Findings

A complete `EvaluationResult` is **not** safe to serialize directly for learners.
It may expose restricted criterion identities, evidence references, private
reason codes, warnings and aggregate conclusions. Use the explicit
[learner-safe projection](projection.md) after host authentication and source
approval. The projection does not authenticate a purported result.

`parseEvaluationResult` validates the shape of a typed, versioned technical
schema-3 finding record, with evidenceDigest, optional artifactDigest,
criterion outcomes, reason codes, evidence references,
evaluator identity and warnings. Only `composed-required-v1` is supported, and
complete records cannot carry invalid-input outcomes. The built-in
`ReasonCode` and `WarningCode` unions are closed; finding outcomes must match
their reasons, and evaluator identity/version must match the supported semantics.
A single internal outcome-to-reason mapping defines the derived TypeScript
unions, correlated finding and comparison types, and parser membership checks.
An empty finding list or duplicate warning is invalid.
It is **structural validation, not attestation**:
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

`CONTRACT_LIMITS` exposes and tests the exact bounds. They apply to each entire input record, including nested values; no implicit
network or model access occurs.

| Limit                                               |                  Maximum |
| --------------------------------------------------- | -----------------------: |
| Object/array depth                                  |                       12 |
| Visited nodes                                       |                    4,096 |
| UTF-8 budget for input strings and property names   |            262,144 bytes |
| Individual string or property name length           | 16,384 UTF-16 code units |
| Object fields                                       |                       32 |
| Array elements                                      |                      128 |
| Definition criteria                                 |                       64 |
| Composition groups                                  |                       64 |
| Children per group                                  |                       64 |
| Group depth (root = 1)                              |                        8 |
| Total child edges                                   |                      127 |
| Evidence observations                               |                      128 |
| Set elements                                        |                      128 |
| Evidence references per finding                     |                       32 |
| Returned structured diagnostics                     |                       32 |
| Combined stdout/stderr capture per provenance       |             65,536 bytes |
| Serialized JSON transport per record                |            262,144 bytes |
| Combined transport (definition/evidence/references) |            786,432 bytes |

The parser copies and freezes accepted data. It rejects cycles, sparse
arrays, accessor properties, custom prototypes, non-finite numbers, functions,
symbols and prototype-pollution keys. Dense arrays are rejected by
length before their indexed properties are inspected; objects with too many
enumerable fields are rejected before property-descriptor inspection.
Failed validation returns bounded, ordered `{ path, code }` diagnostics and
a domain (`invalid_definition`, `invalid_evidence`, `invalid_reference` or `invalid_result`).
Diagnostics include safe, published schema field paths (for example,
`$.criteria[0].parameters.expected.value`) but never submitted values or
unknown field names.

The contract validators continue to accept JavaScript values, not raw JSON text.
Use `decodeSerializedRecord(text)` first for serialized input. It accepts only a
primitive string containing one JSON object, checks UTF-8 transport size before
parsing, bounds depth, nodes and collection sizes before whole-record decoding,
and rejects duplicate decoded keys (including escape-equivalent names) at every
object level, malformed JSON, non-finite numbers and unsafe property names. The
result is an immutable bounded record, not a validated definition, evidence or
reference. Pass it to the appropriate existing validator or integrity operation.
Do not use `JSON.parse` first: duplicate names cannot be recovered afterward.
The decoder's failure contains only a bounded diagnostic array with root paths;
it never reports parser exception messages or input text.

Transport accounting includes punctuation, escape sequences and whitespace.
Snapshot accounting counts each value as a node (root depth zero), each decoded
string and property name in UTF-8 bytes, and string/name length in UTF-16 code
units. Keys are counted in the byte budget but not as nodes. The three evaluation
records each have their own full bounds, hence at most 786,432 transport bytes,
12,288 snapshot nodes and 786,432 counted string/key bytes in total. Combined
prepared evidence is revalidated as a single record, not granted one budget per
observation or provider. Hosts must cap raw input bytes before allocating or
decoding strings, reject invalid UTF-8, and cap total records and concurrent work.
The library does not accept byte arrays, streams or executable objects at the
serialized boundary. JavaScript Proxy traps may execute when a host accesses
a Proxy; callers must not treat an in-process arbitrary object as a sandboxed
format. Reflection on preexisting objects can allocate property-name lists before
rejection; neither validation path is a process memory limit or isolation sandbox.
Host security and independent evidence-origin verification remain
outside the portable library.

## API surface

`decodeSerializedRecord(text: unknown): SerializedRecordResult` is an explicit
transport decoder; it does not authenticate, seal or validate any contract.

`parseAssessmentDefinition(input: unknown)`,
`parseEvidenceBundle(input: unknown)`,
`parseEvaluationResult(input: unknown)` and
`inspectEvidenceCoverage(definition: unknown, evidence: unknown)`
return discriminated `ValidationResult<T>` values. On success the data is
deeply cloned and frozen; on error the output reports only diagnostic codes
and paths. `createEvidenceBundle(definition, draft)` and
`verifyEvidenceBundle(definition, evidence)` return typed validation results.
The separate `evaluate(definition, evidence, references?)` operation produces
versioned technical findings or an invalid-input diagnostic envelope as
documented in [evaluation](evaluation.md). No compatibility layer is promised
for unshipped versions.

Run `pnpm check` to validate the frozen dependency tree, TypeScript, Biome,
Vitest and the tsdown ESM/type-declaration build. No package release is
authorized by this milestone.

AY-I17 adds current `boolean_equality`, `number_range`, and
`json_equality` criteria, with matching typed observation/reference contracts.
The shared snapshot bounds apply to the entire definition, reference bundle,
or evidence bundle, including nested JSON values; prohibited keys, non-finite
numbers, cycles and accessors are rejected. The separate AY-I21 decoder handles raw JSON text.
See [evaluation semantics](evaluation.md#ay-i17-objective-comparisons-schema-3).

AY-I18 adds an optional schema-3 criterion `executionFact` and matching
selected observation with a required scoped run origin and termination.
See the [closed selector and completeness contract](evaluation.md#ay-i18-typed-execution-facts-schema-3).
Assertion-only execution and manual artifacts remain non-authoritative.
