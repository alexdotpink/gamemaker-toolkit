# Changelog

## 0.9.2

- Added a formatter comment-preservation fallback that re-attaches missing line comments before the
  AST/trivia safety gate runs, covering switch-case comments, chained case labels, and other
  formatter rewrites that move code around comments.
- Stopped surfacing internal formatter safety failures as live editor Problems from the language
  server analyzer. Formatting commands still skip unsafe edits, but normal editing diagnostics no
  longer show scary formatter-safety errors for intentionally skipped files.
- Added regressions for Chessworld-style `case 1: //First time loading in` comments and chained
  `case 12: case 13: case 14: //...` comments.

## 0.9.1

- Fixed default comment-trivia safety so harmless comment reordering no longer blocks formatting
  when every comment and string literal is still preserved.
- Kept strict comment order and anchor checks available through
  `gmlFormatter.safety: "trivia-strict"`.
- Fixed `pnpm check path/to/file.gml` and related project-file discovery commands for single-file
  inputs.
- Removed duplicate extension-host diagnostics now that the bundled language server owns live
  analyzer diagnostics.

## 0.9.0

- Renamed the extension to GameMaker Toolkit for public release.
- Set public author and publisher metadata to `alexdotpink`.
- Added a bundled language server for diagnostics, completions, hovers, definitions, references,
  document symbols, workspace symbols, and semantic tokens.
- Updated default formatter identity to `alexdotpink.gamemaker-toolkit`.
- Removed local planning artifacts and old VSIX build outputs from the working tree.
- Added Prettier formatting for the TypeScript, JSON, Markdown, and script code in this repository.
- Added `format` and `format:check` scripts and wired `format:check` into CI.
- Made the default GML formatter output more readable with expanded control-flow bodies and blank
  separators between top-level blocks/control-flow sections.
- Added `gmlFormatter.readableSpacing` and raised the default `gmlFormatter.maxBlankLines` to 2.

## 0.8.0

- Added an AST-plus-trivia safety mode that verifies comments and string literals after formatting.
- Added a reusable GameMaker project index for `.yyp`, `.yy`, and `.gml` files.
- Added resource, function, macro, enum, and built-in indexing for completions, hovers, definitions,
  references, workspace symbols, and unresolved-resource diagnostics.
- Added commands to rebuild the project index, jump to resources, and export dialogue analysis as
  CSV.
- Expanded the formatter playground with analyzer confidence, metrics, findings, state-machine
  counts, dialogue counts, and asset-reference counts.
- Added a built-in GameMaker knowledge pack for common functions/constants used in hovers and
  completions.
- Added CLI commands for project indexing and dialogue CSV export.
- Added CLI `--safety` overrides for corpus/check runs.
- Added regression tests for trivia safety, project indexing, and extension provider wiring.

## 0.7.1

- Added analysis metrics for code lines, comment lines, function count, cyclomatic complexity, and
  max brace depth.
- Added TODO/FIXME/BUG/HACK/NOTE comment detection with diagnostics.
- Added constant arithmetic detection for expressions such as `(46 / 2025)` so tuning values can be
  named deliberately.
- Added asset-reference extraction for common sprite, sound, object, room, path, font, and timeline
  usages.
- Improved expression simplification output by normalizing operator spacing and recognizing
  parabola-style repeated X offsets.
- Expanded analyzer CLI output and VS Code analysis reports with the new smart sections.

## 0.7.0

- Added smart expression tools for simplification and explanation outside the normal formatter path.
- Added file analysis for formatter confidence, comment/string preservation audits, magic numbers,
  suspicious names, unreachable flow, duplicate cases, repeated expressions, state machines, and
  dialogue consistency.
- Added project-specific analysis rules for state variables, language variables, required languages,
  and dialogue objects.
- Added VS Code commands for file analysis, expression explanation, expression simplification, scene
  notes, state machine analysis, and project maps.
- Added quick-fix/refactor code actions for selected expression simplification and magic-number
  extraction.
- Added GameMaker project resource indexing for `.yy`/`.yyp` files in the Project Map webview.
- Added CLI analysis and expression simplification commands.
- Added analyzer regression tests covering Chessworld-style state/dialogue issues.

## 0.6.0

- Added a formatter-owned AST model with statement nodes, expression nodes, semantic tokens, AST
  summaries, and AST-based equivalence diagnostics.
- Replaced the default post-format safety comparison with formatter AST equivalence.
- Added exported formatter library entry points for parsing and checking source text.
- Made style presets more distinct: minimal/preserve can avoid brace and semicolon enforcement while
  opinionated remains strict.
- Added a VS Code formatter playground webview with formatted output, safety data, comment
  attachments, and formatter AST summaries.
- Added lightweight language tooling: document symbols, selected built-in hovers, and debounced
  diagnostics.
- Added project snapshot commands: `snapshot:create`, `snapshot:test`, and `snapshot:update`.
- Expanded fuzzing from fixed seeds to generated valid snippets covering unary signs, arrays,
  structs, calls, loops, and switch cases.

## 0.5.0

- Added a post-format safety gate that reparses output and compares a normalized semantic token
  signature before returning edits.
- Added style presets and configurable safety mode.
- Improved expression cleanup by removing redundant outer parentheses in expression output while
  preserving required inner grouping.
- Added comment attachment reporting for formatter debug info.
- Added VS Code commands for setup diagnosis, skipped-format explanation, formatted diffs, and
  workspace dry runs.
- Added a status-bar formatter indicator, output channel logging, syntax highlighting, snippets,
  folding, and indentation rules.
- Added CLI `check`, `write`, and `fuzz` commands.
- Added fuzz-style regression coverage and expanded manifest tests.
- Fixed `do until` idempotency by avoiding a generated empty statement after `until`.

## 0.4.1

- Fixed unary sign spacing so negative values stay readable and valid, including `case -1`,
  `x = -1`, and `i *= -1`.
- Preserved block comments and other trivia between `switch` cases.
- Fixed same-line fallthrough case labels so trailing comments attach only to the final label.
- Added Chessworld-derived regression fixtures and verified the Chessworld corpus remains parseable,
  reparsable, and idempotent.

## 0.4.0

- Added Doc IR/layout primitives used by multiline expression rendering.
- Added normalized AST summaries and comment collection for debug tooling.
- Added parser diagnostics with line/column information.
- Added VS Code diagnostic collection integration.
- Added explicit lexical fallback command for damaged snippets.
- Added corpus scanning, fixture approval, debug-format, and playground CLI tools.
- Added extension manifest smoke tests and expanded CI matrix.
- Added release metadata and extension icon.

## 0.3.0

- Added golden fixture tests and idempotency checks.
- Added print-width based multiline formatting for long function calls, arrays, and struct literals.
- Added formatter settings for `printWidth`, `trailingCommas`, and `multilineFunctionCalls`.
- Added range-format registration, formatter debug info, and default-formatter setup commands.
- Improved parser-error messages shown by the VS Code extension.

## 0.2.0

- Replaced the line-oriented formatter with a CST-backed printer built on `@bscotch/gml-parser`.
- Added explicit statement handlers for core GML constructs.
- Added parser-error refusal and formatted-output reparse validation.

## 0.1.0

- Initial local VS Code formatter extension scaffold.
