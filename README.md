# GameMaker Toolkit

GameMaker Toolkit is a VS Code extension for GameMaker Language (`.gml`) projects. It includes a
formatter, parser-backed safety checks, a language server, project indexing, diagnostics,
completions, hovers, navigation, dialogue analysis, and project reports.

## Install

The preferred install method is the VS Code Marketplace:

[Install GameMaker Toolkit from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=alexdotpink.gamemaker-toolkit)

You can also install it from inside VS Code:

1. Open the Extensions view.
2. Search for `GameMaker Toolkit`.
3. Install the extension published by `alexdotpink`.

Alternative install options:

- Open VSX:
  [alexdotpink.gamemaker-toolkit](https://open-vsx.org/extension/alexdotpink/gamemaker-toolkit)
- GitHub Release VSIX:
  [latest release](https://github.com/alexdotpink/gamemaker-toolkit/releases/latest)

To install a downloaded VSIX manually:

```sh
code --install-extension path/to/gamemaker-toolkit-0.9.3.vsix --force
```

## Features

- Registers `.gml` as the `gml` language in VS Code.
- Provides a document formatter for **Format Document** and `editor.formatOnSave`.
- Uses `@bscotch/gml-parser` to parse GML before formatting, then prints from the parser CST with
  token-range expression rendering.
- Skips formatting when the GML parser reports syntax errors, when formatted output fails to
  reparse, or when the safety gate detects a formatter AST/trivia mismatch.
- Builds a formatter-owned AST for safety checks and debug output.
- Indents nested brace blocks and `switch`/`case` bodies while ignoring braces inside strings and
  comments.
- Normalizes `//` comments to include a following space.
- Adds spaces around common operators and after commas.
- Removes redundant outer parentheses from expression output when safe for the printed range.
- Splits long function calls, arrays, and structs using `gmlFormatter.printWidth`.
- Enforces braces around single-statement `if`/`else` bodies.
- Adds missing semicolons to ordinary statements.
- Supports document formatting, range formatting, formatter debug info, setup diagnosis, formatted
  diffs, skipped-format explanations, workspace dry runs, and a default-formatter setup command.
- Indexes GameMaker projects from `.yyp`, `.yy`, and `.gml` files for resource completions, built-in
  hovers, definitions, references, workspace symbols, and unresolved-resource diagnostics.
- Includes corpus scanning, fixture approval, check/write, project snapshots, generated fuzzing,
  debug-format, and local playground CLI tools.
- Includes a VS Code formatter playground webview with AST, comments, parser, and safety output.
- Adds a bundled language server for diagnostics, document symbols, workspace symbols, semantic
  tokens, completions, hovers, definitions, and references.
- Adds smart expression tools, state-machine analysis, dialogue consistency checks, scene-note
  generation, and a GameMaker project map.
- Includes basic syntax highlighting, snippets, folding, bracket matching, comment toggling, and
  indentation rules for `.gml`.
- Preserves preprocessor lines such as `#macro` and `#region`.
- Supports spaces or tabs, configurable indent size, trailing whitespace trimming, and blank-line
  limits.

## Settings

```json
{
  "gmlFormatter.indentSize": 4,
  "gmlFormatter.useTabs": false,
  "gmlFormatter.printWidth": 100,
  "gmlFormatter.trailingCommas": false,
  "gmlFormatter.multilineFunctionCalls": "auto",
  "gmlFormatter.style": "opinionated",
  "gmlFormatter.safety": "ast-and-trivia",
  "gmlFormatter.smartSimplify": "suggest",
  "gmlFormatter.projectRules": {
    "stateVariables": ["fase", "phase", "state"],
    "languageVariables": ["global.LAN"],
    "requiredLanguages": ["ITA", "ENG"],
    "dialogueObjects": ["dialoguebarUI"]
  },
  "gmlFormatter.mode": "file",
  "gmlFormatter.trimTrailingWhitespace": true,
  "gmlFormatter.maxBlankLines": 2,
  "gmlFormatter.readableSpacing": true
}
```

Style presets:

- `opinionated`: braces, semicolons, normalized comments, operator spacing, readable blank-line
  separators, and multiline layout.
- `minimal`: safer low-churn formatting with fewer automatic multiline rewrites.
- `preserve`: keeps more whitespace choices intact.
- `gameMakerStudio`: a wider, GameMaker-like preset.

Safety modes:

- `ast-and-trivia`: reparse formatted output, compare the formatter-owned AST, and verify
  comment/string preservation.
- `ast-equivalence`: reparse formatted output and compare the formatter-owned AST.
- `trivia-strict`: AST/trivia safety plus stricter comment anchor checks.
- `parse-only`: require only parser success before and after formatting.
- `off`: skip the post-format safety gate.

## Development

Requirements:

- VS Code 1.90 or newer
- Node.js 20 or newer
- pnpm 9 or newer

Install dependencies:

```sh
corepack enable
pnpm install
```

Build and test:

```sh
pnpm test
```

Format the repository's TypeScript, JSON, Markdown, and scripts:

```sh
pnpm format
pnpm format:check
```

Package a local VSIX and install it into VS Code:

```sh
pnpm package
code --install-extension gamemaker-toolkit-0.9.3.vsix --force
```

On Windows, run the same commands from PowerShell, Command Prompt, or Git Bash after installing
Node.js and VS Code. The package scripts use Node-based runners, so they do not require Unix shell
syntax.

## GitHub Releases

Tagged releases create a VSIX automatically through GitHub Actions:

```sh
git tag v0.9.3
git push origin v0.9.3
```

The release workflow runs the same `pnpm package:check` gate before attaching the `.vsix` file to
the GitHub release.

If the repository has `VSCE_PAT` and `OVSX_PAT` secrets configured, the release workflow also
publishes the same VSIX to the VS Code Marketplace and Open VSX.

## Continuous Integration

CI runs on Ubuntu, Windows, and macOS with Node.js 20 and 22. It checks formatting, tests, fixtures,
fuzzing, and VSIX packaging.

## Commands

- `GML: Format Document`
- `GML: Format With Lexical Fallback`
- `GML: Show Formatter Debug Info`
- `GML: Make This The Default Formatter`
- `GML: Diagnose Formatter Setup`
- `GML: Explain Why This File Was Not Formatted`
- `GML: Format and Show Diff`
- `GML: Format Workspace Dry Run`
- `GML: Open Formatter Playground`
- `GML: Analyze Current File`
- `GML: Explain Expression Under Cursor`
- `GML: Simplify Selected Expression`
- `GML: Generate Scene Notes`
- `GML: Analyze State Machine`
- `GML: Open Project Map`
- `GML: Rebuild Project Index`
- `GML: Go To Resource`
- `GML: Export Dialogue CSV`

## Quality Gates

The test suite includes inline regression tests, golden fixtures in `test/fixtures`, parser-error
refusal checks, and idempotency checks.

Useful local checks:

```sh
pnpm fixtures:test
pnpm fixtures:update
pnpm corpus /path/to/GameMaker/project
pnpm corpus /path/to/GameMaker/project --safety ast-equivalence
pnpm check /path/to/GameMaker/project
pnpm write /path/to/GameMaker/project
pnpm fuzz
pnpm analyze /path/to/file-or-project
pnpm project-index /path/to/GameMaker/project
pnpm dialogue-export /path/to/file-or-project
pnpm simplify-expression "ready == true"
pnpm snapshot:create /path/to/GameMaker/project chessworld
pnpm snapshot:test chessworld
pnpm snapshot:update chessworld
pnpm debug-format /path/to/file.gml
pnpm playground
```

`pnpm check` is the CI-style dry run. It exits non-zero if files would change or if parsing, safety,
or idempotency checks fail.

`pnpm write` formats files in place. Use it only when you intend to update the project.

`pnpm corpus` is stricter than a simple dry run: it formats every `.gml` file, reparses the result,
formats again, and verifies idempotency. By default it uses the same AST-plus-trivia safety as VS
Code. Use `--safety ast-equivalence` when you want to measure the structural formatter pass while
still allowing files with known comment-trivia issues to be skipped by normal Format Document.

`pnpm snapshot:create` writes ignored project snapshots under `test/corpus-snapshots/<name>`.
`snapshot:test` compares the current formatter output against that snapshot, and `snapshot:update`
refreshes it.

`pnpm fuzz` runs fixed and generated snippets through parse, format, reparse, AST safety, and
idempotency checks.

`pnpm analyze` runs the smart analyzer over one file or a folder and reports confidence, findings,
state machines, dialogue cases, magic numbers, suspicious names, and repeated expressions.

`pnpm project-index` reads `.yyp`, `.yy`, and `.gml` files and reports resources, symbols, resource
references, and unresolved resource references.

`pnpm dialogue-export` writes dialogue analysis as CSV.

`pnpm simplify-expression` runs the same expression simplifier used by the VS Code command/code
action.

## Smart Analysis

The analyzer is intentionally separate from Format Document. Formatting remains conservative and
behavior-preserving; smart rewrites are exposed as commands or code actions.

Current analysis features:

- formatter confidence with parser, AST, comment, and string preservation checks
- comment preservation audit
- string literal preservation audit
- magic-number detection
- constant arithmetic detection for tuning values such as `(46 / 2025)`
- file metrics for complexity, nesting, function count, code lines, and comment lines
- TODO/FIXME/BUG/HACK/NOTE comment detection
- asset-reference extraction for common sprite, sound, object, room, path, font, and timeline usages
- suspicious-name detection such as `chioces` -> `choices`
- duplicate-case and unreachable-flow warnings
- empty branch detection
- repeated-expression detection
- state-machine analysis for variables such as `fase`, `phase`, and `state`
- Mermaid state-machine graph generation
- dialogue checks for `LEN`, `text`, `face`, `choices`, `WN`, missing language branches, and empty
  language branches
- scene notes generated from switch-case comments
- GameMaker resource index from `.yy` and `.yyp` files

## Project Intelligence

The extension builds a lightweight project index from workspace files. It powers:

- resource-name completions
- built-in function/constant completions
- function, macro, enum, and resource workspace symbols
- hover docs for common GameMaker built-ins
- go-to-definition for indexed resources and symbols
- find-references for resource usage in common calls
- unresolved-resource diagnostics
- a project-map webview with resource/reference counts
- dialogue CSV export for translation review

Smart expression tools can:

- remove comparisons to `true`/`false`
- remove arithmetic identities such as `+ 0`, `* 1`, `/ 1`
- simplify double negation
- convert `x - -1` into `x + 1`
- detect repeated factors and suggest `sqr(...)` or local extraction
- explain expression shape and detected patterns

## Library API

The formatter core exports source-level helpers from `src/formatter.ts`:

```ts
parseGml(source);
formatGml(source, options);
formatGmlDocument(source, options);
checkGml(source, options);
getGmlFormatterDebugInfo(source);
analyzeGmlSource(source, options);
simplifyExpressionText(source);
analyzeExpressionAtText(source);
```

The CLI and VS Code extension are wrappers around the same engine.

## Troubleshooting

If normal **Format Document** does not run this extension:

1. Open a `.gml` file.
2. Run `GML: Diagnose Formatter Setup`.
3. Check the language ID and default formatter line in the `GameMaker Toolkit` output channel.
4. Run `GML: Make This The Default Formatter`.
5. Reload the VS Code window if an older VSIX was already active.

If a file is skipped:

1. Run `GML: Explain Why This File Was Not Formatted`.
2. Fix parser errors first.
3. If the safety gate refuses the file, inspect the semantic mismatch before lowering
   `gmlFormatter.safety`.

## Notes

The formatter is intentionally opinionated. It uses the parser CST for statement structure,
preserves comments as trivia, reparses the formatted output, and compares a formatter-owned AST
before returning edits in the default safety mode.
