import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { Model, Provider } from "@opencode/plugin";
import { registerKiloCatalog } from "../dist/src/catalog.js";

function catalog(id) {
  return { data: [{
    id, name: id, context_length: 200000,
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["tools", "reasoning"],
    pricing: { prompt: "0.000003", completion: "0.000015" },
  }] };
}

async function eventually(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await sleep(5);
  }
  assert.ok(check(), "Expected catalog update did not arrive");
}

async function fixture(t, credential) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-catalog-test-"));
  const originalPath = process.env.KILOCODE_AUTH_PATH;
  const originalFetch = globalThis.fetch;
  process.env.KILOCODE_AUTH_PATH = path.join(dir, "auth.json");
  const lifetime = new AbortController();
  const transformations = [];
  const commands = new Map();
  const notifications = [];
  const queue = [];
  let wake;
  let stop;
  const configured = Model.Info.default(Provider.ID.make("kilo"), Model.ID.make("custom/kept"));
  const ctx = {
    credential, models: new Map([[configured.id, configured]]), commands, notifications,
    emit(event) { queue.push(event); wake?.(); },
    integration: { connection: {
      active: async () => ctx.credential ? { type: "credential", id: ctx.credential.key ?? ctx.credential.access, method: ctx.credential.type === "key" ? "key" : "oauth", label: "Test" } : undefined,
      resolve: async () => ctx.credential,
    } },
    provider: {
      async transform(callback) { transformations.push(callback); await this.reload(); },
      async reload() {
        ctx.models = new Map([[configured.id, configured]]);
        for (const callback of transformations) callback({ models: { update(_providerID, id, update) {
          const model = structuredClone(ctx.models.get(id) ?? Model.Info.default(Provider.ID.make("kilo"), Model.ID.make(id)));
          update(model); ctx.models.set(id, model);
        } } });
      },
    },
    command: { async transform(callback) { callback({ add(command) { commands.set(command.name, command); } }); } },
    session: { async synthetic(input) { notifications.push(input); } },
    event: { async *subscribe({ signal }) {
      while (!signal.aborted) {
        if (!queue.length) await new Promise((resolve) => {
          const done = () => { signal.removeEventListener("abort", done); wake = undefined; resolve(); };
          wake = done; signal.addEventListener("abort", done, { once: true });
          if (signal.aborted) done();
        });
        if (signal.aborted) return;
        while (queue.length) yield queue.shift();
      }
    } },
  };
  t.after(async () => {
    lifetime.abort();
    await stop?.();
    globalThis.fetch = originalFetch;
    if (originalPath === undefined) delete process.env.KILOCODE_AUTH_PATH; else process.env.KILOCODE_AUTH_PATH = originalPath;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { ctx, lifetime, async start() { stop = await registerKiloCatalog(ctx, lifetime.signal); } };
}

test("startup refresh and the native command update /models while preserving configured models", async (t) => {
  const { ctx, start } = await fixture(t, { type: "key", key: "active-key", metadata: { organizationId: "org-one" } });
  let calls = 0;
  let failed = false;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init.headers.Authorization, "Bearer active-key");
    assert.equal(init.headers["X-KILOCODE-ORGANIZATIONID"], "org-one");
    return failed ? new Response(null, { status: 503 }) : Response.json(catalog(`anthropic/catalog-${calls}`));
  };
  await start();
  await eventually(() => ctx.models.has("anthropic/catalog-1"));
  assert.ok(ctx.models.has("custom/kept"));
  assert.equal(ctx.models.get("anthropic/catalog-1").cost[0].input, 3);
  assert.deepEqual(ctx.models.get("anthropic/catalog-1").variants.map((variant) => variant.id), ["high", "max"]);
  const command = ctx.commands.get("kilo-sync-models");
  await command.execute({ sessionID: "test-session" });
  assert.ok(ctx.models.has("anthropic/catalog-2"));
  assert.equal(ctx.models.has("anthropic/catalog-1"), false);
  assert.match(ctx.notifications.at(-1).text, /Refreshed 1 Kilo models/);
  assert.equal(ctx.notifications.at(-1).resume, false);
  failed = true;
  await command.execute({ sessionID: "test-session" });
  assert.match(ctx.notifications.at(-1).text, /Could not refresh.*503/);
  assert.ok(ctx.models.has("anthropic/catalog-2"), "A failed refresh must keep the catalog");
});

test("connecting refreshes automatically, switching accounts drops old discovery, and disconnect clears it", async (t) => {
  const { ctx, start } = await fixture(t);
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    return Response.json(catalog(init.headers.Authorization === "Bearer first" ? "account/first" : "account/second"));
  };
  await start();
  await ctx.commands.get("kilo-sync-models").execute({ sessionID: "test-session" });
  assert.match(ctx.notifications.at(-1).text, /Connect Kilo with \/connect/);
  assert.equal(calls, 0);
  ctx.credential = { type: "key", key: "first" };
  ctx.emit({ type: "credential.switched", data: { integrationID: "kilo" } });
  await eventually(() => ctx.models.has("account/first"));
  ctx.credential = { type: "key", key: "second" };
  ctx.emit({ type: "credential.switched", data: { integrationID: "kilo" } });
  await eventually(() => ctx.models.has("account/second"));
  assert.equal(ctx.models.has("account/first"), false);
  ctx.credential = undefined;
  ctx.emit({ type: "credential.switched", data: { integrationID: "kilo" } });
  await eventually(() => !ctx.models.has("account/second"));
  assert.ok(ctx.models.has("custom/kept"));
});

test("an in-flight refresh cannot publish the previous account's models", async (t) => {
  const { ctx, start } = await fixture(t, { type: "key", key: "old" });
  let oldSignal;
  globalThis.fetch = async (_url, init) => {
    if (init.headers.Authorization === "Bearer old") {
      oldSignal = init.signal;
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    }
    return Response.json(catalog("account/new"));
  };
  await start();
  await eventually(() => oldSignal);
  ctx.credential = { type: "key", key: "new" };
  ctx.emit({ type: "credential.switched", data: { integrationID: "kilo" } });
  await eventually(() => ctx.models.has("account/new"));
  assert.equal(oldSignal.aborted, true);
  assert.equal(ctx.models.has("account/old"), false);
});
