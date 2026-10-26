import { Credential, Integration, Plugin, Provider } from "@opencode/plugin";
import {
  DEFAULT_EDITOR_NAME,
  ENV_KILO_ORG_ID,
  ENV_KILOCODE_EDITOR_NAME,
  HEADER_EDITOR_NAME,
  HEADER_ORGANIZATION_ID,
  KILO_OAUTH_METHOD_ID,
  KILO_OPENROUTER_BASE,
  KILO_PROVIDER_ID,
  KILO_PROVIDER_PACKAGE,
  TOKEN_EXPIRY_MS,
} from "./constants.js";
import { initiateDeviceAuth, waitForDeviceAuth } from "./device-auth.js";
import { loadStoredAuth, saveStoredAuth } from "./storage.js";
import { resolveKiloAuth } from "./credentials.js";
import { registerKiloCatalog } from "./catalog.js";

export const KiloAuthPlugin = Plugin.define({
  id: "opencode-kilo-auth",
  async setup(ctx) {
    const lifetime = new AbortController();
    const stored = await loadStoredAuth();
    const organizationForm = [{
      key: "organizationId",
      type: "string" as const,
      title: "Kilo organization ID (optional)",
      description: "Leave blank to use your personal account.",
      default: process.env[ENV_KILO_ORG_ID] ?? stored?.organizationId ?? "",
    }] as const;

    await ctx.provider.transform((editor) => {
      if (!editor.get(KILO_PROVIDER_ID)) {
        editor.add({
          info: {
            ...Provider.Info.empty(Provider.ID.make(KILO_PROVIDER_ID)),
            name: "Kilo",
            integrationID: Integration.ID.make(KILO_PROVIDER_ID),
            package: KILO_PROVIDER_PACKAGE,
            settings: { baseURL: KILO_OPENROUTER_BASE },
          },
          models: [],
        });
      }
      editor.update(KILO_PROVIDER_ID, (provider) => {
        provider.integrationID = Integration.ID.make(KILO_PROVIDER_ID);
        if (!provider.package || provider.package === "@openrouter/ai-sdk-provider") {
          provider.package = KILO_PROVIDER_PACKAGE;
        }
        provider.settings = { baseURL: KILO_OPENROUTER_BASE, ...provider.settings };
        provider.headers = {
          ...provider.headers,
          [HEADER_EDITOR_NAME]: process.env[ENV_KILOCODE_EDITOR_NAME] ?? DEFAULT_EDITOR_NAME,
        };
      });
    });

    await ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: KILO_PROVIDER_ID,
        method: {
          id: KILO_OAUTH_METHOD_ID,
          type: "oauth",
          label: "Kilo (Device Authorization)",
          form: organizationForm,
        },
        async authorize(answer) {
          const auth = await initiateDeviceAuth(lifetime.signal);
          const organizationId = (process.env[ENV_KILO_ORG_ID] ?? String(answer.organizationId ?? "")).trim();
          const callback = (async (): Promise<Credential.OAuth> => {
            const result = await waitForDeviceAuth(auth.code, auth.expiresIn, lifetime.signal);
            if (result.status !== "approved" || !result.token) {
              throw new Error(`Kilo device authorization ${result.status}. Please try signing in again.`);
            }
            lifetime.signal.throwIfAborted();
            await saveStoredAuth({ token: result.token, organizationId: organizationId || undefined, updatedAt: Date.now() });
            return {
              type: "oauth",
              methodID: Integration.MethodID.make(KILO_OAUTH_METHOD_ID),
              access: result.token,
              refresh: result.token,
              expires: Date.now() + TOKEN_EXPIRY_MS,
              metadata: { organizationId, ...(result.userEmail ? { email: result.userEmail } : {}) },
            };
          })();
          // The server consumes this promise after authorize returns.
          void callback.catch(() => {});
          return {
            url: auth.verificationUrl,
            instructions: `Open ${auth.verificationUrl} and enter code: ${auth.code}`,
            expiresAt: Date.now() + auth.expiresIn * 1000,
            mode: "auto",
            callback,
          };
        },
        label: (credential) => typeof credential.metadata?.email === "string" ? credential.metadata.email : undefined,
      });
      editor.method.update({ integrationID: KILO_PROVIDER_ID, method: { type: "key", label: "Kilo API key", form: organizationForm } });
      editor.method.update({ integrationID: KILO_PROVIDER_ID, method: { type: "env", names: ["KILO_API_KEY"] } });
    });

    // Import the legacy file once. Disconnecting in OpenCode must stay disconnected.
    if (await ctx.storage.get("legacy-auth-imported") !== true) {
      const active = await ctx.integration.connection.active(KILO_PROVIDER_ID);
      if (!active && stored?.token) {
        await ctx.integration.connect.key({
          integrationID: KILO_PROVIDER_ID,
          key: stored.token,
          answer: { organizationId: process.env[ENV_KILO_ORG_ID] ?? stored.organizationId ?? "" },
          label: "Imported Kilo login",
        });
      }
      await ctx.storage.set("legacy-auth-imported", true);
    }

    await ctx.session.hook("model.request", async (event) => {
      const auth = await resolveKiloAuth(ctx);
      if (!auth) return;
      const { token, organizationId } = auth;
      for (const header of Object.keys(event.headers)) {
        if (["authorization", HEADER_ORGANIZATION_ID.toLowerCase()].includes(header.toLowerCase())) delete event.headers[header];
      }
      event.headers.Authorization = `Bearer ${token}`;
      event.headers[HEADER_EDITOR_NAME] = process.env[ENV_KILOCODE_EDITOR_NAME] ?? DEFAULT_EDITOR_NAME;
      if (organizationId) event.headers[HEADER_ORGANIZATION_ID] = organizationId;
    }, { providerID: KILO_PROVIDER_ID });

    const stopCatalog = await registerKiloCatalog(ctx, lifetime.signal);
    return async () => {
      lifetime.abort();
      await stopCatalog();
    };
  },
});

export default KiloAuthPlugin;
