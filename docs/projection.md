# Learner-safe technical result projection (AY-I07, AY-I20)

Assay's full `EvaluationResult` is an **authorized technical record**, not a learner response. It may contain restricted criterion identifiers, observation evidence references, comparator reason codes, aggregate results influenced by hidden checks and warnings. Returning that entire object from a learner API could disclose protected assessment details or enable an answer oracle.

Use **`projectPublicResult(definition, technicalResult)`** to create a narrow, deliberately redacted view. This does **not** give a user permission to see that view: the host must authenticate the requester, decide which assessment belongs to them, and ensure the definition and original result came from trusted sources.

## What the projection returns

A successful call returns:

```ts
{
  ok: true,
  value: {
    schemaVersion: 4,
    outcome: "withheld", // any restricted criteria, even advisory
    findings: [{ criterionId: "public-output", outcome: "pass", reason: "match" }]
  }
}
```

- For **all-public** definitions, the `outcome` is the technical outcome of the explicit required group tree: `pass`, `fail`, `inconclusive`, or `evaluation_error`. Public findings retain **only** their criterion IDs, outcomes and finite mapped public reasons.
- If the definition contains **any restricted criterion**, the overall outcome is **always `withheld`**, regardless of hidden passes, failures, missing evidence, errors, advisory warnings or the number of hidden checks. Visible public findings remain in their authored order. The projection does not report restricted counts.
- **Never returned:** restricted criterion IDs, hidden assertion/reference IDs, evidence references (including public evidence references), raw technical reason codes, evaluator metadata, full definition/revision, evidence and artifact digests, policy versions, composition and group IDs, technical warnings, hidden aggregate outcome, submitted values or diagnostic paths.
- Invalid inputs always return the same frozen, value-free error: `{ ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" }`. The output does not reveal which hidden criterion or field was invalid.
- The projection only returns schema-valid immutable objects. All public result fields are explicitly constructed from the validated definition and technical findings; no unknown input fields are carried through.

## Public reason allowlist

| Public reason         | Meaning                                                           | Built-in technical reasons                                           |
| --------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| `match`               | Observed fact matches the declared comparison                     | `MATCH`                                                              |
| `mismatch`            | Observed fact does not match                                      | `VALUE_MISMATCH`                                                     |
| `missing_evidence`    | Observation or manual artifact is absent                          | `EVIDENCE_MISSING`, `ARTIFACT_MISSING`                               |
| `incomplete_evidence` | Capture, assertion, execution or review is incomplete             | `EVIDENCE_TRUNCATED`, `ASSERTION_INCOMPLETE`, `EXECUTION_INCOMPLETE` |
| `review_needed`       | Manual evidence or valid complete qualitative review needs review | `REVIEW_REQUIRED`                                                    |
| `unavailable`         | Reference or independently verified execution is unavailable      | `REFERENCE_UNAVAILABLE`, `EXECUTION_UNVERIFIED`                      |
| `evaluation_error`    | Evaluation could not complete                                     | `COMPARATOR_ERROR`, `NUMERIC_OVERFLOW`                               |

The mapping is exhaustive over the supported technical taxonomy. It is applied
only to public findings after validation of the full record, never to hidden
findings. The current projection uses schema 4 with the mandatory `reason` field and no group structure.

**Example:**

```ts
import {
  createAssessmentDefinition,
  createEvidenceBundle,
  evaluate,
  projectPublicResult,
} from "@0xbuff/assay";

const drafted = createAssessmentDefinition({
  schemaVersion: 4,
  assessmentId: "example",
  revision: "rev1",
  policyVersion: "composed-required-v1",
  composition: {
    rootGroupId: "root",
    groups: [
      { id: "root", operator: "all", children: [{ kind: "criterion", id: "public-output" }] },
    ],
  },
  criteria: [
    {
      id: "public-output",
      mode: "required",
      visibility: "public",
      kind: "exact_text",
      parameters: { expected: { type: "literal", value: "ok" } },
    },
  ],
});
if (!drafted.ok) throw new Error("Definition invalid");
const definition = drafted.value;

const prepared = createEvidenceBundle(definition, {
  schemaVersion: 4,
  observations: [
    {
      criterionId: "public-output",
      evidenceRef: "host-reference",
      completeness: "complete",
      kind: "text",
      value: "ok",
    },
  ],
});
if (!prepared.ok) throw new Error("Invalid evidence");
const technical = evaluate(definition, prepared.value);
const response = projectPublicResult(definition, technical);
// Only `response` may be considered for a learner API, after host authorization.
// Never serialize `definition`, `technical`, or observation input to learners.
```

## Validation, source integrity and limits

1. The definition **must** have a verifiable, supported schema canonical content digest. The function uses `verifyAssessmentDefinition` from AY-I06 before reading any findings. An attacker cannot change a restricted criterion to public while keeping the old digest.
2. The complete result must pass `parseEvaluationResult` bounded shape checks, match the **exact** assessment ID, revision, digest and policy version, and have exactly one finding per criterion in its original order. Every finding must agree with the supported evaluator identity/version and a closed outcome/reason pair. Its reason must be compatible with the criterion kind, reference declaration and any known numeric tolerance bound; a literal overflow cannot claim match or mismatch, and a bound that cannot overflow cannot claim numeric overflow. Unknown reference values are not inferred; an absent observation has no evidence reference, other findings have exactly one, and evidence references cannot repeat across findings. The shared aggregation and advisory warning calculation must agree with the complete result. The result carries a mandatory evidence digest and optional artifact digest; projection checks their shape but has no evidence input with which to authenticate them. The host must retain and verify the exact evidence.
3. The full technical aggregate must match the explicit required group tree under the shared composition semantics. Forged `pass`, omitted/extra/reordered findings, mismatched lineage or unsupported fields are rejected with **one opaque error**.
4. For public criteria, the function constructs **only** `criterionId`, technical `outcome` and the mapped public `reason`; for restricted ones, it copies **nothing**. The full aggregate is never copied directly, and hidden/advisory warning flags are dropped.
5. The function has no I/O, runtime dependencies, side-effectful callbacks, secret lookup or external execution. Inputs are copied/validated under the existing bounded, getter-safe contract validators.

### Trust boundary

**This is a data projection, not authorization, attestation or a secure grading protocol.** A malicious caller can independently create and hash their own definition and supply a structurally consistent fake result. The host must authenticate and approve the definition, verify result origin, enforce which learner can see which projection, and keep protected definitions/full findings inside an appropriately isolated environment. SHA-256 content integrity alone does not prove publisher identity.

The projection also cannot prevent **probing through repeated submissions** if a host exposes further hidden feedback elsewhere, exposes timing, or uses the presence of restricted checks as an unintended signal. The returned `withheld` is a stable summary that conveys no secret outcome but indicates that an aggregate is not available; applications requiring secrecy of even the **existence** of restricted checks should use a host-defined fixed response envelope and not expose criterion metadata. Test fixtures check identical public bytes across multiple private pass/fail/error permutations. No formal grade or official credit is conferred.

For a qualitative criterion, projection accepts only inconclusive with EVIDENCE_MISSING and zero evidence references, or EVIDENCE_TRUNCATED/REVIEW_REQUIRED with one unique reference and a valid result artifact digest. All other pairs are rejected opaquely. Review feedback, attribution, uncertainty and citation locations are never projected; a restricted review also withholds the aggregate. The host separately authorizes access to privileged evidence.
