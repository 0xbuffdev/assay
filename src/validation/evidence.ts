import { ASSAY_SCHEMA_VERSION, CONTRACT_LIMITS } from "../contracts/common";
import type { EvidenceBundle } from "../contracts/evidence";
import type { ValidationResult } from "../contracts/validation";
import {
  choice,
  definitionRef,
  digest,
  finish,
  identifier,
  list,
  numberValue,
  object,
  setItems,
  textValue,
  unique,
} from "./shared";

/**
 * Validate evidence shape, never its authenticity or correctness.
 *
 * Zero/missing observations and truncated observations remain *valid evidence
 * structures*, so AY-I02 can report a technical "inconclusive" instead of
 * misrepresenting an absent answer as a malformed submission.
 */
export function parseEvidenceBundle(input: unknown): ValidationResult<EvidenceBundle> {
  return finish(input, "invalid_evidence", (data, issues) => {
    if (
      !object(
        data,
        "$",
        ["schemaVersion", "definition", "artifactDigest", "observations"],
        ["schemaVersion", "definition", "observations"],
        issues,
      )
    )
      return;
    if (data.schemaVersion !== ASSAY_SCHEMA_VERSION)
      issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    definitionRef(data.definition, "$.definition", issues);
    if (Object.hasOwn(data, "artifactDigest"))
      digest(data.artifactDigest, "$.artifactDigest", issues);
    if (!list(data.observations, "$.observations", issues, CONTRACT_LIMITS.maxObservations)) return;
    const ids: unknown[] = [];
    const refs: unknown[] = [];
    for (const [i, obs] of data.observations.entries()) {
      const p = `$.observations[${i}]`;
      if (
        !object(
          obs,
          p,
          [
            "criterionId",
            "evidenceRef",
            "completeness",
            "kind",
            "value",
            "unit",
            "itemType",
            "items",
            "runRef",
            "assertions",
            "artifactRefs",
          ],
          ["criterionId", "evidenceRef", "completeness", "kind"],
          issues,
        )
      )
        continue;
      identifier(obs.criterionId, `${p}.criterionId`, issues);
      identifier(obs.evidenceRef, `${p}.evidenceRef`, issues);
      choice(obs.completeness, ["complete", "truncated"], `${p}.completeness`, issues);
      ids.push(obs.criterionId);
      refs.push(obs.evidenceRef);
      if (obs.kind === "text") {
        object(
          obs,
          p,
          ["criterionId", "evidenceRef", "completeness", "kind", "value"],
          ["criterionId", "evidenceRef", "completeness", "kind", "value"],
          issues,
        );
        textValue(obs.value, `${p}.value`, issues);
      } else if (obs.kind === "number") {
        object(
          obs,
          p,
          ["criterionId", "evidenceRef", "completeness", "kind", "value", "unit"],
          ["criterionId", "evidenceRef", "completeness", "kind", "value"],
          issues,
        );
        numberValue(obs.value, `${p}.value`, issues);
        if (Object.hasOwn(obs, "unit")) identifier(obs.unit, `${p}.unit`, issues);
      } else if (obs.kind === "set") {
        object(
          obs,
          p,
          ["criterionId", "evidenceRef", "completeness", "kind", "itemType", "items"],
          ["criterionId", "evidenceRef", "completeness", "kind", "itemType", "items"],
          issues,
        );
        choice(obs.itemType, ["string", "number", "boolean"], `${p}.itemType`, issues);
        setItems(obs.items, obs.itemType, `${p}.items`, issues);
      } else if (obs.kind === "execution") {
        object(
          obs,
          p,
          ["criterionId", "evidenceRef", "completeness", "kind", "runRef", "assertions"],
          ["criterionId", "evidenceRef", "completeness", "kind", "runRef", "assertions"],
          issues,
        );
        identifier(obs.runRef, `${p}.runRef`, issues);
        if (!list(obs.assertions, `${p}.assertions`, issues)) continue;
        const assertionIds: unknown[] = [];
        for (const [j, assertion] of obs.assertions.entries()) {
          const ap = `${p}.assertions[${j}]`;
          if (!object(assertion, ap, ["assertionId", "state"], ["assertionId", "state"], issues))
            continue;
          identifier(assertion.assertionId, `${ap}.assertionId`, issues);
          choice(assertion.state, ["confirmed", "refuted", "unknown"], `${ap}.state`, issues);
          assertionIds.push(assertion.assertionId);
        }
        unique(assertionIds, `${p}.assertions`, issues);
      } else if (obs.kind === "manual") {
        object(
          obs,
          p,
          ["criterionId", "evidenceRef", "completeness", "kind", "artifactRefs"],
          ["criterionId", "evidenceRef", "completeness", "kind", "artifactRefs"],
          issues,
        );
        if (!list(obs.artifactRefs, `${p}.artifactRefs`, issues, CONTRACT_LIMITS.maxEvidenceRefs))
          continue;
        for (const [j, id] of obs.artifactRefs.entries())
          identifier(id, `${p}.artifactRefs[${j}]`, issues);
        unique(obs.artifactRefs, `${p}.artifactRefs`, issues);
      } else issues.add(`${p}.kind`, "INVALID_VALUE");
    }
    unique(ids, "$.observations", issues);
    unique(refs, "$.observations", issues);
  });
}
