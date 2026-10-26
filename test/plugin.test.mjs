import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import plugin from "../dist/index.js";

function context({ credential, imported = false } = {}) {
  const methods = new Map();
  const state = new Map(imported ? [["legacy-auth-imported", true]] : []);
  const provider = { id: "kilo", name: "Existing Kilo", package: "@openrouter/ai-sdk-provider", settings: { baseURL: "https://custom.example/api" }, headers: { "x-custom": "kept" } };
  const ctx = {
    methods, provider, imports: [], credential,
    provider: {
      async transform(callback) {
        callback({ get: () => ({ provider, models: new Map() }), update: (_id, update) => update(provider), models: { update() {} } });
      },
      async reload() {},
    },
    integration: {
      async transform(callback) { callback({ method: { update: (registration) => methods.set(registration.method.id ?? registration.method.type, registration) } }); },
      connection: {
        active: async () => ctx.credential ? { type: "credential", id: "test" } : undefined,
        resolve: async () => ctx.credential,
      },
      connect: { async key(input) { ctx.imports.push(input); ctx.credential = { type: "key", key: input.key, metadata: input.answer }; } },
    },
    storage: { get: async (key) => state.get(key), set: async (key, value) => state.set(key, value) },
    session: {
      async hook(name, callback, scope) { assert.equal(name, "model.request"); assert.deepEqual(scope, { providerID: "kilo" }); ctx.request = callback; },
      async synthetic() {},
    },
    command: { async transform() {} },
    event: {
      async *subscribe({ signal }) {
        if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      },
    },
  };
  ctx.providerInfo = provider;
  return ctx;
}

test("v2 device flow, organization metadata, account switches, and disconnect", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-plugin-test-"));
  const originalFetch = globalThis.fetch;
  const originalPath = process.env.KILOCODE_AUTH_PATH;
  process.env.KILOCODE_AUTH_PATH = path.join(dir, "auth.json");
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (originalPath === undefined) delete process.env.KILOCODE_AUTH_PATH; else process.env.KILOCODE_AUTH_PATH = originalPath;
    await fs.rm(dir, { recursive: true, force: true });
  });

  assert.equal(plugin.id, "opencode-kilo-auth");
  const ctx = context();
  const cleanup = await plugin.setup(ctx);
  t.after(cleanup);
  assert.equal(ctx.providerInfo.package, "@opencode/ai/providers/openrouter");
  assert.equal(ctx.providerInfo.settings.baseURL, "https://custom.example/api");
  assert.equal(ctx.providerInfo.headers["x-custom"], "kept");
  assert.ok(ctx.methods.has("env"));
  const oauth = ctx.methods.get("device");
  globalThis.fetch = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    if (options.method === "POST") return Response.json({ code: "AB/CD", verificationUrl: "https://kilo.ai/verify", expiresIn: 60 });
    assert.ok(String(url).endsWith("AB%2FCD"));
    return Response.json({ status: "approved", token: "device-token", userEmail: "test@example.com" });
  };
  const attempt = await oauth.authorize({ organizationId: "org-team" });
  assert.equal(attempt.mode, "auto");
  assert.ok(attempt.callback instanceof Promise);
  const credential = await attempt.callback;
  assert.equal(credential.methodID, "device");
  assert.equal(credential.metadata.organizationId, "org-team");
  assert.equal(oauth.label(credential), "test@example.com");
  assert.equal((await fs.stat(process.env.KILOCODE_AUTH_PATH)).mode & 0o777, 0o600);
  ctx.credential = credential;
  const request = { headers: {} };
  await ctx.request(request);
  assert.equal(request.headers.Authorization, "Bearer device-token");
  assert.equal(request.headers["X-KILOCODE-ORGANIZATIONID"], "org-team");

  ctx.credential = { type: "key", key: "different-account", metadata: { organizationId: "" } };
  const personal = { headers: { authorization: "Bearer old-token", "x-kilocode-organizationid": "stale-org" } };
  await ctx.request(personal);
  assert.equal(personal.headers.Authorization, "Bearer different-account");
  assert.equal(personal.headers["X-KILOCODE-ORGANIZATIONID"], undefined);
  assert.equal(personal.headers["x-kilocode-organizationid"], undefined);
  assert.equal(personal.headers.authorization, undefined);
  ctx.credential = undefined;
  const disconnected = { headers: {} };
  await ctx.request(disconnected);
  assert.deepEqual(disconnected.headers, {});
});

test("legacy login is imported once and never replaces an active connection", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-import-test-"));
  const previous = process.env.KILOCODE_AUTH_PATH;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [{ id: "test/model", name: "Test", context_length: 1000 }] });
  process.env.KILOCODE_AUTH_PATH = path.join(dir, "auth.json");
  await fs.writeFile(process.env.KILOCODE_AUTH_PATH, JSON.stringify({ token: "saved-token", organizationId: "saved-org", updatedAt: 1 }));
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.KILOCODE_AUTH_PATH; else process.env.KILOCODE_AUTH_PATH = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const ctx = context();
  t.after(await plugin.setup(ctx));
  assert.equal(ctx.imports.length, 1);
  assert.equal(ctx.imports[0].answer.organizationId, "saved-org");
  ctx.credential = undefined;
  t.after(await plugin.setup(ctx));
  assert.equal(ctx.imports.length, 1);
  const active = context({ credential: { type: "key", key: "other" } });
  t.after(await plugin.setup(active));
  assert.equal(active.imports.length, 0);
});

test("denied device authorization rejects and unloading cancels polling", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const ctx = context({ imported: true });
  const cleanup = await plugin.setup(ctx);
  globalThis.fetch = async (_url, options) => options.method === "POST"
    ? Response.json({ code: "deny", verificationUrl: "https://kilo.ai/verify", expiresIn: 60 })
    : new Response(null, { status: 403 });
  const attempt = await ctx.methods.get("device").authorize({});
  await assert.rejects(attempt.callback, /denied/);
  globalThis.fetch = async (_url, options) => options.method === "POST"
    ? Response.json({ code: "wait", verificationUrl: "https://kilo.ai/verify", expiresIn: 60 })
    : new Response(null, { status: 202 });
  const pending = await ctx.methods.get("device").authorize({});
  cleanup();
  await assert.rejects(pending.callback, { name: "AbortError" });
});
