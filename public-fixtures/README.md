# Public Fixture Corpus

These fixtures are intentionally small, public, and safe to share. They exercise the formatter,
language server, Project Doctor, resource indexing, dialogue checks, and scene-flow analysis without
using private GameMaker project files.

Use them for release smoke checks:

```sh
pnpm public-fixtures:test
```

The corpus includes:

- `TinyGame.yyp`: a minimal project manifest.
- `sprites/SPR_PLAYER/SPR_PLAYER.yy`: a known sprite resource.
- `rooms/ROOM_START/ROOM_START.yy`: a tiny room with one `OBJ_CONTROLLER` instance on an `Instances`
  layer.
- `objects/OBJ_CONTROLLER/Step_0.gml`: intentionally messy scene/state code.
- `objects/OBJ_CONTROLLER/Create_0.gml`: macros, variables, and resource references.
