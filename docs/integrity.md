# Definition, reference and evidence integrity

Assay verifies content identity, not authentication. The host must independently authorize the exact definition, reference values and evidence lineage. A caller can construct and hash their own data; no digest proves a publisher, execution provider, learner, correctness or official credit.

## Version contract

AY-I23 replaces the unreleased prior schemas, not their historical bytes. Every versioned public record uses schema generation **3**, including definitions, reference records and bundles, evidence, complete results, public projections, and observation port requests/reports. The sole binding policy is `composed-required-v1`. Evaluator semantics are `v0.0.4`; package version remains private `0.0.0` and the supported runtime is Node 24+ ESM. There is no runtime compatibility adapter, alias, automatic upgrade, or legacy policy path. Older records are explicitly rejected, not rehashed. Historical vectors remain in Git history.

`ASSAY_SCHEMA_VERSION` identifies the sole current generation. The generated version metadata is derived from the authored identities in the version generator and the manifest; the evaluator identity is separate from the package release. A future contract generation must select distinct canonical domains, update generated metadata and independently verify new vectors. Do not edit generated files or silently reinterpret old records.

## Canonical bytes

All three integrity domains use the same deterministic serialization after bounded, closed-contract validation:

- Use compact JSON with object keys sorted by ECMAScript UTF-16 code-unit order. Arrays retain their authored order (including criteria, groups, children and observations). Keys, strings, finite numbers, booleans and null use ECMAScript JSON serialization; -0 serializes as 0. No locale comparison, string normalization, trimming or implicit conversion.
- Include every validated authored field; omit only the record's own top-level digest. An absent optional field stays absent. Reject unknown keys, unsafe objects, unsupported schemas, nonfinite values and over-limit inputs before hashing.
- UTF-8 encode the ASCII domain followed by one LF, then the canonical JSON, with no additional trailing LF. Compute SHA-256 and return lowercase `sha256:` plus 64 hex digits.
- Definition domain: `assay:definition:v3`; reference domain: `assay:reference:v3`; evidence domain: `assay:evidence:v3`.

### Definition integrity

The unsigned draft has exactly schemaVersion, assessmentId, revision, policyVersion, criteria and composition. The sealed definition adds revisionDigest. The composition binds exact group membership, operator and authored order, even where reordering would not change its logical outcome. `computeDefinitionDigest` and `createAssessmentDefinition` validate unsigned drafts, rejecting a caller-supplied revisionDigest. `verifyAssessmentDefinition` recomputes and compares it. Evaluation, collection and projection verify the definition before inspecting other inputs. A changed body with an unchanged digest is invalid_definition; a parser's structural success alone is not integrity verification.

Canonical definition golden vector (one line, escaped LF in value):

```json
{"assessmentId":"vector","composition":{"groups":[{"children":[{"id":"output","kind":"criterion"}],"id":"fixture-root","operator":"all"}],"rootGroupId":"fixture-root"},"criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"type":"literal","value":"café\n"}},"visibility":"public"}],"policyVersion":"composed-required-v1","revision":"rev1","schemaVersion":3}
```

Digest: `sha256:dfa86e4d4bd5fd5b9d1753eebdaca7ce2cc61c3843e5417e297d31d71f806798`.

## Current-generation reference integrity

An objective reference expectation is exactly type, referenceId and referenceDigest, with type equal to reference. IDs must not repeat across objective expectations. `createReferenceRecord` accepts a draft with schemaVersion, referenceId, kind and value; number and range records may include unit, set records require itemType. The sealed record adds referenceDigest. Admitted value kinds are text, number, range, set, boolean and JSON. Restricted objective expectations cannot be literal. Assertion metadata remains non-authoritative and is not an objective reference expectation.

A ReferenceBundle contains exactly schemaVersion, definition (assessmentId, revision, revisionDigest) and references. No bundle digest is added: each record is individually sealed and declared in the definition. `verifyReferenceBundle` checks exact definition lineage, declared reference ID/digest, actual recomputed digest, kind, unit presence/value and set item type. Unknown, duplicate, malformed, wrong-kind, wrong-unit or substituted material is invalid_reference. Missing records are permitted and yield inconclusive comparison when needed. Supplied references are verified after the definition and before evidence. All reference material is privileged.

