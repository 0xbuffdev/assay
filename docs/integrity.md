# Versioned definition content integrity (AY-I06)

Assay has two explicit trust boundaries:

1. **Content integrity:** Are the criteria, expected values, policy, revision, and other authored fields exactly those named by the declared digest?
2. **Publisher and evidence authenticity:** Did a trusted publisher authorize that definition and did independently authenticated observations come from the claimed source?

**AY-I06 implements only the first.** A digest is neither a signature nor an access-control token. The source remains unpublished at 0.0.0; official grades, protected references and publisher authentication remain the host's responsibility.

## Creating and checking definitions

Author an **unsigned draft** (all fields except revisionDigest). Then call:

```ts
import {
  createAssessmentDefinition,
  verifyAssessmentDefinition,
  evaluateVerified,
  collectVerifiedObservations,
} from "@0xbuff/assay";

const draft = {
  schemaVersion: 1,
  assessmentId: "smoke",
  revision: "rev1",
  policyVersion: "policy1",
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

const created = createAssessmentDefinition(draft);
if (!created.ok) throw new Error("Invalid authored definition");
const definition = created.value;
const checked = verifyAssessmentDefinition(definition);
if (!checked.ok) throw new Error("Content digest mismatch");

const evidence = {
  schemaVersion: 1,
  definition: {
    assessmentId: definition.assessmentId,
    revision: definition.revision,
    revisionDigest: definition.revisionDigest,
  },
  observations: [
    {
      criterionId: "output",
      evidenceRef: "observed",
      completeness: "complete",
      kind: "text",
      value: "ok",
    },
  ],
};
const outcome = evaluateVerified(definition, evidence);
// outcome is a technical result, NOT a formal grade
```

Use collectVerifiedObservations to guard optional injected provider requests before any provider invocation. It verifies definition content before calling collectObservations and does **not** verify the adapter's run or publisher.

The existing parseAssessmentDefinition is **structural validation**; evaluate is a **pure comparator of caller-claimed identities**. They intentionally remain usable for local exploratory analysis without asserting that a supplied digest is verified. If content integrity matters, always select verifyAssessmentDefinition and evaluateVerified / collectVerifiedObservations. All integrity failures return value-free diagnostics, not a secret expected answer or a full diff.

parseAssessmentDefinitionDraft rejects caller-supplied revisionDigest fields instead of overwriting them. computeDefinitionDigest returns the digest for such a validated draft without constructing a full definition; createAssessmentDefinition both generates the digest and returns a deeply frozen, validated definition.

## Canonical digest algorithm v1 (normative)

Version constant: ASSAY_DEFINITION_DIGEST_VERSION = "v1".

**Permanent persisted-record binding:** Every definition with `schemaVersion: 1`
**MUST use digest profile v1**, including its exact `assay:definition:v1` domain
separator and canonical JSON rules below. A stored definition identifies its
profile through `schemaVersion`; the `sha256:` prefix identifies the hash
algorithm, not a separately selectable canonicalization profile. **Any future
change** to canonicalization, hashed fields, domain separation, or algorithm
**MUST increment `schemaVersion`**, publish a separate profile and golden
vectors, and never reinterpret persisted schema-1 bytes under the new profile.
An implementation that no longer supports an earlier schema must reject it
explicitly rather than silently verify it using a different profile.

- Accept **only** a validated unsigned AssessmentDefinitionDraft, with exact fields schemaVersion, assessmentId, revision, policyVersion and criteria. Invalid, additional, accessor, cyclic, non-finite, too-large and unknown schema fields are rejected before hashing.
- Include every authored field, including the complete criteria array in authored order, each criterion's visibility, mode, kind, parameters, reference IDs, numeric units and normalization policy. The only excluded field is the self-referential **top-level** revisionDigest, which does not exist in the unsigned draft.
- Canonicalize the validated draft recursively as compact JSON. Object keys are sorted by ECMAScript's default UTF-16 code-unit order (Array.prototype.sort with no comparator). Arrays retain their declared order. Keys and primitive strings use JSON.stringify escaping. **No** Unicode normalization, whitespace trimming, reordering of criteria, or case transformation occurs.
- Finite numbers use ECMAScript JSON.stringify's number serialization (including exponent formatting; -0 serializes as 0). Booleans and null use literal JSON tokens. Invalid or unrepresentable values never reach serialization. Optional fields absent from a validated draft are absent from the hash; no undefined fields are permitted.
- UTF-8 encode exactly the ASCII domain separator and newline **assay:definition:v1** followed by LF (one byte 0A), then the canonical JSON. No additional trailing newline.
- Digest = SHA-256 over those bytes, returned as the lowercase string sha256: followed by 64 hex digits.
- Verification parses and freezes the complete signed definition, reconstructs the exact unsigned draft, recomputes the digest, and compares exact lowercase strings. A mismatch returns invalid_definition with DEFINITION_DIGEST_MISMATCH at $.revisionDigest.
- This SHA-256 implementation is synchronous, pure TypeScript/JavaScript and has zero runtime dependencies, no Node crypto import, and no hidden network calls. Cross-platform tests compare published vectors with Node's independent crypto implementation.

### Golden vector

Unsigned draft:

```json
{
  "schemaVersion": 1,
  "assessmentId": "vector",
  "revision": "rev1",
  "policyVersion": "policy1",
  "criteria": [
    {
      "id": "output",
      "mode": "required",
      "visibility": "public",
      "kind": "exact_text",
      "parameters": {
        "expected": { "type": "literal", "value": "café\n" }
      }
    }
  ]
}
```

Canonical JSON (single line; the newline in the value is escaped):

```text
{"assessmentId":"vector","criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"type":"literal","value":"café\n"}},"visibility":"public"}],"policyVersion":"policy1","revision":"rev1","schemaVersion":1}
```

SHA-256 over UTF-8 bytes of the domain separator plus canonical JSON:

```text
sha256:e6382f984b711c58df762bcff7eba872246638a30a60ab07d807f6b7a9e35e8b
```

This vector is independently verified against the Node crypto implementation in tests and a reloaded, persisted schema-1 record. Any future change to hashing, canonicalization or included authored fields requires a separately reviewed **new schema version and digest profile** with new golden vectors; never silently reinterpret a v1 digest.

## Security limits and migration rules

- **No publisher authenticity:** An attacker can create their own modified draft and compute a perfectly valid digest. An authorized host still needs authenticated source/policy admission, independently resolved protected expectations, runner provenance and access controls.
- **No automatic hiding of restricted criteria:** The digest check sees validated definition content and may include reference IDs in its hash input. Do not hand out full private definitions or full technical findings to untrusted learners; the restricted public projection is scoped separately in AY-I07.
- **No result signature:** A valid JSON result or verified digest does not make evidence, an AI verdict, or official credit authentic.
- **No legacy adapter:** The package is unreleased, so callers using new authored definitions should create them from drafts rather than populating the digest with arbitrary placeholder hex. The unverified comparator remains explicitly named and documented as such, not as a credential path.
- **Collision resistance is not source authenticity:** SHA-256 provides content integrity under its usual cryptographic assumptions; an independently established authorized digest or authenticated publisher is needed to prevent substitution of both the definition and its digest.
