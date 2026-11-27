# Versioned definition, reference and evidence content integrity

Assay has two explicit trust boundaries:

1. **Content integrity:** Are the criteria, expected values, policy, revision, and other authored fields exactly those named by the declared digest?
2. **Publisher and evidence authenticity:** Did a trusted publisher authorize that definition and did independently authenticated observations come from the claimed source?

**Assay implements only the first.** A digest is neither a signature nor an access-control token. The source remains unpublished at 0.0.0; official grades, protected references and publisher authentication remain the host's responsibility.

## Creating and checking definitions

Author an **unsigned draft** (all fields except revisionDigest). Then call:

```ts
import {
  createAssessmentDefinition,
  createEvidenceBundle,
  verifyAssessmentDefinition,
  evaluate,
  collectObservations,
} from "@0xbuff/assay";

const draft = {
  schemaVersion: 1,
  assessmentId: "smoke",
  revision: "rev1",
  policyVersion: "all-required-v1",
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

const prepared = createEvidenceBundle(definition, {
  schemaVersion: 2,
  observations: [
    {
      criterionId: "output",
      evidenceRef: "observed",
      completeness: "complete",
      kind: "text",
      value: "ok",
    },
  ],
});
if (!prepared.ok) throw new Error("Invalid evidence");
const evidence = prepared.value;
const outcome = evaluate(definition, evidence);
// outcome is a technical result, NOT a formal grade
```

`collectObservations` verifies definition content before inspecting evidence or invoking the optional injected provider. It does **not** verify the adapter's run or publisher.

