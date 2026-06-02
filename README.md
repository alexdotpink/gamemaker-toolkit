# GameMaker Toolkit

GameMaker Toolkit is a VS Code extension for GameMaker Language (`.gml`) projects. It includes a
formatter, parser-backed safety checks, a language server, project indexing, diagnostics,
completions, hovers, signatures, navigation, rename support, generated GameMaker API knowledge,
room-aware project reports, optional project-pattern analysis, and beginner-friendly cleanup tools.

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
code --install-extension path/to/gamemaker-toolkit-0.10.0.vsix --force
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
- Includes formatter preview, safe cleanup preview/apply, and a readability workflow that groups
  safe fixes separately from refactor suggestions.
- Indexes GameMaker projects from `.yyp`, `.yy`, and `.gml` files for resource completions, built-in
  hovers, signature help, definitions, references, rename, workspace symbols, typo suggestions,
  inferred resource/value types, and unresolved-resource diagnostics.
- Builds a project graph with room instances, resource usage, unused-resource hints, and resource
  type-mismatch checks.
- Includes corpus scanning, fixture approval, check/write, project snapshots, generated fuzzing,
  debug-format, and local playground CLI tools.
- Includes a VS Code formatter playground webview with AST, comments, parser, and safety output.
- Adds a bundled language server for diagnostics, document symbols, workspace symbols, semantic
  tokens, completions, hovers, signatures, definitions, references, and rename.
- Uses generated GameMaker API data for built-in completions, hover docs, signatures, argument
  diagnostics, resource argument hints, and event-aware warnings.
- Adds smart expression tools, state-machine analysis, a scene-flow view, cutscene timeline notes,
  state enum previews, scene-note generation, Project Doctor, and a GameMaker project map.
- Adds object-event maps, maybe-uninitialized instance-variable hints, globals reports, and resource
  rename previews.
- Keeps dialogue/localization checks as optional project-pattern analysis instead of treating
  project-specific systems as first-party GameMaker features.
- Adds inline code lenses for scene states, branch-heavy conditions, and repeated expressions.
- Adds `Explain This File`, `Installation Doctor`, and `Report Formatter Bug` commands.
- Includes syntax highlighting, semantic tokens, snippets, folding, bracket matching, comment
  toggling, and indentation rules for `.gml`.
