import { ASSAY_SCHEMA_VERSION, CONTRACT_LIMITS } from "../contracts/common";
import type { ObservationPortReport } from "../contracts/observation";
import type { ValidationResult } from "../contracts/validation";
import { parseEvidenceBundle } from "./evidence";
import { definitionRef, digest, finish, identifier, object, revision } from "./shared";

/**
 * Parse a port's bounded facts and claimed provenance without trusting any
 * boolean marker, provider name or reported run identifier.
 *
 * The outer envelope is checked here; AY-I01's evidence parser checks every
 * returned typed observation and rejects unknown observation fields.
 */
export function parseObservationPortReport(
  input: unknown,
): ValidationResult<ObservationPortReport> {
  return finish(input, "invalid_evidence", (data, issues) => {
    if (
      !object(
        data,
        "$",
        ["schemaVersion", "definition", "artifactDigest", "provenance", "observations"],
        ["schemaVersion", "definition", "provenance", "observations"],
        issues,
      )
    )
      return;

    if (data.schemaVersion !== ASSAY_SCHEMA_VERSION)
      issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    definitionRef(data.definition, "$.definition", issues);
    if (Object.hasOwn(data, "artifactDigest"))
      digest(data.artifactDigest, "$.artifactDigest", issues);

    const provenance = data.provenance;
    if (
      object(
        provenance,
        "$.provenance",
        [
          "adapterId",
          "adapterVersion",
          "runRef",
          "toolchainId",
          "toolchainVersion",
          "capturedStdoutBytes",
          "capturedStderrBytes",
          "stdoutTruncated",
          "stderrTruncated",
        ],
        [
          "adapterId",
          "adapterVersion",
          "runRef",
          "toolchainId",
          "toolchainVersion",
          "capturedStdoutBytes",
          "capturedStderrBytes",
          "stdoutTruncated",
          "stderrTruncated",
        ],
        issues,
      )
    ) {
      identifier(provenance.adapterId, "$.provenance.adapterId", issues);
      revision(provenance.adapterVersion, "$.provenance.adapterVersion", issues);
      identifier(provenance.runRef, "$.provenance.runRef", issues);
      identifier(provenance.toolchainId, "$.provenance.toolchainId", issues);
      revision(provenance.toolchainVersion, "$.provenance.toolchainVersion", issues);

      const captured = [provenance.capturedStdoutBytes, provenance.capturedStderrBytes];
      for (const [index, n] of captured.entries()) {
        const field = index === 0 ? "capturedStdoutBytes" : "capturedStderrBytes";
        if (
          typeof n !== "number" ||
          !Number.isSafeInteger(n) ||
          n < 0 ||
          n > CONTRACT_LIMITS.maxCapturedBytes
        ) {
          issues.add(`$.provenance.${field}`, "INVALID_VALUE");
        }
      }
      if (
        captured.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) &&
        (captured[0] as number) + (captured[1] as number) > CONTRACT_LIMITS.maxCapturedBytes
      ) {
        issues.add("$.provenance", "INPUT_TOO_LARGE");
      }
      if (typeof provenance.stdoutTruncated !== "boolean")
        issues.add("$.provenance.stdoutTruncated", "INVALID_TYPE");
      if (typeof provenance.stderrTruncated !== "boolean")
        issues.add("$.provenance.stderrTruncated", "INVALID_TYPE");
    }

    // Copy the already snapped fields through the same bounded observation
    // contract as direct evidence, including duplicate-ID protection.
    const reportEvidence = parseEvidenceBundle({
      schemaVersion: data.schemaVersion,
      definition: data.definition,
      ...(Object.hasOwn(data, "artifactDigest") ? { artifactDigest: data.artifactDigest } : {}),
      observations: data.observations,
    });
    if (!reportEvidence.ok) {
      for (const diagnostic of reportEvidence.diagnostics) {
        issues.add(diagnostic.path, diagnostic.code);
      }
    }
  });
}
