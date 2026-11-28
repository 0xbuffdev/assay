# Definition, reference and evidence integrity

Assay verifies content identity, not authentication. The host must independently authorize the exact definition, reference values and evidence lineage. A caller can construct and hash their own data; no digest proves a publisher, execution provider, learner, correctness or official credit.

## Version contract

Every versioned public record uses schema generation **4**, including definitions, reference records and bundles, evidence, complete results, public projections, and observation port requests/reports. The sole binding policy is `composed-required-v1`. Evaluator semantics are `v0.0.5`; the first intended package version is `0.0.1`, and the supported runtime is Node 24+ ESM. There is no runtime compatibility adapter, alias, automatic upgrade, or legacy policy path. Older records are explicitly rejected, not rehashed. Historical vectors remain in Git history.

`ASSAY_SCHEMA_VERSION` identifies the sole current generation. The generated version metadata is derived from the authored identities in the version generator and the manifest; the evaluator identity is separate from the package release. A future contract generation must select distinct canonical domains, update generated metadata and independently verify new vectors. Do not edit generated files or silently reinterpret old records.

## Canonical bytes

All three integrity domains use the same deterministic serialization after bounded, closed-contract validation:

- Use compact JSON with object keys sorted by ECMAScript UTF-16 code-unit order. Arrays retain their authored order (including criteria, groups, children and observations). Keys, strings, finite numbers, booleans and null use ECMAScript JSON serialization; -0 serializes as 0. No locale comparison, string normalization, trimming or implicit conversion.
- Include every validated authored field; omit only the record's own top-level digest. An absent optional field stays absent. Reject unknown keys, unsafe objects, unsupported schemas, nonfinite values and over-limit inputs before hashing.
- UTF-8 encode the ASCII domain followed by one LF, then the canonical JSON, with no additional trailing LF. Compute SHA-256 and return lowercase `sha256:` plus 64 hex digits.
- Definition domain: `assay:definition:v4`; reference domain: `assay:reference:v4`; evidence domain: `assay:evidence:v4`.

### Definition integrity

The unsigned draft has exactly schemaVersion, assessmentId, revision, policyVersion, criteria and composition. The sealed definition adds revisionDigest. The composition binds exact group membership, operator and authored order, even where reordering would not change its logical outcome. `computeDefinitionDigest` and `createAssessmentDefinition` validate unsigned drafts, rejecting a caller-supplied revisionDigest. `verifyAssessmentDefinition` recomputes and compares it. Evaluation, collection and projection verify the definition before inspecting other inputs. A changed body with an unchanged digest is invalid_definition; a parser's structural success alone is not integrity verification.

Canonical definition golden vector (one line, escaped LF in value):

```text
{"assessmentId":"vector","composition":{"groups":[{"children":[{"id":"output","kind":"criterion"}],"id":"fixture-root","operator":"all"}],"rootGroupId":"fixture-root"},"criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"type":"literal","value":"café\n"}},"visibility":"public"}],"policyVersion":"composed-required-v1","revision":"rev1","schemaVersion":4}
```

Digest: `sha256:db53afe46dc26651f77a64613a6d059fdeefff1caeb0947c92c567db478f13a2`.

## Current-generation reference integrity

An objective reference expectation is exactly type, referenceId and referenceDigest, with type equal to reference. IDs must not repeat across objective expectations. `createReferenceRecord` accepts a draft with schemaVersion, referenceId, kind and value; number and range records may include unit, set records require itemType. The sealed record adds referenceDigest. Admitted value kinds are text, number, range, set, boolean and JSON. Restricted objective expectations cannot be literal. Assertion metadata remains non-authoritative and is not an objective reference expectation.

A ReferenceBundle contains exactly schemaVersion, definition (assessmentId, revision, revisionDigest) and references. No bundle digest is added: each record is individually sealed and declared in the definition. `verifyReferenceBundle` checks exact definition lineage, declared reference ID/digest, actual recomputed digest, kind, unit presence/value and set item type. Unknown, duplicate, malformed, wrong-kind, wrong-unit or substituted material is invalid_reference. Missing records are permitted and yield inconclusive comparison when needed. Supplied references are verified after the definition and before evidence. All reference material is privileged.

Canonical reference vector:

