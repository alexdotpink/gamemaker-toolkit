import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import { formatGml, formatGmlDocument, getGmlFormatterDebugInfo } from "../src/formatter";
import { analyzeExpressionAtText, analyzeGmlSource, simplifyExpressionText } from "../src/analysis";
import { expectedArgumentCount, findBuiltin, GML_BUILTINS, GML_EVENTS } from "../src/gmlKnowledge";
import { buildGmlProjectIndex } from "../src/projectIndex";
import { compareTrivia } from "../src/trivia";

test("formats nested GML blocks", async () => {
  const input = [
    "if (hp<=0){",
    'show_debug_message("dead");',
    "with (obj_enemy){",
    "instance_destroy();",
    "}",
    "}",
  ].join("\n");

  assert.equal(
    await formatGml(input),
    [
      "if (hp <= 0) {",
      '    show_debug_message("dead");',
      "    with (obj_enemy) {",
      "        instance_destroy();",
      "    }",
      "}",
    ].join("\n"),
  );
});

test("keeps braces in strings and comments from changing indentation", async () => {
  const input = [
    "function describe(){",
    'var text = "not a real } brace"; // neither is { this',
    "/*",
    "}",
    "{",
    "*/",
    "return text;",
    "}",
  ].join("\n");

  assert.equal(
    await formatGml(input, { indentSize: 2 }),
    [
      "function describe() {",
      '  var text = "not a real } brace"; // neither is { this',
      "  /*",
      "  }",
      "  {",
      "  */",
      "  return text;",
      "}",
    ].join("\n"),
  );
});

test("preserves preprocessor lines and caps blank lines", async () => {
  const input = ["#macro DAMAGE 10", "", "", "if (hit){", "score += DAMAGE;", "}"].join("\n");

  assert.equal(
    await formatGml(input),
    ["#macro DAMAGE 10", "", "", "if (hit) {", "    score += DAMAGE;", "}"].join("\n"),
  );
});

test("supports tab indentation", async () => {
  assert.equal(
    await formatGml("if (ready){\nrun();\n}", { useTabs: true }),
    "if (ready) {\n\trun();\n}",
  );
});

test("formats switch case bodies without collapsing case indentation", async () => {
  const input = [
    "switch (fase){",
    "    case 2: //Waits for swami to pass a certain point to draw Tabris S",
    "        if (Swami_X < 1600) Tabris_X = 1850; ",
    "        else fase +=1;",
    "        break;",
    "    ",
    "    case 3: //Moves tabris behind the collomn",
    "        if (Tabris_X <1900) Tabris_X +=4;",
    "        else{",
    "            fase +=1;",
    "            Tabris_Y = 180;",
    "        }",
    "        break;",
    "}",
    "",
    "if (fase >= 7) draw_sprite(MEWO_SP,0, Mewo_X, Mewo_Y);",
  ].join("\n");

  assert.equal(
    await formatGml(input),
    [
      "switch (fase) {",
      "    case 2: // Waits for swami to pass a certain point to draw Tabris S",
      "        if (Swami_X < 1600) {",
      "            Tabris_X = 1850;",
      "        }",
      "        else {",
      "            fase += 1;",
      "        }",
      "        break;",
      "",
      "    case 3: // Moves tabris behind the collomn",
      "        if (Tabris_X < 1900) {",
      "            Tabris_X += 4;",
      "        }",
      "        else {",
      "            fase += 1;",
      "            Tabris_Y = 180;",
      "        }",
      "        break;",
      "}",
      "",
      "if (fase >= 7) {",
      "    draw_sprite(MEWO_SP, 0, Mewo_X, Mewo_Y);",
      "}",
    ].join("\n"),
  );
});

