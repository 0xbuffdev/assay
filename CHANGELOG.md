# Changelog

Notable changes to Assay are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/2.0.0/) and the package uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First intended release: 0.0.1. No version has been published yet.

### Added

- Deterministic evaluation of exact and normalized text, numbers with tolerances and ranges, sets, booleans and structured JSON. Numeric observations must match the declared unit.
- Explicit `all` and `any` composition over required criteria, with separate advisory findings.
- Schema-4 definition, reference and evidence sealing and verification with deterministic SHA-256 digests.
- Optional host-supplied collection of public observations, selected execution facts, bounded provenance claims and collection receipts.
- Artifact-bound advisory qualitative reviews with human or model attribution, uncertainty, feedback and citation ranges. Required manual evidence remains unresolved pending review.
- Public projection with allowlisted reasons and unconditional aggregate withholding for restricted criteria.
- Bounded JSON decoding, duplicate-key rejection, redacted validation diagnostics and separate invalid-input failures.
- Node.js 24+ ESM and TypeScript support with no runtime dependencies.

[Unreleased]: https://github.com/0xbuffdev/assay/tree/main
