# Learner-safe technical result projection (AY-I07)

Assay's full `EvaluationResult` is an **authorized technical record**, not a learner response. It may contain restricted criterion identifiers, observation evidence references, comparator reason codes, aggregate results influenced by hidden checks and warnings. Returning that entire object from a learner API could disclose protected assessment details or enable an answer oracle.

Use **`projectPublicResult(definition, technicalResult)`** to create a narrow, deliberately redacted view. This does **not** give a user permission to see that view: the host must authenticate the requester, decide which assessment belongs to them, and ensure the definition and original result came from trusted sources.

## What the projection returns

A successful call returns:

```ts
{
  ok: true,
  value: {
    schemaVersion: 1,
    outcome: "withheld", // any restricted criteria, even advisory
    findings: [{ criterionId: "public-output", outcome: "pass" }]
  }
}
```

- For **all-public** definitions, the `outcome` is the technical conjunction of all required criterion findings: `pass`, `fail`, `inconclusive`, or `evaluation_error`. Public findings retain **only** their criterion IDs and outcomes.
- If the definition contains **any restricted criterion**, the overall outcome is **always `withheld`**, regardless of hidden passes, failures, missing evidence, errors, advisory warnings or the number of hidden checks. Visible public findings remain in their authored order. The projection does not report restricted counts.
- **Never returned:** restricted criterion IDs, hidden assertion/reference IDs, evidence references (including public evidence references), reason codes, evaluator metadata, full definition/revision digests, policy versions, technical warnings, hidden aggregate outcome, submitted values or diagnostic paths.
- Invalid inputs always return the same frozen, value-free error: `{ ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" }`. The output does not reveal which hidden criterion or field was invalid.
- The projection only returns schema-valid immutable objects. All public result fields are explicitly constructed from the validated definition and technical findings; no unknown input fields are carried through.

**Example:**

```ts
import {
  createAssessmentDefinition,
  evaluateVerified,
  projectPublicResult,
} from "@0xbuff/assay";

const drafted = createAssessmentDefinition({
  schemaVersion: 1,
  assessmentId: "example",
  revision: "rev1",
  policyVersion: "policy1",
  criteria: [{
    id: "public-output",
    mode: "required",
    visibility: "public",
    kind: "exact_text",
    parameters: { expected: { type: "literal", value: "ok" } },
  }],
});
if (!drafted.ok) throw new Error("Definition invalid");
const definition = drafted.value;

const technical = evaluateVerified(definition, {
  schemaVersion: 1,
  definition: {
    assessmentId: definition.assessmentId,
    revision: definition.revision,
    revisionDigest: definition.revisionDigest,
  },
  observations: [{
    criterionId: "public-output",
    evidenceRef: "host-reference",
    completeness: "complete",
    kind: "text",
    value: "ok",
  }],
});
const response = projectPublicResult(definition, technical);
// Only `response` may be considered for a learner API, after host authorization.
// Never serialize `definition`, `technical`, or observation input to learners.
```

## Validation, source integrity and limits

1. The definition **must** have a verifiable, schema-v1 canonical content digest. The function uses `verifyAssessmentDefinition` from AY-I06 before reading any findings. An attacker cannot change a restricted criterion to public while keeping the old digest.
2. The complete result must pass `parseEvaluationResult` bounded shape checks, match the **exact** assessment ID, revision, digest and policy version, and have exactly one finding per criterion in its original order. Every finding must agree with the top-level evaluator identity/version.
3. The full technical aggregate must match the required-finding conjunction under Assay's existing fail-closed precedence. Forged `pass`, omitted/extra/reordered findings, mismatched lineage or unsupported fields are rejected with **one opaque error**.
4. For public criteria, the function copies **only** `criterionId` and technical `outcome`; for restricted ones, it copies **nothing**. The full aggregate is never copied directly, and hidden/advisory warning flags are dropped.
5. The function has no I/O, runtime dependencies, side-effectful callbacks, secret lookup or external execution. Inputs are copied/validated under the existing bounded, getter-safe contract validators.

### Trust boundary

**This is a data projection, not authorization, attestation or a secure grading protocol.** A malicious caller can independently create and hash their own definition and supply a structurally consistent fake result. The host must authenticate and approve the definition, verify result origin, enforce which learner can see which projection, and keep protected definitions/full findings inside an appropriately isolated environment. SHA-256 content integrity alone does not prove publisher identity.

The projection also cannot prevent **probing through repeated submissions** if a host exposes further hidden feedback elsewhere, exposes timing, or uses the presence of restricted checks as an unintended signal. The returned `withheld` is a stable summary that conveys no secret outcome but indicates that an aggregate is not available; applications requiring secrecy of even the **existence** of restricted checks should use a host-defined fixed response envelope and not expose criterion metadata. Test fixtures check identical public bytes across multiple private pass/fail/error permutations. No formal grade or official credit is conferred.
