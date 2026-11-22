# Contributing to Assay

Assay is licensed under the [Apache License, Version 2.0](LICENSE). Non-sensitive ideas and issues are welcome. Propose significant code changes in an issue first; external pull requests remain subject to maintainer review and acceptance. Contributions intentionally submitted for inclusion are handled under Section 5 of Apache-2.0 unless explicitly stated otherwise or covered by a separate agreement.

Read the [public specification](https://github.com/0xbuffdev/context/blob/main/repos/assay/specs/0001-evaluation-core.md) and the current implementation ticket before suggesting behavior.

For maintainer-approved source work, use Node.js 24+ with pinned pnpm:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

The full `pnpm check` includes offline packed-consumer acceptance after the ESM/type build. It creates and deletes only a temporary local tarball; no npm publication occurs.

Keep changes in one branch and PR per accepted ticket, cover malformed and incomplete evidence, and state actual verification. Do not introduce a hosted-service requirement or claim that an advisory finding is official credit. Follow [SECURITY.md](SECURITY.md) for sensitive reports instead of opening public issues.
