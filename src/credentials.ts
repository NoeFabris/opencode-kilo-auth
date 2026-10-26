import type { Plugin } from "@opencode/plugin";
import { ENV_KILO_ORG_ID, KILO_PROVIDER_ID } from "./constants.js";
import { loadStoredAuth } from "./storage.js";

export async function resolveKiloAuth(ctx: Plugin.Context) {
  const connection = await ctx.integration.connection.active(KILO_PROVIDER_ID);
  if (!connection) return undefined;
  const credential = await ctx.integration.connection.resolve(connection);
  const token = credential?.type === "oauth" ? credential.access : credential?.type === "key" ? credential.key : undefined;
  if (!token) return undefined;
  const stored = await loadStoredAuth();
  const organizationId = process.env[ENV_KILO_ORG_ID]
    ?? (typeof credential?.metadata?.organizationId === "string" ? credential.metadata.organizationId : undefined)
    ?? (token === stored?.token ? stored?.organizationId : undefined);
  return { connection, token, organizationId };
}
