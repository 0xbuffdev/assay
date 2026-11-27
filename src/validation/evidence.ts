import { CONTRACT_LIMITS } from "../contracts/common";
import type { EvidenceBundle, EvidenceBundleDraft } from "../contracts/evidence";
import type { ValidationResult } from "../contracts/validation";
import {
  choice,
  type Diagnostics,
  definitionRef,
  digest,
  finish,
  identifier,
  list,
  numberValue,
  object,
  revision,
  setItems,
  textValue,
  unique,
} from "./shared";

/** Validate complete evidence shape, not digest integrity or authenticity. */
export function parseEvidenceBundle(input: unknown): ValidationResult<EvidenceBundle> {
  return finish(input, "invalid_evidence", (data, issues) => {
    const required = ["schemaVersion", "definition", "evidenceDigest", "observations"];
    if (!object(data, "$", [...required, "artifactDigest"], required, issues)) return;
    if (data.schemaVersion !== 2) issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    definitionRef(data.definition, "$.definition", issues);
    digest(data.evidenceDigest, "$.evidenceDigest", issues);
    if (Object.hasOwn(data, "artifactDigest"))
      digest(data.artifactDigest, "$.artifactDigest", issues);
    validateObservations(data.observations, data.artifactDigest, issues);
  });
}

/** The draft cannot supply either definition lineage or a self digest. */
export function parseEvidenceBundleDraft(input: unknown): ValidationResult<EvidenceBundleDraft> {
  return finish(input, "invalid_evidence", (data, issues) => {
    const required = ["schemaVersion", "observations"];
    if (!object(data, "$", [...required, "artifactDigest"], required, issues)) return;
    if (data.schemaVersion !== 2) issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    if (Object.hasOwn(data, "artifactDigest"))
      digest(data.artifactDigest, "$.artifactDigest", issues);
    validateObservations(data.observations, data.artifactDigest, issues);
  });
}