- Offers one-click onboarding when a `.gml` file opens and this extension is not the default
  formatter.
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
  "gmlFormatter.style": "readable",
  "gmlFormatter.safety": "ast-and-trivia",
  "gmlFormatter.smartSimplify": "suggest",
  "gmlFormatter.projectRules": {
    "enableProjectPatternAnalysis": false,
    "stateVariables": ["fase", "phase", "state"],
    "languageVariables": [],
    "requiredLanguages": [],
    "dialogueObjects": []
  },
  "gmlFormatter.mode": "file",
  "gmlFormatter.trimTrailingWhitespace": true,
  "gmlFormatter.maxBlankLines": 2,
  "gmlFormatter.readableSpacing": true,
  "gmlFormatter.onboarding.enabled": true
}
```

Style presets:

- `readable`: beginner-friendly default with braces, semicolons, normalized comments, operator
  spacing, readable blank-line separators, and multiline layout.
- `compact`: keeps the same safety expectations while using fewer blank-line separators.
- `strict`: readable formatting with the strictest trivia safety mode by default.
- `repair`: parse-only safety for damaged snippets and manual recovery work.
- `opinionated`: compatibility alias for the readable preset.
- `minimal`: lower-churn formatting with fewer automatic rewrites.
- `preserve`: keeps more whitespace choices intact.
- `gameMakerStudio`: a wider, GameMaker-like preset.

Project pattern rules:

- `stateVariables` controls generic switch/state-machine detection.
- `enableProjectPatternAnalysis` turns on optional project-specific checks such as
  dialogue/localization patterns.
- `languageVariables`, `requiredLanguages`, and `dialogueObjects` are empty by default because those
  systems are project conventions, not standard GameMaker APIs.

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

Regenerate the bundled GameMaker API knowledge after editing `data/gml-builtins.seed.json` or after
importing a fuller JSON data source:

```sh
pnpm generate:gml-knowledge
```

The official GameMaker manual publishes the GML reference as documentation pages. This repository
keeps the extension data as importable JSON so the knowledge pack can be expanded without wiring
every built-in manually in TypeScript.

Format the repository's TypeScript, JSON, Markdown, and scripts:

```sh
pnpm format
pnpm format:check
```

Package a local VSIX and install it into VS Code:

```sh
pnpm package
code --install-extension gamemaker-toolkit-0.10.0.vsix --force
```

On Windows, run the same commands from PowerShell, Command Prompt, or Git Bash after installing
Node.js and VS Code. The package scripts use Node-based runners, so they do not require Unix shell
syntax.

## GitHub Releases

Tagged releases create a VSIX automatically through GitHub Actions:

```sh
git tag v0.10.0
git push origin v0.10.0
```

The release workflow runs the same `pnpm package:check` gate before attaching the `.vsix` file to
the GitHub release.

If the repository has `VSCE_PAT` and `OVSX_PAT` secrets configured, the release workflow also
publishes the same VSIX to the VS Code Marketplace and Open VSX.

## Continuous Integration

CI runs on Ubuntu, Windows, and macOS with Node.js 20 and 22. It checks formatting, tests, fixtures,
public fixtures, fuzzing, and VSIX packaging.

A separate extension-host smoke test runs the extension inside VS Code on the public fixture corpus
on Linux and Windows:

```sh
pnpm test:extension-host
```

## Commands

- `GML: Format Document`
- `GML: Format With Lexical Fallback`
- `GML: Show Formatter Debug Info`
- `GML: Make This The Default Formatter`
- `GML: Diagnose Formatter Setup`
- `GML: Explain Why This File Was Not Formatted`
- `GML: Explain Problem`
- `GML: Format and Show Diff`
- `GML: Preview Format Changes`
- `GML: Format Workspace Dry Run`
- `GML: Open Formatter Playground`
- `GML: Analyze Current File`
- `GML: Project Doctor`
- `GML: Explain Expression Under Cursor`
- `GML: Simplify Selected Expression`
- `GML: Generate Scene Notes`
- `GML: Analyze State Machine`
- `GML: Open Scene Flow View`
- `GML: Open Project Map`
- `GML: Rebuild Project Index`
- `GML: Go To Resource`
- `GML: Export Dialogue CSV`
- `GML: Preview Safe Cleanup Fixes`
- `GML: Apply Safe Cleanup Fixes`
- `GML: Make This Code Easier To Read`
- `GML: Explain This File`
- `GML: Report Formatter Bug`
- `GML: Installation Doctor`
- `GML: Open Object Event Map`
- `GML: Open Cutscene Timeline`
- `GML: Preview State Enum`
- `GML: Preview Resource Rename`
- `GML: Open Globals Report`
- `GML: Minimize Formatter Bug`

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
pnpm public-fixtures:test
pnpm test:extension-host
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

`pnpm project-index` reads `.yyp`, `.yy`, and `.gml` files and reports resources, symbols, rooms,
resource references, inferred types, resource usage, type mismatches, and unresolved resource
references.

`pnpm dialogue-export` writes dialogue analysis as CSV.

`pnpm simplify-expression` runs the same expression simplifier used by the VS Code command/code
action.

`pnpm public-fixtures:test` runs corpus, analyzer, and project-index checks against the public
fixtures in `public-fixtures/`, including a tiny room/object/sprite project with an intentional
resource typo.

## Smart Analysis

The analyzer is intentionally separate from Format Document. Formatting remains conservative and
behavior-preserving; smart rewrites are exposed as commands or code actions.

Current analysis features:

- formatter confidence with parser, AST, comment, and string preservation checks
- comment preservation audit
- string literal preservation audit
- magic-number detection
- constant arithmetic detection for tuning values such as `(46 / 2025)`
- file metrics for branch/condition score, nesting, function count, code lines, and comment lines
- per-line branch contributors so reports can show which exact condition or case caused the score
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
- beginner-friendly explanations for warnings, including what happened, why it matters, and what to
  do next
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
- likely-resource suggestions for unresolved resource names
- a project-map webview with resource/reference counts
- Project Doctor for formatting confidence, missing resources, branchy lines, and beginner-friendly
  next steps
- dialogue CSV export for translation review

Smart expression tools can:

- remove comparisons to `true`/`false`
- remove arithmetic identities such as `+ 0`, `* 1`, `/ 1`
- simplify double negation
- convert `x - -1` into `x + 1`
- detect repeated factors and suggest `sqr(...)` or local extraction
- explain expression shape, detected patterns, plain-English meaning, and a fully parenthesized form

## Marketplace Checklist

For Marketplace releases, the preferred public story is:

- safe formatting through parser, AST, comment, and string checks
- beginner-friendly diagnostics with quick fixes and explanations
- GameMaker project awareness for `.yyp`, `.yy`, resources, scripts, and events
- scene-flow tooling for `switch (state)` / `switch (fase)` cutscene code
- public fixtures and extension-host smoke tests for clone-and-run confidence

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
