# Release and package-acceptance policy

**Assay has no published release.** The repository remains Apache-2.0
licensed, with package version 0.0.0 and **private: true**. The public
source is usable under its license; this is **not** approval to publish
an npm package, issue a tag, deploy a service or grant formal credit.

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
