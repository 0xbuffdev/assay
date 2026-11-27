# Optional observation ports and provenance (AY-I03)

Assay can evaluate caller-supplied local evidence without a runner. **An
execution provider is optional**. AY-I03 adds `collectObservations` for hosts
that choose to inject their own observation port, plus
`parseObservationPortReport` for closed validation of the returned facts.

The port does **not** authenticate a runner, safely sandbox untrusted code,
resolve restricted references, sign results, grant credit, or become an
external service dependency. A caller-supplied adapter ID, run reference or
claimed successful assertion cannot establish trust. Applications with
formal grading requirements **must independently authenticate** the
definition publisher, artifact, provider execution, review authority and
result provenance behind an appropriate privilege boundary.

## Collection pipeline

```text
Caller-authorized definition + existing typed evidence
      |
      +-- Verify definition and evidence digests and lineage
      |
      +-- Select only missing PUBLIC objective/execution criteria
      |   (no expected value or reference ID; no restricted criteria)
      |
      +-- No candidates? Return validated evidence; port not called
      |
      +-- Invoke host-injected port with a frozen bounded request
      |
      +-- Validate untrusted response (closed schema + provenance)
      |
      +-- Check definition/artifact/run references and allowed criteria
      |
      +-- Downgrade captured observations to truncated if output is cut
      |
      +-- Seal combined evidence and return a scoped claimed provenance receipt
      |
      +-- Consumer may call pure evaluate(definition, evidence)
```

The engine never executes a program itself. It does not compile or run
source code, invoke a command or call a network endpoint.

## Using a mock port

```ts
import {
  collectObservations,
  createAssessmentDefinition,
  createEvidenceBundle,
  evaluate,
} from "@0xbuff/assay";

const created = createAssessmentDefinition({
  schemaVersion: 1,
  assessmentId: "public-demo",
  revision: "rev1",
  policyVersion: "all-required-v1",
  criteria: [
    {
      id: "stdout",
      kind: "exact_text",
      mode: "required",
      visibility: "public",
      parameters: { expected: { type: "literal", value: "ok" } },
    },
  ],
});
if (!created.ok) throw new Error("Invalid authored definition");
const definition = created.value;

const prepared = createEvidenceBundle(definition, {
  schemaVersion: 2,
  observations: [],
});
if (!prepared.ok) throw new Error("Invalid evidence");
const startingEvidence = prepared.value;

const mockPort = {
  async observe(request) {
    // request lists only public IDs, expected fact kinds and resource limits.
    return {
      schemaVersion: 2,
      definition: request.definition,
      provenance: {
        adapterId: "fixture",
        adapterVersion: "v1",
        runRef: "local-run",
        toolchainId: "node",
        toolchainVersion: "v24",
        capturedStdoutBytes: 2,
        capturedStderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
      observations: [
        {
          criterionId: "stdout",
          evidenceRef: "stdout1",
          kind: "text",
          completeness: "complete",
          value: "ok",
        },
      ],
    };
  },
};

const collected = await collectObservations(definition, startingEvidence, mockPort);

if (collected.ok) {
  const result = evaluate(definition, collected.evidence);
  // result.outcome === "pass" for a LOCAL caller-authorized literal rubric.
  // This is not authenticated execution, academic credit or a credential.
  // collected.receipt records claimed run/adapter/toolchain facts only.
}
```

No actual executor is installed or published. The mock is deliberately
ungraded. Definition content integrity is verified before any evidence is read
or provider called. A definition digest is not a signature, verified artifact
hash or proof of publisher identity.

## Contracts and limits

`ObservationPort<S>.observe(request: ObservationPortRequest, signal?: S): Promise<unknown>`
is supplied **only** by the host. Its request is immutable and includes:

- `schemaVersion: 2`, `definition` ID/revision/digest, optional caller
  `artifactDigest`, and `limits.maxCapturedBytes: 65536`.
- A list of **missing public** criterion IDs and expected observation kinds
  (`text`, `number`, `set`, `boolean`, `json`, or `execution`). Public numeric criteria
  may include a declared **unit identifier** so the provider can report the
  matching measurement unit without receiving the expected numeric value.
  Set criteria include `itemType`; selected execution criteria include `executionFact`
  with its matching observation kind (exit status is unitless).
  Public execution criteria may include **assertion IDs** but never private
  assertion reference IDs.
- No expected literals, reference outputs, hidden criteria, secret test
  sources, script bodies, command strings, accounts, credentials, or
  runner-specific configuration.

The port's response must be a closed, versioned
`ObservationPortReport` with the same definition reference, optional
artifact digest, typed observations and bounded `provenance`. The provenance
records `adapterId`, `adapterVersion`, `runRef`, `toolchainId`,
`toolchainVersion`, `capturedStdoutBytes`, `capturedStderrBytes`,
`stdoutTruncated` and `stderrTruncated`. The captured byte counts must
be safe nonnegative integers whose **combined total does not exceed
65,536**; truncation flags are required booleans. The data format does
not encode or validate output-origin authenticity.

