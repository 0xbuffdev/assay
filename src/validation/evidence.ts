import { CONTRACT_LIMITS, EXECUTION_FACT_KINDS } from "../contracts/common";
import type { EvidenceBundle, EvidenceBundleDraft } from "../contracts/evidence";
import type { ValidationResult } from "../contracts/validation";
import {
  booleanValue,
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
  const runs = new Map<
    string,
    {
      claim: Record<string, unknown>;
      stdoutTruncated: boolean;
      stderrTruncated: boolean;
      termination: unknown;
      completePaths: { path: string; fact: unknown; termination: unknown }[];
    }
  >();
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
          "executionFact",
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
    if (Object.hasOwn(obs, "executionFact")) {
      if (report) issues.add(`${p}.executionFact`, "UNEXPECTED_FIELD");
      const selector = obs.executionFact;
      if (
        typeof selector !== "string" ||
        !Object.hasOwn(EXECUTION_FACT_KINDS, selector) ||
        EXECUTION_FACT_KINDS[selector as keyof typeof EXECUTION_FACT_KINDS] !== obs.kind
      ) {
        issues.add(`${p}.executionFact`, "INVALID_VALUE");
      }
      if (
        selector === "exit_status" &&
        (typeof obs.value !== "number" ||
          !Number.isSafeInteger(obs.value) ||
          Object.hasOwn(obs, "unit"))
      ) {
        issues.add(`${p}.value`, "INVALID_VALUE");
      }
    }
    if (report) {
      if (Object.hasOwn(obs, "origin")) issues.add(`${p}.origin`, "UNEXPECTED_FIELD");
    } else {
      const capture = validateOrigin(obs, artifactDigest, p, issues);
      const origin = obs.origin;
      if (origin && typeof origin === "object" && !Array.isArray(origin)) {
        const claim = origin as Record<string, unknown>;
        if (typeof claim.sourceRef === "string" && typeof claim.runRef === "string") {
          const key = JSON.stringify([claim.sourceRef, claim.runRef]);
          const run = runs.get(key);
          const prior = run?.claim;
          const completePath = {
            path: `${p}.completeness`,
            fact: obs.executionFact,
            termination: claim.termination,
          };
          if (
            run?.termination !== undefined &&
            claim.termination !== undefined &&
            run.termination !== claim.termination
          ) {
            issues.add(`${p}.origin.termination`, "MISMATCHED_ORIGIN");
          }
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
          if (run) {
            if (prior?.provenance === undefined) run.claim = claim;
            run.stdoutTruncated ||= capture.stdoutTruncated;
            run.stderrTruncated ||= capture.stderrTruncated;
            if (run.termination === undefined) run.termination = claim.termination;
            if (obs.completeness === "complete") run.completePaths.push(completePath);
          } else {
            runs.set(key, {
              claim,
              ...capture,
              termination: claim.termination,
              completePaths: obs.completeness === "complete" ? [completePath] : [],
            });
          }
        }
      }
    }
    if (obs.kind === "text") {
      object(
        obs,
        p,
        [
          "criterionId",
          "evidenceRef",
          "completeness",
          "kind",
          "value",
          "origin",
          "executionFact",
        ],
        ["criterionId", "evidenceRef", "completeness", "kind", "value"],
        issues,
      );
      textValue(obs.value, `${p}.value`, issues);
    } else if (obs.kind === "boolean" || obs.kind === "json") {
      object(
        obs,
        p,
        [
          "criterionId",
          "evidenceRef",
          "completeness",
          "kind",
          "value",
          "origin",
          "executionFact",
        ],
        ["criterionId", "evidenceRef", "completeness", "kind", "value"],
        issues,
      );
      if (obs.kind === "boolean") booleanValue(obs.value, `${p}.value`, issues);
    } else if (obs.kind === "number") {
      object(
        obs,
        p,
        [
          "criterionId",
          "evidenceRef",
          "completeness",
          "kind",
          "value",
          "unit",
          "origin",
          "executionFact",
        ],
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
  // Consult the whole run, including observations that omit capture provenance.
  // Unknown stream attribution remains conservative. Exit status is not a stream.
  for (const run of runs.values()) {
    for (const { path, fact, termination } of run.completePaths) {
      const truncated =
        fact === "exit_status"
          ? false
          : fact === "stdout" || fact === "structured_stdout"
            ? run.stdoutTruncated
            : fact === "stderr" || fact === "structured_stderr"
              ? run.stderrTruncated
              : run.stdoutTruncated || run.stderrTruncated;
      if (
        truncated ||
        (run.termination !== undefined &&
          run.termination !== "exited" &&
          termination === undefined)
      ) {
        issues.add(path, "MISMATCHED_ORIGIN");
      }
    }
  }
  unique(ids, "$.observations", issues);
  unique(refs, "$.observations", issues);
}

function validateOrigin(
  observation: Record<string, unknown>,
  artifactDigest: unknown,
  path: string,
  issues: Diagnostics,
): { stdoutTruncated: boolean; stderrTruncated: boolean } {
  const p = `${path}.origin`;
  const selected = Object.hasOwn(observation, "executionFact");
  const noCapture = { stdoutTruncated: false, stderrTruncated: false };
  if (!Object.hasOwn(observation, "origin")) {
    if (artifactDigest !== undefined || selected) issues.add(p, "MISSING_FIELD");
    return noCapture;
  }
  const origin = observation.origin;
  const required = ["kind", "sourceRef"];
  if (
    !object(
      origin,
      p,
      [...required, "artifactDigest", "runRef", "provenance", "termination"],
      required,
      issues,
    )
  )
    return noCapture;
  identifier(origin.sourceRef, `${p}.sourceRef`, issues);
  choice(origin.kind, ["artifact", "independent"], `${p}.kind`, issues);
  if (origin.kind === "artifact") {
    digest(origin.artifactDigest, `${p}.artifactDigest`, issues);
    if (artifactDigest === undefined || origin.artifactDigest !== artifactDigest)
      issues.add(`${p}.artifactDigest`, "MISMATCHED_ORIGIN");
  } else if (Object.hasOwn(origin, "artifactDigest")) {
    issues.add(`${p}.artifactDigest`, "MISMATCHED_ORIGIN");
  }
  if (selected || Object.hasOwn(origin, "termination") || Object.hasOwn(origin, "runRef"))
    identifier(origin.runRef, `${p}.runRef`, issues);
  if (selected || Object.hasOwn(origin, "termination"))
    choice(origin.termination, ["exited", "timeout", "crash"], `${p}.termination`, issues);
  if (observation.kind === "execution" && origin.runRef !== observation.runRef)
    issues.add(`${p}.runRef`, "MISMATCHED_ORIGIN");
  if (Object.hasOwn(origin, "provenance")) {
    const provenance = origin.provenance;
    if (validateProvenance(provenance, `${p}.provenance`, issues)) {
      if (origin.sourceRef !== provenance.adapterId || origin.runRef !== provenance.runRef)
        issues.add(p, "MISMATCHED_ORIGIN");
      return {
        stdoutTruncated: provenance.stdoutTruncated === true,
        stderrTruncated: provenance.stderrTruncated === true,
      };
    }
  }
  return noCapture;
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