`parseAssessmentDefinition` and `inspectEvidenceCoverage` perform structural checks, not integrity verification. `evaluate`, `collectObservations` and `projectPublicResult` always verify definition integrity. `verifyAssessmentDefinition` remains available for explicit admission checks. All integrity failures return value-free diagnostics or an opaque projection rejection, not a secret expected answer or a full diff.

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
  "policyVersion": "all-required-v1",
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
{"assessmentId":"vector","criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"type":"literal","value":"café\n"}},"visibility":"public"}],"policyVersion":"all-required-v1","revision":"rev1","schemaVersion":1}
```

SHA-256 over UTF-8 bytes of the domain separator plus canonical JSON:

```text
sha256:7be081910e17919c0b08bcff0543d80c7b8c540541b58bcb70630f5d561cfc2f
```

This vector is independently verified against the Node crypto implementation in tests and a reloaded, persisted schema-1 record. Any future change to hashing, canonicalization or included authored fields requires a separately reviewed **new schema version and digest profile** with new golden vectors; never silently reinterpret a v1 digest.

## Security limits and migration rules

- **No publisher authenticity:** An attacker can create their own modified draft and compute a perfectly valid digest. An authorized host still needs authenticated source/policy admission, independently resolved protected expectations, runner provenance and access controls.
- **No automatic hiding of restricted criteria:** The digest check sees validated definition content and may include reference IDs in its hash input. Do not hand out full private definitions or full technical findings to untrusted learners; the restricted public projection is scoped separately in AY-I07.
- **No result signature:** A valid JSON result or verified digest does not make evidence, an AI verdict, or official credit authentic.
- **No legacy adapter:** The package is unreleased, so callers using new authored definitions should create them from drafts rather than populating the digest with arbitrary placeholder hex. The unchecked evaluation and collection paths have been removed; there is no compatibility alias.
- **Collision resistance is not source authenticity:** SHA-256 provides content integrity under its usual cryptographic assumptions; an independently established authorized digest or authenticated publisher is needed to prevent substitution of both the definition and its digest.

## Canonical digest algorithm v2 (AY-I13)

Schema-1 definition bytes remain exactly as documented above.
`ASSAY_SCHEMA_VERSION` and `ASSAY_DEFINITION_DIGEST_VERSION` retain their
original values for schema-1 records and profile v1. Definitions now also
admit schema 2. AY-I15 migrates evidence, full technical results, and acquisition records to schema 2; the public projection remains schema 1.

For schema-2 definitions use the domain `assay:definition:v2` followed by LF,
then the same canonical JSON rules as v1. Exclude only the definition's
top-level `revisionDigest`. An objective reference expectation has exactly
`{ type: "reference", referenceId, referenceDigest }`; its value kind is
inferred from the criterion, including the optional number or range unit and set item type.
Duplicate objective reference IDs are rejected even when identical.
Schema-1 declarations do not accept the new digest field.

For reference records use the domain `assay:reference:v2` followed by LF,
then canonical JSON of the validated unsigned record. Exclude only the
record's own `referenceDigest`. Record fields are:
`schemaVersion: 2`, `referenceId`, `kind`, `value`, and, for `number` and
`range`, an optional `unit` (omission is deliberate unitlessness); for `set`, a
required `itemType` of string, number or boolean. Admitted kinds are `text`,
`number`, `set`, `boolean`, `range`, and `json`. See
[objective comparison semantics](evaluation.md#ay-i17-objective-comparisons-schema-2)
for the new expected value shapes and comparison rules. No extra fields, unknown
versions, URLs, executable expectations, or implicit conversion. The same
object/key/node/string limits apply to the record and the complete bundle;
a bundle may contain at most 64 records, the maximum number of criteria.

The full `ReferenceBundle` has exactly `schemaVersion: 2`, `definition`
(the assessment ID, revision and revision digest), and `references`. It
has no independent digest in this ticket: each record is independently
content-bound by the definition. `verifyReferenceBundle` checks definition
integrity before reading the bundle; validates the bounded bundle snapshot;
then checks lineage, record digest, declared digest, inferred kind, exact
unit presence/value and set item type. Missing records are permitted; unknown
or duplicate records are not. The success value is privileged and frozen.
Failures return value-free diagnostics with `invalid_reference` (or
`invalid_definition` if the definition is invalid).

```ts
import {
  createAssessmentDefinition,
  createReferenceRecord,
  verifyReferenceBundle,
} from "@0xbuff/assay";

const reference = createReferenceRecord({
  schemaVersion: 2,
  referenceId: "secret",
  kind: "text",
  value: "café\n",
});
if (!reference.ok) throw new Error("Invalid reference");
const definition = createAssessmentDefinition({
  schemaVersion: 2,
  assessmentId: "vector",
  revision: "rev1",
  policyVersion: "all-required-v1",
  criteria: [
    {
      id: "output",
      kind: "exact_text",
      mode: "required",
      visibility: "restricted",
      parameters: {
        expected: {
          type: "reference",
          referenceId: reference.value.referenceId,
          referenceDigest: reference.value.referenceDigest,
        },
      },
    },
  ],
});
if (!definition.ok) throw new Error("Invalid definition");
const verified = verifyReferenceBundle(definition.value, {
  schemaVersion: 2,
  definition: {
    assessmentId: definition.value.assessmentId,
    revision: definition.value.revision,
    revisionDigest: definition.value.revisionDigest,
  },
  references: [reference.value],
});
// verified is a privileged validation result, not a comparison or grade.
// If verified.ok, evaluate(definition.value, evidence, verified.value) compares
// caller-supplied observations against the content-bound reference.
```

### Schema-2 golden vectors

Canonical reference JSON (no trailing LF; the value contains an escaped LF):

```text
{"kind":"text","referenceId":"secret","schemaVersion":2,"value":"café\n"}
```

SHA-256 with the reference domain:

```text
sha256:b76df28194a4dc2b9afda31ff4dd8061e358f17bfd2a41c7ce5b7ad80046ecf5
```

Canonical definition JSON:

```text
{"assessmentId":"vector","criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"referenceDigest":"sha256:b76df28194a4dc2b9afda31ff4dd8061e358f17bfd2a41c7ce5b7ad80046ecf5","referenceId":"secret","type":"reference"}},"visibility":"restricted"}],"policyVersion":"all-required-v1","revision":"rev1","schemaVersion":2}
```

SHA-256 with the definition v2 domain:

```text
sha256:eb3dcfbc24c13e625e95f0d86b75da3f652805aed29c34c2bcc7cc42b0f5a321
```

Both hashes are independently pinned with Node crypto in the source tests.
Neither digest authenticates a publisher or hides low-entropy expected values.
Do not publish protected definitions, reference records or their digests.
AY-I14 permits evaluation using the verified schema-2 reference bundle as the
optional third argument to `evaluate`. Missing material remains unavailable;
invalid supplied records fail before comparison. No network lookup, new evidence
or execution fact schema is introduced.

Additional reference vectors (same domain and LF; no trailing LF):

| Canonical JSON                                                                             | SHA-256 digest                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `{"kind":"number","referenceId":"quantity","schemaVersion":2,"unit":"m","value":10}`       | `sha256:9d9dd9e71c2daf11f25122ef06f982ca2fc3f30a5b02e83f7a3460996e133076` |
| `{"itemType":"number","kind":"set","referenceId":"items","schemaVersion":2,"value":[1,2]}` | `sha256:1ea024bc6ce68a3e7e55a0b29f1a95dbb7f56228b3d736634fdde1a23165373a` |

## Canonical evidence digest v2 (AY-I15)

`createEvidenceBundle(definition, draft)` verifies the definition, accepts a
closed draft with exactly schemaVersion (2), observations, and optional
artifactDigest, derives definition lineage, validates the entire assembled
bundle and criterion coverage, and seals it. Caller-supplied definition or
evidenceDigest in the draft is rejected, not overwritten.
`verifyEvidenceBundle(definition, evidence)` checks the sealed bundle,
definition lineage and evidence digest. Evaluation and collection require
this verification; legacy schema-1 or unsigned evidence is rejected.
The existing definition profiles are unchanged.

The hash covers every validated bundle field except the top-level
evidenceDigest, including schemaVersion, definition lineage, optional artifact
scope, observations in authored order, and each observation's optional origin
and full provenance claim. Use the same UTF-16 sorted keys, JSON primitive
serialization and UTF-8 encoding as the definition profile, preceded by
`assay:evidence:v2` and a single LF, with no trailing LF. The digest is
lowercase `sha256:` followed by 64 hex digits. Mismatch returns
`invalid_evidence` with `EVIDENCE_DIGEST_MISMATCH` at `$.evidenceDigest`.

Canonical JSON for the schema-1 definition golden vector above and a
schema-2 artifact-scoped evidence bundle (the value contains an escaped LF):

```text
{"artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","definition":{"assessmentId":"vector","revision":"rev1","revisionDigest":"sha256:7be081910e17919c0b08bcff0543d80c7b8c540541b58bcb70630f5d561cfc2f"},"observations":[{"completeness":"complete","criterionId":"output","evidenceRef":"obs1","kind":"text","origin":{"artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"artifact","runRef":"run1","sourceRef":"fixture"},"value":"café\n"}],"schemaVersion":2}
```

Digest:

```text
sha256:cadd06a98401114bb8039949999c922cdc806c3998cc19f00735819f494e58bd
```

The pinned digest is independently checked with Node crypto in source tests.
Changing scope, values, completeness, origin, observation order or lineage
changes the content identity. A content digest is not a signature, a claim
of actual artifact bytes, or authorization to expose protected evidence.
Keep full evidence and its digests in privileged storage. A corrected
observation requires constructing a new bundle, never mutating the old one.

### AY-I16 policy migration

The policy identity is now `all-required-v1`. Historical drafts with arbitrary
labels such as `policy1` are rejected rather than interpreted as the supported
policy. Re-author and reseal explicitly to migrate; this produces different
content identities. The canonical byte profiles and hash domains are unchanged.
The vectors above use the newly authored policy, not rewritten historical bytes.