`parseObservationPortReport` uses the same bounded object snapshot as the
existing evidence validator. Unknown fields, symbols, custom prototypes,
functions, getter properties, cycles, duplicate observation IDs, bad
numerical counts, unbounded data or `trusted`/grade flags are rejected.
The collector also rejects unknown or restricted criterion IDs, wrong
observation kinds, duplicate existing evidence refs, wrong execution run
references, unlisted assertions, mismatched definition lineage, or
conflicting artifact digests. A provider cannot add an artifact digest to an
already populated unscoped bundle. An empty unscoped bundle may acquire the
explicit artifact scope of the report. A scoped bundle requires exact report
scope. Reports use one envelope origin; observation-level `origin` fields in
reports are rejected rather than silently replaced.

The collector attaches the report scope and complete bounded provenance only
to newly returned facts. Existing observations keep their own origin and
completeness. If the report reveals truncation of a run also claimed by an
existing complete observation, the shared evidence validator rejects the
combined bundle rather than mutating or relabeling earlier evidence. Omitting
provenance on the existing fact does not avoid this check. Selected stdout/stderr and structured stream facts are downgraded only for their relevant stream; exit status is not stream-derived. Unknown stream attribution remains conservative: either truncation flag downgrades the returned observation. An incomplete stdout
capture cannot satisfy an exact-text required criterion. An empty report
is legal but cannot satisfy missing required evidence.

## Results and failure handling

`collectObservations` resolves to a discriminated
`ObservationCollectionResult`:

- `{ ok: true, evidence, receipt }`: validated, frozen combined evidence
  and an immutable **claimed** run receipt. `receipt: null` means there
  were no public eligible missing criteria, so no port call occurred.
- `{ ok: false, outcome: "invalid_definition" | "invalid_evidence",
  diagnostics }`: invalid caller input, port response or inconsistent
  observation. Codes and safe schema paths contain no raw values.
- `{ ok: false, outcome: "evaluation_error", reasonCode:
  "OBSERVATION_PORT_ERROR" }`: provider threw or failed. No exception
  message, stack, stdout/stderr text or private reference is returned.
- `{ ok: false, outcome: "evaluation_error", reasonCode: "OBSERVATION_CANCELLED" }`:
  the host signal aborted before invocation or during acquisition. No report is merged.

The receipt includes the new `evidenceDigest` and ordered `evidenceRefs` of
only the newly returned observations, not previously supplied facts. The
sealed evidence binds these observations and their provenance claims. The
receipt is **not** embedded into the pure `EvaluationResult` as a trust
marker. `evaluate` continues to return `EXECUTION_UNVERIFIED` for
self-reported execution assertion states, even if the report came through
an injected port. Hosts can separately verify run provenance and manage
formal decisions. An objective `exact_text` criterion may still produce
a **technical** pass on complete values from a mock or provider; this never
implies official assessment credit.

## Threat boundaries

- **No protected inputs to ports.** Restricted criteria are not requested.
  Expected literals and reference IDs are not included in the request,
  even for public criteria. Hidden test source must remain outside an
  environment accessible to untrusted programs and outside prompts/logging.
- **No magic trust flags.** `trusted: true`, `isVerified`, arbitrary scores
  and fake pass statuses are not contract fields. They are rejected, not
  interpreted. Adapter names, run IDs and digests are provenance _claims_.
- **No unsafe result rendering.** Captured text is ordinary data. The
  library never interpolates it into HTML or a rendered diagnostic.
  Consumers must escape or safely render untrusted strings themselves.
- **No implicit provider use.** The package imports no runner, LLM or
  private application. A host chooses whether to call the async collector.
  The pure `evaluate` API remains synchronous and independent.
- **No release or formal credit authorization.** AY-I04 handles packed
  external consumer and security acceptance. A local mock cannot prove
  host isolation, executor controls, real artifact provenance or academic
  admission.

These limits are tested with simulated runner reports, missing references,
truncated streams, forged markers, wrong revision/digest, malicious HTML
text, and provider failures. Tests intentionally contain **no real hidden
test sources, secrets or learner data**.

## Selected execution facts and cancellation (AY-I19)

Selected public criteria are eligible for acquisition. A report echoes the
selector on each selected observation and supplies a top-level
`termination: "exited" | "timeout" | "crash"` when returning any selected fact.
The collector derives each new observation's origin from the envelope scope,
run and termination; observation-level origins remain forbidden. A report
may omit unavailable facts. Interrupted runs remain inconclusive, and no
exit value or output is synthesized. The receipt records termination when
supplied. Unselected reports may omit termination.

Supply a host-owned signal as the fourth argument:
`collectObservations(definition, startingEvidence, port, { signal })`.
The same native signal is passed as the second argument to the provider, without wrapping.
The exported structural `ObservationAbortSignal` type requires only the abort flag
and listener methods, so the installed declarations remain usable without Node
or DOM ambient types. Hosts needing the full native signal API can declare
`ObservationPort<AbortSignal>`; the collector preserves that signal type.
Verified
inputs are checked before cancellation; a valid pre-aborted operation never
invokes the port. Pending abort settles the collector, removes its listener,
ignores late resolution and consumes late rejection. No retries or default
timeout are applied. The host must arrange actual execution termination,
isolation and resource limits; an aborted collector does not prove the
provider stopped.