test("normalizes comments, operators, semicolons, and single-line control bodies", async () => {
  const input = [
    "Mewo_Y = ((46/2025)*(Mewo_X-3429)*(Mewo_X-3429)+266)",
    "if (Mewo_Y<= Mewo_Initial_Y) Mewo_X -= 2 //move mewo",
    "else fase+=1",
  ].join("\n");

  assert.equal(
    await formatGml(input),
    [
      "Mewo_Y = (46 / 2025) * (Mewo_X - 3429) * (Mewo_X - 3429) + 266;",
      "",
      "if (Mewo_Y <= Mewo_Initial_Y) {",
      "    Mewo_X -= 2; // move mewo",
      "}",
      "else {",
      "    fase += 1;",
      "}",
    ].join("\n"),
  );
});

test("formats unary signs without corrupting negative values", async () => {
  const input = ["switch(v){", "case -1:", "ch=-1", "if (_hor == -1) i *=-1", "break", "}"].join(
    "\n",
  );

  assert.equal(
    await formatGml(input),
    [
      "switch (v) {",
      "    case -1:",
      "        ch = -1;",
      "        if (_hor == -1) {",
      "            i *= -1;",
      "        }",
      "        break;",
      "}",
    ].join("\n"),
  );
});

test("keeps empty switch fallthrough labels tight", async () => {
  const input = [
    "switch (FACE){",
    "case 2: case 3: // face group",
    'name = "";',
    "break;",
    "}",
  ].join("\n");

  assert.equal(
    await formatGml(input),
    [
      "switch (FACE) {",
      "    case 2:",
      "    case 3: // face group",
      '        name = "";',
      "        break;",
      "}",
    ].join("\n"),
  );
});

test("formats else-if chains and loop bodies with required braces", async () => {
  const input = [
    "if x a=1",
    "else if y b=2",
    "else c=3",
    "",
    "for (var i=0;i<10;i++) show_debug_message(i)",
    "while ready do_work()",
    "repeat 3 count+=1",
    "with (obj_enemy) hp-=1",
    "do value+=1 until value>=10",
  ].join("\n");

  assert.equal(
    await formatGml(input),
    [
      "if (x) {",
      "    a = 1;",
      "}",
      "else if (y) {",
      "    b = 2;",
      "}",
      "else {",
      "    c = 3;",
      "}",
      "",
      "for (var i = 0; i < 10; i++) {",
      "    show_debug_message(i);",
      "}",
      "",
      "while (ready) {",
      "    do_work();",
      "}",
      "",
      "repeat (3) {",
      "    count += 1;",
      "}",
      "",
      "with (obj_enemy) {",
      "    hp -= 1;",
      "}",
      "",
      "do {",
      "    value += 1;",
      "}",
      "until (value >= 10)",
    ].join("\n"),
  );
});

test("formats functions, declarations, enums, and comments", async () => {
  const input = [
    "//top",
    "function make_value(a,b=2){",
    "var total=a+b",
    "return total",
    "}",
    "",
    "globalvar Game_State",
    'static cached = {name:"Alex",values:[1,2,3]}',
    "enum Mode{Idle=0,Run,Jump,}",
    "try{",
    "risky_call()",
    "}catch(err){",
    "show_debug_message(err)",
    "}finally{",
    "cleanup()",
    "}",
  ].join("\n");

  assert.equal(
    await formatGml(input),
    [
      "// top",
      "function make_value(a, b = 2) {",
      "    var total = a + b;",
      "    return total;",
      "}",
      "",
      "globalvar Game_State;",
      'static cached = {name: "Alex", values: [1, 2, 3]};',
      "",
      "enum Mode {",
      "    Idle = 0,",
      "    Run,",
      "    Jump",
      "}",
      "",
      "try {",
      "    risky_call();",
      "}",
      "catch (err) {",
      "    show_debug_message(err);",
      "}",
      "finally {",
      "    cleanup();",
      "}",
    ].join("\n"),
  );
});

