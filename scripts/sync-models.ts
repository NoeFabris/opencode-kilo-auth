import { KILO_OPENROUTER_BASE, KILO_PROVIDER_PACKAGE } from "../src/constants.js";
import { patchConfigFile, readConfigFile, resolveConfigPath } from "../src/config.js";
import { fetchKiloModels } from "../src/models.js";
import { loadStoredAuth } from "../src/storage.js";

const file = await resolveConfigPath();
const config = await readConfigFile(file);
const stored = await loadStoredAuth();
const models = await fetchKiloModels({
  token: process.env.KILO_API_KEY ?? stored?.token,
  organizationId: process.env.KILO_ORG_ID ?? stored?.organizationId,
});
if (!Object.keys(models).length) throw new Error("Kilo returned no language models; the configuration has not been changed.");

const legacy = config.provider?.kilo ?? {};
const existing = config.providers?.kilo ?? {};
const { headers: legacyHeaders, ...legacySettings } = legacy.options ?? {};
const provider = {
  ...existing,
  name: existing.name ?? legacy.name ?? "Kilo",
  env: existing.env ?? legacy.env ?? ["KILO_API_KEY"],
  package: existing.package ?? (legacy.npm && legacy.npm !== "@openrouter/ai-sdk-provider" ? legacy.npm : KILO_PROVIDER_PACKAGE),
  settings: { baseURL: legacy.api ?? KILO_OPENROUTER_BASE, ...legacySettings, ...existing.settings },
  ...(legacyHeaders || existing.headers ? { headers: { ...legacyHeaders, ...existing.headers } } : {}),
  models,
};
const changes: Array<{ path: string[]; value: unknown }> = [{ path: ["providers", "kilo"], value: provider }];
if (config.provider?.kilo) changes.push({ path: ["provider", "kilo"], value: undefined });
const backup = await patchConfigFile(file, changes);
console.log(`Synced ${Object.keys(models).length} Kilo models to ${file}`);
if (backup) console.log(`Backup: ${backup}`);
