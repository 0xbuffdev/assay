# Release and package-acceptance policy

**Assay has no published release.** The repository remains Apache-2.0
licensed, with package version 0.0.0 and **private: true**. The public
source is usable under its license; this is **not** approval to publish
an npm package, issue a tag, deploy a service or grant formal credit.

**AY-I09 decision, 2026-11-22: NO-GO for npm publication.** The current
technical implementation is ready for a separately reviewed **release
candidate**, but registry ownership, contributor rights, release version,
trusted publisher setup and human authorization have not been established.
See the [canonical release decision](https://github.com/0xbuffdev/context/blob/main/repos/assay/reviews/2026-11-22-release-decision.md).
The historical decision deferred AY-I08 for the original candidate. The accepted
expanded-candidate amendment includes attributed advisory review and composed
criteria; AY-I26 must reassess the expanded candidate after AY-I27 and AY-I28.
The original publication NO-GO remains in force.

AY-I04 adds an automated **release-candidate quality gate**, not a release
action. This gate is read-only with respect to Git, GitHub releases and the
npm registry. It does not authenticate a host execution environment or
replace a publisher-ownership and legal-rights review.

## Reproducible verification

With Node.js 24+ and pinned pnpm 11.2.2:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

The full command verifies repository invariants, TypeScript, Biome, Vitest,
tsdown ESM/type declarations and the actual packed package. To run the
distribution-only gate after building:

```sh
pnpm build
pnpm verify:package
```

CI executes the pack verification as a separate final step on **the same
checked-out commit** on Ubuntu and Windows (Node.js 24), after the other
checks, using read-only GitHub permissions. No workflow uses publish tokens.
The verifier invokes npm's JavaScript CLI with the active Node executable
instead of spawning a Windows batch shim or enabling shell interpolation.

## What the packed-consumer gate does

1. Checks source metadata for the approved package name, unreleased
   version, Apache-2.0 license, private flag, ESM exports, types and no
   install/publish lifecycle scripts.
2. Rejects workspace, catalog, local-path, Git and URL package
   dependencies. Rejects all runtime, peer, optional and bundled
   dependencies; development tooling remains pinned outside the package.
3. Creates the local tarball with npm pack --offline --ignore-scripts
   --json. This is **not** npm publish and nothing is uploaded.
4. Enforces this exact archive allowlist: package.json, README.md,
   CHANGELOG.md, LICENSE, COPYRIGHT.md, dist/index.js,
   dist/index.js.map and dist/index.d.ts. New distributable files must
   be explicitly reviewed before adding them.
5. Verifies the installed Apache-2.0 license and copyright notice.
   It also checks emitted JavaScript, declarations and sourcemap for
   known private/test canaries. This is **supplemental scanning**, not
   a generic secret detector.
6. Creates an independent consumer in a temporary directory **outside
   the source repo**. Installs the exact produced tarball using offline
   npm with scripts disabled, no developer dependencies, no registry
   requests and no workspace symlinks. The only installed package
   must be Assay.
7. Executes an ESM fixture against the installed package. It covers
   exact/normalized text, numeric tolerance, set semantics, missing
   evidence, truncation, invalid contracts, required/advisory
   precedence, restricted references, optional observation ports,
   forged trust claims, malicious text, replay and technical-only
   outcomes.
8. Typechecks a separate TypeScript fixture against the actual
   installed declarations using a standalone tsconfig. The compiler
   executable comes from the repository's development toolchain, but
   the consumer's package/type resolution is isolated from the repo.
   Its negative type tests reject unsupported criteria, wrong
   observation types and non-Promise ports.
9. Removes the temporary tarball and installed consumer on both
   success and failure. The gate does not promote a release artifact.

The public library still has zero runtime dependencies, with no OEE,
0xNAND, executor, model provider, paid account or network requirement.

## Acceptance matrix

The canonical [Assay specification acceptance cases](https://github.com/0xbuffdev/context/blob/main/repos/assay/specs/0001-evaluation-core.md)
are covered as public-library behavior, not as proof of formal academic
admission or genuine external runner isolation.

| Cases                      | Test evidence                       | Scope                                                          |
| -------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| AY-01, AY-19               | Offline packed consumer, ESM, TS    | Independent public package                                     |
| AY-02, AY-03, AY-09, AY-14 | Unit and consumer tests             | Empty, absent and truncated requirements cannot silently pass  |
| AY-04–AY-07                | Comparators and external consumer   | Deterministic text, numeric tolerance and set policies         |
| AY-08, AY-10–AY-12         | Comparator and adversarial fixtures | Required/advisory precedence, comparator errors, manual review |
| AY-13, AY-15, AY-21        | Security and consumer fixtures      | Forged trust, hidden references and malicious text             |
| AY-16, AY-17               | Replay and version fixtures         | Stable results and distinct revision lineage                   |
| AY-18, AY-20               | Optional port and consumer fixtures | Technical evidence is not authenticated academic credit        |
| AY-22                      | Contract and negative fixtures      | Unknown kinds and corrupt evidence are typed errors            |

AY-I07 additionally verifies the [public projection](projection.md) against
private-identifier canaries and hidden-outcome permutations. This masks
**technical result disclosure**, not host-side account authorization, hidden
case isolation or side-channel defenses.

The **host-owned** verification aspects of AY-12, AY-13, AY-15, AY-18
and AY-20 are **not proven** by the package tests. Formal assessment
products must independently enforce admission, origin authenticity,
protected cases, runner privilege separation and credit decisions.
A locally mocked execution provider cannot prove production isolation.

## Candidate readiness review — AY-I09

This is a **governance hold**, not a failed source build. The merged technical milestones include numeric unit agreement (AY-I05), canonical definition content identity (AY-I06) and restricted learner-safe projection (AY-I07). The [last reviewed source PR #10](https://github.com/0xbuffdev/assay/pull/10) passed **91/91 unit tests on Ubuntu and 91/91 on Windows**, strict TypeScript and Biome, tsdown ESM/types, and independent packed ESM/TypeScript consumers in [CI run 45011899614](https://github.com/0xbuffdev/assay/actions/runs/45011899614). That CI run covers its reviewed PR head; any later release candidate must be verified again on its **own exact commit**.

**Publication remains blocked pending all of these external decisions:**

- The maintainer verifies ownership and public publishing permissions for the npm organization **@0xbuff** and package **@0xbuff/assay**. Source manifest metadata and public registry lookups do not prove namespace control.
- The copyright owner confirms the authority to license all merged source contributions and reviews third-party attribution and any distribution notices. Automatic metadata and allowlist checks are not legal clearance.
- The maintainer approves the _exact_ candidate SHA, package name, public API/version compatibility and a real pre-release version. **0.1.0-beta.1** and the npm **beta** dist-tag are recommendations only, not selected versions or commands to execute.
- A distinct, reviewed publishing workflow is designed with minimal permissions, a protected environment and a maintainer-controlled approval gate. The existing quality CI must remain read-only, without npm tokens or publish actions.
- Before approving a release, execute the full suite on the candidate SHA, independently check its packed tarball and source maps, audit the intended release notes, and verify the actual npm publisher identity.

For a public package released from a public repository, the recommended future security design is a **stage-only npm trusted publisher** using GitHub Actions OIDC and explicit maintainer review, rather than a long-lived npm token. npm's [official trusted publisher documentation](https://docs.npmjs.com/trusted-publishers/) describes staged publishing and automatic provenance on public GitHub Actions repositories; it currently **does not generate provenance for CircleCI**. The npm publishing credentials and any staging workflow must be reviewed **in their own authorized change**. Nothing in the existing Assay CI enables these privileges.

Until those checks and a separate human approval are recorded, keep version **0.0.0**, the **private** flag and the existing package allowlist unchanged. Do not publish, create a version tag, enable trusted publishers or grant formal host grading authority as part of documentation maintenance.

## Separate maintainer release decision

Before any publication, the maintainer must:

1. Review the exact proposed commit and diff, including source,
   documentation and distributable sourcemaps.
2. Confirm Apache-2.0 attribution, contributor rights and all
   direct/transitive dependency notices and licenses. The automated
   checks enforce package metadata and contents but **do not provide
   legal clearance**.
3. Independently review any real execution isolation, hidden-case
   handling and authoritative grading in the **host** if those are
   used. Neither a mock run nor an adapter name proves provenance.
4. Run the complete quality gate and verify hosted CI on the **exact
   commit**, retaining the run URL and packed archive file list.
5. Decide a real release version and compatibility policy in a
   **separate approved change**. The current source remains 0.0.0
   and private: true, and there is no supported published package.
6. Secure npm scope ownership and publish credentials outside source
   control, then seek explicit version/tag/publication authorization.

Do **not** remove the private flag, enable a publish workflow, make
a tag, sign for the maintainer, or merge merely because CI is green.
