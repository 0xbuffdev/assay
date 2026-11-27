# Changelog

## Unreleased

### Changed

- AY-I20: finite public reason mapping and stricter technical-result coherence checks before projection; restricted aggregates remain withheld and rejection stays opaque. Evaluator semantics and digest profiles unchanged.

- AY-I16: disjoint complete results and invalid-input failures, closed finding reason and warning codes, explicit `all-required-v1` policy admission, shared required aggregation and advisory warning checks. Evaluator semantics `v0.0.1`; canonical digest profiles and package version unchanged.

- AY-I12: evaluation and observation collection always verify definition content integrity before inspecting evidence or invoking a provider. Removed the redundant verified aliases; schema-1 canonical bytes, comparators and package version are unchanged.
- AY-I11: focused internal contracts, validation, comparison, aggregation, integrity, acquisition and projection modules with one aggregation owner and dependency checks.

### Added

- AY-I22: generated package/evaluator and canonical profile metadata with read-only build verification, independent version vectors and explicit Node 24+ ESM support. No digest, evaluator semantics, public export or package release change.

- AY-I21: explicit bounded serialized-record decoding with duplicate-key rejection, redacted diagnostics and documented transport/snapshot budgets. No canonical digest or evaluator semantics change.

- AY-I17: schema-2 boolean equality, finite numeric ranges and bounded structured JSON equality, including sealed references, evidence and public-only observation collection. Evaluator semantics `v0.0.2`; existing canonical hash profiles and package version unchanged.
- AY-I18: explicit selected schema-2 execution facts and run termination; relevant stream completeness, assertion-only non-authority and direct objective comparison. Evaluator semantics `v0.0.3`; no executor, provider request migration or release.

- AY-I15: schema-2 sealed evidence and technical result lineage; artifact-scoped origins, report provenance and scoped collection receipts; mandatory evidence verification and rejection of retroactive binding.
- AY-I14: optional verified schema-2 reference comparison, reusing objective comparators and preserving opaque public projection; invalid reference material returns a diagnostic failure envelope.
- AY-I07: learner-safe technical result projection that withholds restricted findings, all evidence references, reason codes and hidden aggregates, with strict definition/result coherence checks and uniform opaque rejection.
- AY-I06: versioned deterministic definition content hashes, unsigned draft sealing, integrity verification and explicitly guarded evaluator/observation-port paths; pure synchronous SHA-256 without runtime dependencies. Content hashes do not authenticate publishers.
- AY-I05: numeric observations carry an optional unit identifier; unit-bearing criteria reject absent or different observation units rather than silently comparing incompatible quantities.
- AY-I04: offline packed archive audit and isolated third-party ESM/TypeScript consumer acceptance; strict file/license/dependency checks, malicious-evidence fixture and release decision documentation. Verified Ubuntu/Windows package checks use npm's JavaScript CLI rather than a platform-specific shell shim. No package publication.
- AY-I03: optional provider-neutral observation collection, bounded provenance claims, public-only requests, strict report validation, capture-truncation handling and security/threat fixtures.
- AY-I02: deterministic exact/explicitly normalized text, finite tolerance and set-equivalence comparators; fail-closed required/advisory technical aggregation; replay and negative verification.
- AY-I01: strict versioned assessment/evidence/finding contracts; bounded immutable validation, deterministic value-free diagnostics, and required evidence-coverage inspection without pass/fail evaluation.
- Adopted Apache-2.0 for Assay source, with a copyright notice and updated package metadata.
- Initial standalone repository foundation with a deliberately empty public API.
- Node 24+, ESM and pnpm quality-only tests and CI.
- Architecture, security, development and contribution guidance.

No npm package has been published.
