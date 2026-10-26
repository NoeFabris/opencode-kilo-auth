import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { parse } from "jsonc-parser";

test("installation preserves JSONC and providers, makes a backup, and loads without node_modules", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-install-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "opencode.jsonc");
  const original = `{
  // Keep this comment and the other plugins.
  "plugin": ["other-plugin", "/old/opencode-kilo-auth"],
  "plugins": [{"package":"another-plugin","options":{"enabled":true}}],
  "provider": {"kilo":{"name":"My Kilo","models":{"custom-model":{}}}},
  "model": "kilo/custom-model",
}\n`;
  await fs.writeFile(file, original, { mode: 0o600 });
  const env = { ...process.env, OPENCODE_CONFIG: file, XDG_DATA_HOME: path.join(dir, "data") };
  delete env.OPENCODE_CONFIG_CONTENT;
  const run = () => spawnSync(process.execPath, ["dist/scripts/install.js"], { env, encoding: "utf8" });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const contents = await fs.readFile(file, "utf8");
  assert.ok(contents.includes("// Keep this comment"));
  const config = parse(contents);
  assert.equal(config.plugin, undefined);
  assert.equal(config.plugins.length, 3);
  assert.equal(config.plugins[0], "other-plugin");
  assert.deepEqual(config.provider.kilo.models, { "custom-model": {} });
  assert.equal(config.model, "kilo/custom-model");
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const backups = (await fs.readdir(dir)).filter((name) => name.includes(".bak-kilo-v2-"));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(dir, backups[0]), "utf8"), original);
  const installed = await import(pathToFileURL(path.join(config.plugins.at(-1), "index.js")));
  assert.equal(installed.default.id, "opencode-kilo-auth");
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await fs.readFile(file, "utf8"), contents);
});

test("invalid configuration is left intact", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-invalid-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "opencode.json");
  await fs.writeFile(file, "{invalid");
  const result = spawnSync(process.execPath, ["dist/scripts/install.js"], {
    env: { ...process.env, OPENCODE_CONFIG: file, OPENCODE_CONFIG_CONTENT: "", XDG_DATA_HOME: path.join(dir, "data") }, encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.equal(await fs.readFile(file, "utf8"), "{invalid");
  assert.deepEqual(await fs.readdir(dir), ["opencode.json"]);
});