test("reports debug comment attachments and semantic signatures", async () => {
  const debug = await getGmlFormatterDebugInfo(
    ["// file header", "value = -1; // trailing", "/* disabled block */"].join("\n"),
  );

  assert.equal(debug.comments.length, 3);
  assert.ok(debug.commentAttachments.some((comment) => comment.attachment === "leading"));
  assert.ok(debug.commentAttachments.some((comment) => comment.attachment === "trailing"));
  assert.ok(debug.semanticSignature.includes("Identifier:value"));
  assert.ok(debug.semanticSignature.includes("Real:1"));
  assert.ok(debug.formatterAstSummary.some((line) => line.includes("variableAssignmentStatement")));
  assert.ok(debug.formatterAstSummary.some((line) => line.includes("UnaryExpression:Minus")));
});

test("fuzzes representative valid snippets for safety and idempotency", async () => {
  const snippets = [
    "if (a) b = -1",
    "if (a) if (b) c = 1 else c = 2",
    "switch (x) { case -1: y *= -1 break }",
    "arr = [1,-2,foo(-3)]",
    "obj = {a:-1,b:x*-2}",
    "for (var i=0;i<10;i++) show_debug_message(i)",
    "do value+=1 until value>=10",
    "with (obj_enemy) hp-=1",
    "return ((a+b)*(c-d))",
  ];

  for (const snippet of snippets) {
    const once = await formatGmlDocument(snippet);
    assert.deepEqual(once.parserErrors, [], snippet);
    assert.deepEqual(once.safetyErrors, [], snippet);
    const twice = await formatGmlDocument(once.formatted);
    assert.equal(twice.formatted, once.formatted, snippet);
  }
});

test("style presets produce meaningfully different output", async () => {
  const input = "if x y=1";
  assert.equal(
    await formatGml(input, { style: "readable" }),
    ["if (x) {", "    y = 1;", "}"].join("\n"),
  );
  assert.equal(
    await formatGml(input, { style: "minimal", safety: "parse-only" }),
    ["if (x)", "    y = 1"].join("\n"),
  );
  assert.equal(
    await formatGml(input, { style: "compact", safety: "parse-only" }),
    ["if (x) {", "    y = 1;", "}"].join("\n"),
  );
});

test("analyzes state machines, dialogue consistency, names, and expressions", async () => {
  const input = [
    "// TODO: tune curve",
    "switch (fase) {",
    "    case 7: // Make Mewo do a parabola",
    "        Mewo_Y = (46 / 2025) * (Mewo_X - 3429) * (Mewo_X - 3429) + 266;",
    "        draw_sprite(MEWO_SP, 0, Mewo_X, Mewo_Y);",
    "        fase += 1;",
    "        fase += 1;",
    "        break;",
    "}",
    "function Draw_chioces(){",
    "    switch (txt_num) {",
    "        case 5:",
    "            LEN = 3;",
    "            face = [7, 7];",
    '            if global.LAN == "ITA" {',
    '                text = ["a", "b"];',
    '            } else if global.LAN == "ENG" {}',
    "            break;",
    "    }",
    "}",
  ].join("\n");

  const report = await analyzeGmlSource(input, {
    projectRules: {
      enableProjectPatternAnalysis: true,
      languageVariables: ["global.LAN"],
      requiredLanguages: ["ITA", "ENG"],
      dialogueObjects: ["dialoguebarUI"],
    },
  });
  assert.ok(report.stateMachines[0].warnings.some((warning) => warning.includes("multiple")));
  assert.ok(report.dialogueCases[0].warnings.some((warning) => warning.includes("LEN is 3")));
  assert.ok(
    report.dialogueCases[0].warnings.some((warning) => warning.includes("Empty language branch")),
  );
  assert.ok(report.suspiciousNames.some((name) => name.name === "Draw_chioces"));
  assert.ok(
    report.repeatedExpressions.some((expression) => expression.expression === "Mewo_X - 3429"),
  );
  assert.ok(report.metrics.cyclomaticComplexity > 1);
  assert.ok(report.branchContributors.some((entry) => entry.code.includes("global.LAN")));
  assert.ok(report.findings.some((finding) => finding.title && finding.explanation));
  assert.ok(report.todoComments.some((comment) => comment.tag === "TODO"));
  assert.ok(
    report.constantExpressions.some((expression) => expression.expression === "(46 / 2025)"),
  );
  assert.ok(
    report.assetReferences.some(
      (reference) => reference.kind === "sprite" && reference.name === "MEWO_SP",
    ),
  );
  assert.equal(simplifyExpressionText("ready == true"), "ready");
  assert.match(analyzeExpressionAtText("ready == true").plainEnglish, /equals true/);
  assert.equal(analyzeExpressionAtText("a or b and c").fullyParenthesized, "(a || (b && c))");
  assert.equal(
    simplifyExpressionText("((46/2025)*(Mewo_X-3429)*(Mewo_X-3429)+266)"),
    "((46 / 2025) * sqr(Mewo_X - 3429) + 266)",
  );
});

