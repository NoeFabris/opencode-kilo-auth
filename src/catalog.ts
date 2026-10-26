import { Model, Provider, type Plugin } from "@opencode/plugin";
import { KILO_PROVIDER_ID } from "./constants.js";
import { resolveKiloAuth } from "./credentials.js";
import { fetchKiloModels, type KiloModelConfig } from "./models.js";

function toModel(config: KiloModelConfig): Model.Info {
  const providerID = Provider.ID.make(KILO_PROVIDER_ID);
  const model = Model.Info.default(providerID, Model.ID.make(config.modelID));
  const price = Model.Cost.fields.input.make;
  return {
    ...model,
    name: config.name,
    ...(config.family ? { family: Model.Family.make(config.family) } : {}),
    capabilities: {
      tools: config.capabilities.tools,
      input: config.capabilities.input,
      output: config.capabilities.output,
      temperature: config.capabilities.temperature,
    },
    limit: config.limit,
    time: { released: config.releaseDate ? Date.parse(config.releaseDate) : 0 },
    variants: (config.variants ?? []).map((variant) => ({ ...variant, id: Model.VariantID.make(variant.id) })),
    cost: config.cost ? [{
      input: price(config.cost.input),
      output: price(config.cost.output),
      cache: { read: price(config.cost.cache?.read ?? 0), write: price(config.cost.cache?.write ?? 0) },
    }] : [],
  };
}

type Auth = Awaited<ReturnType<typeof resolveKiloAuth>>;
function selection(auth: Auth): string | undefined {
  return auth ? JSON.stringify([auth.connection, auth.token, auth.organizationId]) : undefined;
}

export async function registerKiloCatalog(ctx: Plugin.Context, signal: AbortSignal): Promise<() => Promise<void>> {
  let models: Model.Info[] = [];
  let loadedSelection: string | undefined;
  let pending: { selection: string; controller: AbortController; promise: Promise<number> } | undefined;
  const tasks = new Set<Promise<unknown>>();

  await ctx.provider.transform((editor) => {
    for (const model of models) {
      editor.models.update(KILO_PROVIDER_ID, model.id, (draft) => {
        const variants = model.variants.length ? model.variants : draft.variants;
        Object.assign(draft, structuredClone(model), { variants: structuredClone(variants) });
      });
    }
  });

  async function refresh(force = false): Promise<number> {
    signal.throwIfAborted();
    const auth = await resolveKiloAuth(ctx);
    signal.throwIfAborted();
    const key = selection(auth);
    if (!auth || !key) {
      pending?.controller.abort();
      if (models.length) {
        models = [];
        loadedSelection = undefined;
        await ctx.provider.reload();
      }
      if (force) throw new Error("Connect Kilo with /connect before refreshing models.");
      return 0;
    }
    if (pending?.selection === key) return pending.promise;
    if (!force && loadedSelection === key) return models.length;
    pending?.controller.abort();
    const controller = new AbortController();
    const requestSignal = AbortSignal.any([signal, controller.signal]);
    const promise = (async () => {
      if (loadedSelection !== key && models.length) {
        models = [];
        loadedSelection = undefined;
        await ctx.provider.reload();
      }
      const catalog = await fetchKiloModels({ token: auth.token, organizationId: auth.organizationId, signal: requestSignal });
      const next = Object.values(catalog).map(toModel);
      if (!next.length) throw new Error("Kilo returned no language models; the current catalog was kept.");
      requestSignal.throwIfAborted();
      if (selection(await resolveKiloAuth(ctx)) !== key) throw new Error("The Kilo account changed while refreshing models. Please try again.");
      requestSignal.throwIfAborted();
      models = next;
      loadedSelection = key;
      await ctx.provider.reload();
      return models.length;
    })();
    pending = { selection: key, controller, promise };
    try {
      return await promise;
    } finally {
      if (pending?.promise === promise) pending = undefined;
    }
  }

  function refreshInBackground(): void {
    const task = refresh().catch((error) => {
      if (!signal.aborted && error?.name !== "AbortError") {
        console.warn(`[opencode-kilo-auth] Model refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  }

  await ctx.command.transform((editor) => {
    editor.add({
      name: "kilo-sync-models",
      description: "Refresh available Kilo models",
      async execute({ sessionID }) {
        let text: string;
        try {
          const count = await refresh(true);
          text = `Refreshed ${count} Kilo models. Open /models to select one.`;
        } catch (error) {
          if (signal.aborted) return;
          text = `Could not refresh Kilo models: ${error instanceof Error ? error.message : String(error)}`;
        }
        await ctx.session.synthetic({ sessionID, text, description: "Kilo model refresh", resume: false });
      },
    });
  });

  const events = (async () => {
    for await (const event of ctx.event.subscribe({ signal })) {
      if (event.type === "credential.updated"
        || (event.type === "credential.switched" && event.data.integrationID === KILO_PROVIDER_ID)) {
        refreshInBackground();
      }
    }
  })().catch((error) => {
    if (!signal.aborted) console.warn(`[opencode-kilo-auth] Could not watch Kilo account changes: ${error instanceof Error ? error.message : String(error)}`);
  });
  refreshInBackground();

  return async () => {
    await Promise.allSettled([events, ...tasks, ...(pending ? [pending.promise] : [])]);
  };
}
