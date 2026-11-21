# Contributing to Assay

Assay is in early development. Non-sensitive ideas and issues are welcome, but **external code contributions are not accepted until the open-source license and contribution terms are approved**. Public source visibility alone does not grant reuse rights.

Read the [public specification](https://github.com/0xbuffdev/context/blob/main/repos/assay/specs/0001-evaluation-core.md) and the current implementation ticket before suggesting behavior.

For maintainer-approved source work, use Node.js 24+ with pinned pnpm:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

Keep changes in one branch and PR per accepted ticket, cover malformed and incomplete evidence, and state actual verification. Do not introduce a hosted-service requirement or claim that an advisory finding is official credit. Follow [SECURITY.md](SECURITY.md) for sensitive reports instead of opening public issues.