/** Shared shape validation for direct evidence and scoped provider reports. */
export function validateObservations(
  observations: unknown,
  artifactDigest: unknown,
  issues: Diagnostics,
  report = false,
): void {
  if (!list(observations, "$.observations", issues, CONTRACT_LIMITS.maxObservations)) return;
  const ids: unknown[] = [];
  const refs: unknown[] = [];
  const runs = new Map<string, Record<string, unknown>>();
  for (const [i, obs] of observations.entries()) {
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
          "origin",
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
    if (report) {
      if (Object.hasOwn(obs, "origin")) issues.add(`${p}.origin`, "UNEXPECTED_FIELD");
    } else {
      validateOrigin(obs, artifactDigest, p, issues);
      const origin = obs.origin;
      if (origin && typeof origin === "object" && !Array.isArray(origin)) {
        const claim = origin as Record<string, unknown>;
        if (typeof claim.sourceRef === "string" && typeof claim.runRef === "string") {
          const key = JSON.stringify([claim.sourceRef, claim.runRef]);
          const prior = runs.get(key);
          if (
            prior &&
            (prior.kind !== claim.kind ||
              prior.artifactDigest !== claim.artifactDigest ||
              (prior.provenance !== undefined &&
                claim.provenance !== undefined &&
                JSON.stringify(prior.provenance) !== JSON.stringify(claim.provenance)))
          ) {
            issues.add(`${p}.origin`, "MISMATCHED_ORIGIN");
          }
          if (!prior || prior.provenance === undefined) runs.set(key, claim);
        }
      }
    }
    if (obs.kind === "text") {
      object(
        obs,
        p,
        ["criterionId", "evidenceRef", "completeness", "kind", "value", "origin"],
        ["criterionId", "evidenceRef", "completeness", "kind", "value"],
        issues,
      );
      textValue(obs.value, `${p}.value`, issues);
    } else if (obs.kind === "number") {
      object(
        obs,
        p,
        ["criterionId", "evidenceRef", "completeness", "kind", "value", "unit", "origin"],
        ["criterionId", "evidenceRef", "completeness", "kind", "value"],
        issues,
      );
      numberValue(obs.value, `${p}.value`, issues);
      if (Object.hasOwn(obs, "unit")) identifier(obs.unit, `${p}.unit`, issues);
    } else if (obs.kind === "set") {
      object(
        obs,
        p,
        ["criterionId", "evidenceRef", "completeness", "kind", "itemType", "items", "origin"],
        ["criterionId", "evidenceRef", "completeness", "kind", "itemType", "items"],
        issues,
      );
      choice(obs.itemType, ["string", "number", "boolean"], `${p}.itemType`, issues);
      setItems(obs.items, obs.itemType, `${p}.items`, issues);
    } else if (obs.kind === "execution") {
      object(
        obs,
        p,
        ["criterionId", "evidenceRef", "completeness", "kind", "runRef", "assertions", "origin"],
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
        ["criterionId", "evidenceRef", "completeness", "kind", "artifactRefs", "origin"],
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
}

function validateOrigin(
  observation: Record<string, unknown>,
  artifactDigest: unknown,
  path: string,
  issues: Diagnostics,
): void {
  const p = `${path}.origin`;
  if (!Object.hasOwn(observation, "origin")) {
    if (artifactDigest !== undefined) issues.add(p, "MISSING_FIELD");
    return;
  }
  const origin = observation.origin;
  const required = ["kind", "sourceRef"];
  if (!object(origin, p, [...required, "artifactDigest", "runRef", "provenance"], required, issues))
    return;
  identifier(origin.sourceRef, `${p}.sourceRef`, issues);
  choice(origin.kind, ["artifact", "independent"], `${p}.kind`, issues);
  if (origin.kind === "artifact") {
    digest(origin.artifactDigest, `${p}.artifactDigest`, issues);
    if (artifactDigest === undefined || origin.artifactDigest !== artifactDigest)
      issues.add(`${p}.artifactDigest`, "MISMATCHED_ORIGIN");
  } else if (Object.hasOwn(origin, "artifactDigest")) {
    issues.add(`${p}.artifactDigest`, "MISMATCHED_ORIGIN");
  }
  if (Object.hasOwn(origin, "runRef")) identifier(origin.runRef, `${p}.runRef`, issues);
  if (observation.kind === "execution" && origin.runRef !== observation.runRef)
    issues.add(`${p}.runRef`, "MISMATCHED_ORIGIN");
  if (Object.hasOwn(origin, "provenance")) {
    const provenance = origin.provenance;
    if (validateProvenance(provenance, `${p}.provenance`, issues)) {
      if (origin.sourceRef !== provenance.adapterId || origin.runRef !== provenance.runRef)
        issues.add(p, "MISMATCHED_ORIGIN");
      if (
        (provenance.stdoutTruncated === true || provenance.stderrTruncated === true) &&
        observation.completeness !== "truncated"
      )
        issues.add(`${path}.completeness`, "MISMATCHED_ORIGIN");
    }
  }
}

/** Same capture and provenance bounds for receipts and embedded origin claims. */
export function validateProvenance(
  provenance: unknown,
  path: string,
  issues: Diagnostics,
): provenance is Record<string, unknown> {
  const fields = [
    "adapterId",
    "adapterVersion",
    "runRef",
    "toolchainId",
    "toolchainVersion",
    "capturedStdoutBytes",
    "capturedStderrBytes",
    "stdoutTruncated",
    "stderrTruncated",
  ];
  if (!object(provenance, path, fields, fields, issues)) return false;
  identifier(provenance.adapterId, `${path}.adapterId`, issues);
  revision(provenance.adapterVersion, `${path}.adapterVersion`, issues);
  identifier(provenance.runRef, `${path}.runRef`, issues);
  identifier(provenance.toolchainId, `${path}.toolchainId`, issues);
  revision(provenance.toolchainVersion, `${path}.toolchainVersion`, issues);
  const captured = [provenance.capturedStdoutBytes, provenance.capturedStderrBytes];
  for (const [index, n] of captured.entries()) {
    const field = index === 0 ? "capturedStdoutBytes" : "capturedStderrBytes";
    if (
      typeof n !== "number" ||
      !Number.isSafeInteger(n) ||
      n < 0 ||
      n > CONTRACT_LIMITS.maxCapturedBytes
    )
      issues.add(`${path}.${field}`, "INVALID_VALUE");
  }
  if (
    captured.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) &&
    (captured[0] as number) + (captured[1] as number) > CONTRACT_LIMITS.maxCapturedBytes
  )
    issues.add(path, "INPUT_TOO_LARGE");
  if (typeof provenance.stdoutTruncated !== "boolean")
    issues.add(`${path}.stdoutTruncated`, "INVALID_TYPE");
  if (typeof provenance.stderrTruncated !== "boolean")
    issues.add(`${path}.stderrTruncated`, "INVALID_TYPE");
  return true;
}
