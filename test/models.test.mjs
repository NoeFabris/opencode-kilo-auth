import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "effect";
import { ConfigProvider } from "@opencode/schema/config/provider";
import { fetchKiloModels } from "../dist/index.js";

test("models use the v2 schema, per-million pricing, and native reasoning variants", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.kilo.ai/api/openrouter/models");
    assert.equal(init.headers.Authorization, "Bearer test-token");
    assert.equal(init.headers["X-KILOCODE-ORGANIZATIONID"], "org-test");
    return Response.json({ data: [{
      id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", created: 1748217600,
      context_length: 200000, top_provider: { max_completion_tokens: 64000 },
      pricing: { prompt: "0.000003", completion: "0.000015", input_cache_read: "0.0000003", input_cache_write: "0.00000375" },
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      supported_parameters: ["tools", "reasoning", "temperature"],
    }, {
      id: "image/generator", name: "Images", context_length: 1000,
      architecture: { output_modalities: ["image"] },
    }] });
  };
  const models = await fetchKiloModels({ token: "test-token", organizationId: "org-test" });
  assert.equal(Object.keys(models).length, 1);
  const model = models["anthropic/claude-sonnet-4"];
  assert.equal(model.modelID, "anthropic/claude-sonnet-4");
  assert.equal(model.cost.input, 3);
  assert.equal(model.cost.output, 15);
  assert.equal(model.cost.cache.read, 0.3);
  assert.equal(model.limit.output, 64000);
  assert.equal(model.capabilities.tools, true);
  assert.deepEqual(model.variants.map((variant) => variant.id), ["high", "max"]);
  const config = Schema.decodeUnknownSync(ConfigProvider.Info)({ package: "@opencode/ai/providers/openrouter", models });
  assert.equal(config.models[model.modelID].capabilities.reasoning.supported, true);
});

test("fetch failures propagate instead of emptying the configured inventory", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(null, { status: 503, statusText: "Unavailable" });
  await assert.rejects(fetchKiloModels(), /503/);
});
