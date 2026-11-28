# Contributing

Assay welcomes reproducible bug reports, documentation corrections and technical proposals. Open an issue before changing a public contract or architecture. Use the [security policy](SECURITY.md) for confidential reports.

## Development

Install Node.js 24+ and pnpm 11.2.2, then run:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

Use a focused branch and add tests for changed behavior. The full check includes typechecking, Biome, Vitest, the build and the offline installed-package tests. See [development](docs/development.md) and the [accepted specifications](https://github.com/0xbuffdev/context/tree/main/repos/assay).

## Pull requests

Explain the intended behavior, relevant ticket or issue, and the checks you ran. Use synthetic fixtures, retain the zero-runtime-dependency boundary and keep protected material out of public changes. Contract changes require maintainer approval.

Contributions intentionally submitted for inclusion follow Section 5 of the [Apache License 2.0](LICENSE), unless explicitly stated otherwise or covered by a separate agreement.
