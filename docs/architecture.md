# Assay architecture

Assay is a **technical comparison engine**, not an executor, an AI judge or an academic records system. AY-I01 validates typed definitions, observations and findings; AY-I02 implements deterministic literal comparisons and fail-closed required aggregation; AY-I03 adds optional injected observation acquisition with bounded claimed provenance, not an embedded executor or trusted runner. See [Specification 0001](https://github.com/0xbuffdev/context/blob/main/repos/assay/specs/0001-evaluation-core.md) for the accepted requirements.

```text
Caller-authorized versioned criteria + typed bounded observations
                              |
                       strict validation
                              |
                   deterministic comparators
                              |
                required/advisory aggregation
                              |
                 versioned technical findings
                              |
            consumer-owned interpretation/decision
```

The pure library must work in a clean environment without OEE, 0xNAND, AI, a runtime executor or private package. An optional host may supply observed execution results, but Assay cannot claim those results were authentically obtained. A technical `pass` never means officially credited.

The target findings distinguish `pass`, `fail`, `inconclusive`, `invalid_definition`, `invalid_evidence` and `evaluation_error`. Required criteria cannot be empty. Missing or incomplete evidence cannot silently pass; comparator failure is not learner deficiency.

The source exposes versioned parsing/coverage from [contracts](contracts.md), pure `evaluate` from [evaluation](evaluation.md), and an optional async [observation port](observations.md). It does **not** authenticate evidence or issue academic credit; unresolved references and unverified execution never pass.

## Implementation boundaries

- **AY-I01:** implemented versioned definition/evidence contracts, bounded validation and structured diagnostics.
- **AY-I02:** implemented exact/normalized text, finite numeric tolerance, set comparators and deterministic required/advisory aggregation.
- **AY-I03:** implemented optional injected bounded observation facts, claimed run/artifact/definition provenance and fail-closed protected-reference redaction. Host authentication remains outside the library.
- **AY-I04:** distribution audit, independent consumer/security proof and separately authorized release.

No compatibility promise, execution engine or private host API is created by this foundation.