```text
{"kind":"text","referenceId":"secret","schemaVersion":4,"value":"café\n"}
```

Digest: `sha256:27702532f918730d005384ff402dd3a5eb3f7d6f442479a03580b4c4da01709c`.

Canonical definition binding that reference:

```text
{"assessmentId":"vector","composition":{"groups":[{"children":[{"id":"output","kind":"criterion"}],"id":"fixture-root","operator":"all"}],"rootGroupId":"fixture-root"},"criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"referenceDigest":"sha256:27702532f918730d005384ff402dd3a5eb3f7d6f442479a03580b4c4da01709c","referenceId":"secret","type":"reference"}},"visibility":"restricted"}],"policyVersion":"composed-required-v1","revision":"rev1","schemaVersion":4}
```

Digest: `sha256:0bb2de4fa1b1dfaec607807cf533016071643258cd7784f3f0bc14a0f62a910f`.

| Canonical reference JSON                                                                   | Digest                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `{"kind":"number","referenceId":"quantity","schemaVersion":4,"unit":"m","value":10}`       | `sha256:dc3ca7a792de9a5703e72ff6409caa17aa3a16ec8b93e8a7468d25785060386b` |
| `{"itemType":"number","kind":"set","referenceId":"items","schemaVersion":4,"value":[1,2]}` | `sha256:51de8ae6a5a8cb3171785783da7d4c45725dc3300175f97b427247470f84bf4c` |

## Current-generation evidence integrity

`createEvidenceBundle(definition, draft)` validates a draft with schemaVersion, observations and optional artifactDigest; it derives the definition identity, checks exact criterion coverage and origin scope, seals the entire validated bundle and returns immutable content. It rejects externally asserted definition/evidence digest fields in drafts. The evidence digest covers lineage, optional artifact binding, all observations and origin claims in authored order. `verifyEvidenceBundle` recomputes the digest and checks exact definition lineage and coverage. No overwrite or duplicate criterion/evidence reference is allowed; a correction creates a new bundle.

An artifact-scoped bundle requires explicitly scoped observations. Artifact origins bind the exact artifact digest, independent origins cannot claim one, and provenance is an inert source/run claim. Selected execution facts require run termination and relevant completeness; missing/truncated or interrupted evidence cannot establish a pass. Collection cannot retrofit artifact scope onto existing unbound observations or change their provenance. It reseals the combined current-generation bundle and returns a receipt binding its new digest and returned fact references. See [observation acquisition](observations.md).

Canonical evidence vector using the first definition vector:

```text
{"artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","definition":{"assessmentId":"vector","revision":"rev1","revisionDigest":"sha256:db53afe46dc26651f77a64613a6d059fdeefff1caeb0947c92c567db478f13a2"},"observations":[{"completeness":"complete","criterionId":"output","evidenceRef":"obs1","kind":"text","origin":{"artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"artifact","runRef":"run1","sourceRef":"fixture"},"value":"café\n"}],"schemaVersion":4}
```

Digest: `sha256:508c376f6f33fc3b9ae6c34d362d26ea208b4d96578a8c7524d0f7d7daedc2f0`.

The independent installed-package vectors also pin selected execution fact and termination bytes. Tests use Node crypto independently of Assay's portable synchronous SHA-256 implementation.

Qualitative review policy, attribution, artifact scope, uncertainty, feedback and all authored citation triples are covered by the same generation-4 canonical definition/evidence domains. Citation order is content identity; neither digest nor claimed reviewer establishes authentication or citation correctness.

## Failure and disclosure boundaries

All public integrity operations enforce the current schema, closed shapes and record limits; the serialized decoder checks byte limits and duplicate keys before structural validation. Results bind the exact definition/evidence digests, optional artifact digest, policy and evaluator identity. They do not sign the evidence or themselves. Public projection checks the verified definition and complete result correspondence and independently recomputes the group aggregate using the shared owner; it does not receive the evidence and cannot authenticate it. Never expose a restricted reference or low-entropy digest as a secrecy mechanism. Keep full records privileged; errors contain value-free bounded diagnostics or an opaque public projection rejection. Host authorization, transport caps, execution isolation and record retention remain independent.

See [contracts](contracts.md), [evaluation](evaluation.md), and [public projection](projection.md) for operational behavior. No release is authorized by these profiles.
