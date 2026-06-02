# Contributing

Thanks for helping improve GameMaker Toolkit.

## Requirements

- VS Code 1.90 or newer
- Node.js 20 or newer
- pnpm 9 or newer

## Local Setup

```sh
corepack enable
pnpm install
pnpm test
```

## Before Opening A Pull Request

Run the full local gate:

```sh
pnpm package:check
```

This checks Prettier formatting, builds the extension and language server, runs tests, verifies
fixtures, fuzzes generated snippets, and packages a VSIX.

## Formatter Changes

Formatter changes should include either an inline regression test in `test/formatter.test.ts` or a
fixture under `test/fixtures`.

When testing on a real GameMaker project, prefer a dry run first:

```sh
pnpm check /path/to/GameMaker/project
```

Use write mode only when you intentionally want to update the project files:

```sh
pnpm write /path/to/GameMaker/project
```