test("keeps project-specific dialogue and localization checks opt-in", async () => {
  const input = [
    "function Draw_choices(){",
    "    switch (txt_num) {",
    "        case 5:",
    "            LEN = 3;",
    "            face = [7, 7];",
    '            if global.LAN == "ITA" {',
    '                text = ["a", "b"];',
    "            }",
    "            break;",
    "    }",
    "}",
  ].join("\n");

  const defaultReport = await analyzeGmlSource(input);
  const enabledReport = await analyzeGmlSource(input, {
    projectRules: {
      enableProjectPatternAnalysis: true,
      languageVariables: ["global.LAN"],
      requiredLanguages: ["ITA", "ENG"],
      dialogueObjects: ["dialoguebarUI"],
    },
  });

  assert.equal(defaultReport.dialogueCases.length, 0);
  assert.ok(enabledReport.dialogueCases.length > 0);
});

test("loads generated GameMaker built-ins and event definitions", () => {
  const drawSprite = findBuiltin("draw_sprite");
  assert.ok(GML_BUILTINS.length >= 30);
  assert.ok(GML_EVENTS.some((event) => event.filePrefix === "Step"));
  assert.ok(drawSprite);
  assert.deepEqual(expectedArgumentCount(drawSprite), { min: 4, max: 4 });
});

test("analysis explains long conditions without generic complexity warnings", async () => {
  const input = [
    "switch (fase) {",
    "    case 1:",
    "        break;",
    "    /*case x:",
    "        if fake and fake2 and fake3 break;",
    "    */",
    "}",
    "",
    "if ((1776 < Swami_X and Swami_X < 2016) or (2688 < Swami_X and Swami_X < 2976) or ((240 < Swami_Y and Swami_Y < 336) and (2304 < Swami_X and Swami_X < 2400))) {",
    "    dialoguebarUI.txt_num = 3;",
    "}",
  ].join("\n");
  const withoutBlockComment = input.replace(
    "    /*case x:\n        if fake and fake2 and fake3 break;\n    */\n",
    "",
  );

  const report = await analyzeGmlSource(input);
  const reportWithoutBlockComment = await analyzeGmlSource(withoutBlockComment);
  assert.equal(
    report.metrics.cyclomaticComplexity,
    reportWithoutBlockComment.metrics.cyclomaticComplexity,
  );
  assert.equal(
    report.findings.some((finding) => finding.code === "complexity"),
    false,
  );
  assert.equal(
    report.findings.some((finding) => finding.code === "unreachable"),
    false,
  );
  assert.ok(
    report.findings.some(
      (finding) =>
        finding.code === "long-condition" &&
        finding.line === 9 &&
        finding.message.includes("checks 8 things"),
    ),
  );
});

test("compares trivia while ignoring comments inside strings and strings inside comments", () => {
  const left = 'text = "// nope"; //yes\n/* "not a string" */\n';
  const right = 'text = "// nope"; // yes\n/* "not a string" */\n';
  assert.equal(compareTrivia(left, right).ok, true);
  assert.equal(compareTrivia(left, 'text = "// nope";\n').ok, false);
});

