import { expect, test } from "bun:test";
import { createAnalysis } from "../../src/composition/analysis";
import { GodotResourceAdapter } from "../../src/formats/godot-resource/GodotResourceAdapter";
import { attribute, parseResource } from "../../src/formats/godot-resource/parser";
import { attachedScript, autoloads } from "../../src/frameworks/godot/project-links";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { fixture } from "../helpers";

test("resource grammar preserves StringName values in audio buses and nested collections", () => {
  const source =
    '[gd_resource type="AudioBusLayout" format=3]\n\n[resource]\nbus/1/name = &"Music"\nbus/1/send = &"Master"\nbus/1/mute = false\nlabels = [&"ui.\\u0074itle", {&"key": &"value"}]\n';
  const resource = parseResource("default_bus_layout.tres", source)[1];
  expect(resource?.properties.get("bus/1/name")).toEqual({ text: '&"Music"', string: "Music", reference: undefined });
  expect(resource?.strings).toEqual(["Music", "Master", "ui.title", "key", "value"]);
  expect(resource?.body).toContain('bus/1/name = &"Music"');
});

test("StringName literals contribute exact resource usage evidence", async () => {
  const f = fixture();
  f.write("data.tres", '[gd_resource format=3]\n[resource]\nname = &"ui.title"\n');
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const usages = project.analysis.literalUsages(project, "ui.title");
  expect(usages).toHaveLength(1);
  expect(usages[0]?.source).toContain('&"ui.title"');
});

test("typed resource arrays and dictionaries accept trailing commas without losing dependencies", () => {
  const source =
    '[resource]\nitems = Array[ExtResource("type")]([ExtResource("first"), ExtResource("second"),])\nlabels = {&"key": "value",}\n';
  const resource = parseResource("catalog.tres", source)[0];
  expect(resource?.references).toEqual([
    { kind: "ext_resource", id: "type" },
    { kind: "ext_resource", id: "first" },
    { kind: "ext_resource", id: "second" },
  ]);
  expect(resource?.strings).toContain("value");
  expect(resource?.body).toContain('ExtResource("second"),]');
});

test("project setting feature overrides accept dotted property paths", () => {
  const source = '[rendering]\nrendering_device/driver.windows="d3d12"\n[autoload]\nApp="*res://app.gd"\n';
  expect(parseResource("project.godot", source)[0]?.properties.get("rendering_device/driver.windows")?.string).toBe(
    "d3d12",
  );
  expect(autoloads(source)).toEqual({ App: "res://app.gd" });
});

test("resource grammar rejects incomplete StringNames and missing collection values", () => {
  for (const value of ["&", '&"unterminated', "[,]", "{,}", '["first",, "second"]']) {
    expect(() => parseResource("broken.tres", `[resource]\nvalue = ${value}\n`)).toThrow("broken.tres");
  }
});

test("resource grammar handles multiline values and headers without interpreting strings or comments as sections", () => {
  const source =
    '[gd_scene format=3]\n; [node name="Fake"]\n[node\n name="Real\\"Node"\n type="Label"]\ntext = "Hello\n[node name=NotASection]\nWorld"\nvalues = Array[String](["one", "two"])\n';
  const sections = parseResource("scene.tscn", source);
  expect(sections.map((section) => section.kind)).toEqual(["gd_scene", "node"]);
  const node = sections[1];
  if (!node) throw new Error("Missing node");
  expect(attribute(node, "name")).toBe('Real"Node');
  expect(node.strings).toEqual(["Hello\n[node name=NotASection]\nWorld", "one", "two"]);
  expect(node.body).toContain('Array[String](["one", "two"])');
});

test("scene wiring resolves parsed resource calls regardless of attribute order or spacing", async () => {
  const f = fixture();
  f.write("root.gd", "extends Node\nfunc value():\n    return 1\n");
  f.write(
    "scene.tscn",
    '[gd_scene format=3]\n[ext_resource id="script" path="res://root.gd" type="Script"]\n[node name="Root" type="Node"]\nscript = ExtResource( ; a dependency\n "script" )\ntext = "ui.title"\n',
  );
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  expect(attachedScript(project, "scene.tscn")).toBe("root.gd");
  const usages = project.analysis.literalUsages(project, "ui.title");
  expect(usages).toHaveLength(1);
  expect(usages[0]?.related[0]?.path).toBe("root.gd");
});

test("translation usages use decoded values and ignore resource-looking comments and substrings", async () => {
  const f = fixture();
  f.write(
    "data.tres",
    '[gd_resource format=3]\n[sub_resource type="Resource" id="effect"]\nname = "ui.\\u0074itle"\n[sub_resource type="Resource" id="owner"]\nchild = SubResource( "effect" )\n[resource]\n; text = "ui.title"\ntext = "prefix ui.title suffix"\n',
  );
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const usages = project.analysis.literalUsages(project, "ui.title");
  expect(usages).toHaveLength(1);
  expect(usages[0]?.source).toContain('id="owner"');
  expect(usages[0]?.source).not.toContain("prefix ui.title suffix");
  expect(usages[0]?.containsLiteral("ui.title")).toBe(true);
});

test("autoloads use parsed properties and ignore strings containing fake assignments", () => {
  expect(
    autoloads(
      '[autoload]\nApp = "*res://app.gd"\n; Fake="*res://fake.gd"\n[application]\nconfig/description="[autoload]\nOther=not_an_assignment"\n',
    ),
  ).toEqual({ App: "res://app.gd" });
});

test("malformed resources fail instead of supplying a partial dependency graph", async () => {
  await expect(
    new GodotResourceAdapter().parse("broken.tres", "[gd_resource format=3]\n[resource]\nvalue = ["),
  ).rejects.toThrow("broken.tres");
});