Canonical reference vector:

```json
{"kind":"text","referenceId":"secret","schemaVersion":3,"value":"café\n"}
```

Digest: `sha256:e28e007acf7ef464608360a68f53c40b2e949954d2dedff20448e68f52d0d18f`.

Canonical definition binding that reference:

```json
{"assessmentId":"vector","composition":{"groups":[{"children":[{"id":"output","kind":"criterion"}],"id":"fixture-root","operator":"all"}],"rootGroupId":"fixture-root"},"criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"referenceDigest":"sha256:e28e007acf7ef464608360a68f53c40b2e949954d2dedff20448e68f52d0d18f","referenceId":"secret","type":"reference"}},"visibility":"restricted"}],"policyVersion":"composed-required-v1","revision":"rev1","schemaVersion":3}
```

Digest: `sha256:b0b4ed130a1ed38d5b306a7c43f10a512fbe8f2905b110ea781c4f3bcc8fd6cf`.

| Canonical reference JSON | Digest |
| --- | --- |
| `{"kind":"number","referenceId":"quantity","schemaVersion":3,"unit":"m","value":10}` | `sha256:1e4890246c0eda1381302e0d56d458fc08d2883e806b411eec5572b24cd78a0b` |
| `{"itemType":"number","kind":"set","referenceId":"items","schemaVersion":3,"value":[1,2]}` | `sha256:eb8098fafa7f466e471989a3f2106d02b130766c3c27cee4692ba77b8ae587a8` |

## Current-generation evidence integrity

`createEvidenceBundle(definition, draft)` validates a draft with schemaVersion, observations and optional artifactDigest; it derives the definition identity, checks exact criterion coverage and origin scope, seals the entire validated bundle and returns immutable content. It rejects externally asserted definition/evidence digest fields in drafts. The evidence digest covers lineage, optional artifact binding, all observations and origin claims in authored order. `verifyEvidenceBundle` recomputes the digest and checks exact definition lineage and coverage. No overwrite or duplicate criterion/evidence reference is allowed; a correction creates a new bundle.

An artifact-scoped bundle requires explicitly scoped observations. Artifact origins bind the exact artifact digest, independent origins cannot claim one, and provenance is an inert source/run claim. Selected execution facts require run termination and relevant completeness; missing/truncated or interrupted evidence cannot establish a pass. Collection cannot retrofit artifact scope onto existing unbound observations or change their provenance. It reseals the combined current-generation bundle and returns a receipt binding its new digest and returned fact references. See [observation acquisition](observations.md).

Canonical evidence vector using the first definition vector:

```json
{"artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","definition":{"assessmentId":"vector","revision":"rev1","revisionDigest":"sha256:dfa86e4d4bd5fd5b9d1753eebdaca7ce2cc61c3843e5417e297d31d71f806798"},"observations":[{"completeness":"complete","criterionId":"output","evidenceRef":"obs1","kind":"text","origin":{"artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"artifact","runRef":"run1","sourceRef":"fixture"},"value":"café\n"}],"schemaVersion":3}
```

Digest: `sha256:06c8270cffe62153c69c77a9233044a7c97ceb5d8519142711f5f9dbddf9d301`.

The independent installed-package vectors also pin selected execution fact and termination bytes. Tests use Node crypto independently of Assay's portable synchronous SHA-256 implementation.

## Failure and disclosure boundaries

All public integrity operations enforce the current schema, closed shapes and record limits; the serialized decoder checks byte limits and duplicate keys before structural validation. Results bind the exact definition/evidence digests, optional artifact digest, policy and evaluator identity. They do not sign the evidence or themselves. Public projection checks the verified definition and complete result correspondence and independently recomputes the group aggregate using the shared owner; it does not receive the evidence and cannot authenticate it. Never expose a restricted reference or low-entropy digest as a secrecy mechanism. Keep full records privileged; errors contain value-free bounded diagnostics or an opaque public projection rejection. Host authorization, transport caps, execution isolation and record retention remain independent.

See [contracts](contracts.md), [evaluation](evaluation.md), and [public projection](projection.md) for operational behavior. No release is authorized by these profiles.