test("default trivia safety preserves comments without requiring identical comment order", () => {
  const left = "case 1: // first\n    run();\ncase 2: // second\n    stop();\n";
  const reordered = "case 2: // second\n    stop();\ncase 1: // first\n    run();\n";
  assert.equal(compareTrivia(left, reordered).ok, true);
  assert.equal(compareTrivia(left, reordered, true).ok, false);
  assert.equal(
    compareTrivia(left, "case 1: // first\n    run();\ncase 2:\n    stop();\n").ok,
    false,
  );
});

test("preserves switch case line comments across safety checks", async () => {
  const input = [
    "switch(fase){",
    "    case 1: //First time loading in ",
    "        if (count >= 30){                              //Calibrare il framerate",
    "            fase += 1  ",
    "        }else count +=1;",
    "        break;",
    "    case 6: //pauses then sends Swami back",
    "        break;",
    "}",
  ].join("\n");

  const result = await formatGmlDocument(input);
  assert.deepEqual(result.parserErrors, []);
  assert.deepEqual(result.safetyErrors, []);
  assert.match(result.formatted, /case 1: \/\/ First time loading in/);
  assert.match(result.formatted, /if \(count >= 30\) \{ \/\/ Calibrare il framerate/);
  assert.doesNotMatch(result.formatted, /\n\s+\/\/ Calibrare il framerate\n/);
  assert.match(result.formatted, /case 6: \/\/ pauses then sends Swami back/);
});

test("preserves chained switch case comments", async () => {
  const input = [
    "switch(fase){",
    "    case 12: case 13: case 14: //syncs camera movement to Swami",
    "        Swami_obj.x = Tabris_X;",
    "        break;",
    "}",
  ].join("\n");

  const result = await formatGmlDocument(input);
  assert.deepEqual(result.parserErrors, []);
  assert.deepEqual(result.safetyErrors, []);
  assert.match(result.formatted, /\/\/ syncs camera movement to Swami/);
});

test("does not duplicate comments on expanded else-if statements", async () => {
  const input = [
    "if TXT == TP{",
    "    if key {//TRUET",
    "        initialize();",
    "    }",
    "}else if key TXT = TP; //TRUET",
  ].join("\n");

  const result = await formatGmlDocument(input);
  assert.deepEqual(result.parserErrors, []);
  assert.deepEqual(result.safetyErrors, []);
  assert.equal((result.formatted.match(/\/\/ TRUET/g) ?? []).length, 2);
});

test("analysis does not surface formatter safety as editor problems", async () => {
  const input = [
    "switch(fase){",
    "    case 1: //First time loading in ",
    "        if (count >= 30){ ",
    "            fase += 1  ",
    "        }else count +=1;",
    "        break;",
    "}",
  ].join("\n");

  const report = await analyzeGmlSource(input);
  assert.equal(
    report.findings.some((finding) => finding.code === "formatter-safety"),
    false,
  );
});

test("builds a GameMaker project index with resources, symbols, and unresolved references", () => {
  const index = buildGmlProjectIndex("/project", [
    {
      path: "/project/Chessworld.yyp",
      content: JSON.stringify({
        resources: [{ id: { name: "MEWO_SP", path: "sprites/MEWO_SP/MEWO_SP.yy" } }],
      }),
    },
    {
      path: "/project/sprites/MEWO_SP/MEWO_SP.yy",
      content: JSON.stringify({ name: "MEWO_SP", resourceType: "GMSprite" }),
    },
    {
      path: "/project/objects/OBJ_ENEMY/OBJ_ENEMY.yy",
      content: JSON.stringify({ name: "OBJ_ENEMY", resourceType: "GMObject" }),
    },
    {
      path: "/project/rooms/ROOM_START/ROOM_START.yy",
      content: JSON.stringify({
        name: "ROOM_START",
        resourceType: "GMRoom",
        layers: [
          {
            name: "Instances",
            instances: [{ objectId: { name: "OBJ_ENEMY" } }],
          },
        ],
      }),
    },
    {
      path: "/project/objects/o/Draw_0.gml",
      content:
        "#macro SPEED 4\nfunction Draw_chioces() {}\nvar local_score = 0;\ndraw_sprite(MEWO_SP, 0, x, y);\ndraw_sprite(OBJ_ENEMY, 0, x, y);\ndraw_sprite(MISSING_SP, 0, x, y);",
    },
    {
      path: "/project/objects/o/Create_0.gml",
      content: "ready = false;",
    },
    {
      path: "/project/objects/o/Step_0.gml",
      content: "if (hp <= 0) instance_destroy();",
    },
  ]);
  assert.ok(index.resources.some((resource) => resource.name === "MEWO_SP"));
  assert.ok(index.symbols.some((symbol) => symbol.name === "SPEED" && symbol.kind === "macro"));
  assert.ok(
    index.symbols.some((symbol) => symbol.name === "Draw_chioces" && symbol.kind === "function"),
  );
  assert.ok(index.resourceReferences.some((reference) => reference.name === "MEWO_SP"));
  assert.ok(index.unresolvedReferences.some((reference) => reference.name === "MISSING_SP"));
  assert.ok(index.unresolvedReferences[0].suggestions);
  assert.ok(index.identifierReferences.some((reference) => reference.name === "local_score"));
  assert.ok(
    index.rooms.some((room) => room.name === "ROOM_START" && room.layers.includes("Instances")),
  );
  assert.ok(index.inferredTypes.some((type) => type.name === "MEWO_SP" && type.type === "sprite"));
  assert.ok(
    index.objectEvents.some((event) => event.objectName === "o" && event.eventName === "Step"),
  );
  assert.ok(
    index.graph.variableLifecycle.some(
      (entry) => entry.objectName === "o" && entry.variable === "ready" && entry.assignedInCreate,
    ),
  );
  assert.ok(
    index.graph.maybeUninitializedVariables.some(
      (entry) => entry.objectName === "o" && entry.variable === "hp",
    ),
  );
  assert.ok(index.graph.resourceUsage.some((usage) => usage.resource.name === "OBJ_ENEMY"));
  assert.ok(index.graph.resourceTypeMismatches.some((mismatch) => mismatch.name === "OBJ_ENEMY"));
});

test("is idempotent for representative formatted code", async () => {
  const input = [
    "switch (state) {",
    "    case Mode.Idle:",
    "        if (ready) {",
    "            state = Mode.Run;",
    "        }",
    "        break;",
    "",
    "    default:",
    "        exit;",
    "}",
  ].join("\n");

  const once = await formatGml(input);
  const twice = await formatGml(once);
  assert.equal(twice, once);
});

test("formats golden fixtures and remains idempotent", async () => {
  const fixturesDir = path.join(__dirname, "..", "..", "test", "fixtures");
  const fixtureFiles = (await readdir(fixturesDir)).filter((file) => file.endsWith(".input.gml"));

  for (const inputFile of fixtureFiles) {
    const baseName = inputFile.replace(".input.gml", "");
    const input = await readFile(path.join(fixturesDir, inputFile), "utf8");
    const expected = await readFile(path.join(fixturesDir, `${baseName}.expected.gml`), "utf8");
    const formatted = await formatGml(input, { printWidth: 80 });
    assert.equal(formatted, expected, baseName);
    assert.equal(
      await formatGml(formatted, { printWidth: 80 }),
      formatted,
      `${baseName} idempotency`,
    );
  }
});

test("refuses to format code the GML parser rejects", async () => {
  const input = "if (x) {\ny = ;\n}";
  const result = await formatGmlDocument(input);
  assert.equal(result.formatted, input);
  assert.ok(result.parserErrors.length > 0);
  assert.deepEqual(result.safetyErrors, []);
});
