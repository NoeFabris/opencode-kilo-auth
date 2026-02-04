import type { Plugin } from "@opencode-ai/plugin";
import * as prompts from "@clack/prompts";
import open from "open";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  KILO_API_BASE,
  KILO_OPENROUTER_BASE,
  TOKEN_EXPIRY_MS,
  ENV_KILO_ORG_ID,
  ENV_KILOCODE_EDITOR_NAME,
  DEFAULT_EDITOR_NAME,
  HEADER_EDITOR_NAME,
  HEADER_ORGANIZATION_ID,
} from "./constants";
import { initiateDeviceAuth, waitForDeviceAuth } from "./device-auth";
import { fetchKiloModels } from "./models";
import { loadStoredAuth, saveStoredAuth } from "./storage";

function getEditorName(): string {
  return process.env[ENV_KILOCODE_EDITOR_NAME] ?? DEFAULT_EDITOR_NAME;
}

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".config", "opencode", "opencode.json");
const ENV_OPENCODE_CONFIG = "OPENCODE_CONFIG";
const ENV_OPENCODE_CONFIG_DIR = "OPENCODE_CONFIG_DIR";
const ENV_OPENCODE_CONFIG_CONTENT = "OPENCODE_CONFIG_CONTENT";

type Organization = {
  id: string;
  name: string;
  role: string;
};

type ProfileResponse = {
  user?: {
    email?: string;
    name?: string;
  };
  email?: string;
  name?: string;
  organizations?: Organization[];
};

async function fetchProfile(token: string): Promise<ProfileResponse> {
  const response = await fetch(`${KILO_API_BASE}/api/profile`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch profile: ${response.status}`);
  }

  return (await response.json()) as ProfileResponse;
}

function shouldPromptForOrg(): boolean {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  return true;
}

function formatAccountLabel(profile?: ProfileResponse): string | undefined {
  const name = profile?.name ?? profile?.user?.name;
  const email = profile?.email ?? profile?.user?.email;
  if (name && email) return `${name} <${email}>`;
  return name ?? email ?? undefined;
}

function resolveOrganization(selection: string | null | undefined, fallback?: string): string | undefined {
  if (selection === undefined) return fallback;
  if (selection === null) return undefined;
  return selection;
}

async function selectOrganization(token: string, profile?: ProfileResponse): Promise<string | null | undefined> {
  if (!shouldPromptForOrg()) return undefined;

  const resolvedProfile = profile ?? (await fetchProfile(token).catch(() => undefined));
  const orgs = resolvedProfile?.organizations ?? [];
  if (orgs.length === 0) return undefined;

  const choice = await prompts.select({
    message: "Select Kilo organization",
    options: [
      { label: "Personal", value: "personal" },
      ...orgs.map((org) => ({
        label: `${org.name} (${org.role})`,
        value: org.id,
      })),
    ],
  });

  if (prompts.isCancel(choice)) return undefined;
  if (choice === "personal") return null;
  return choice;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function addOpenRouterAnthropicVariants(models: Record<string, any>): void {
  for (const model of Object.values(models)) {
    if (!model || typeof model !== "object") continue;
    if (!model.id || !model.reasoning) continue;
    const id = String(model.id).toLowerCase();
    if (!id.startsWith("anthropic/")) continue;

    const variants = typeof model.variants === "object" && model.variants ? { ...model.variants } : {};
    if (!variants.high) {
      variants.high = { reasoning: { effort: "high" } };
    }
    if (!variants.max) {
      variants.max = { reasoning: { effort: "xhigh" } };
    }
    model.variants = variants;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveConfigPath(): Promise<string | null> {
  if (process.env[ENV_OPENCODE_CONFIG_CONTENT]) return null;
  const explicit = process.env[ENV_OPENCODE_CONFIG];
  if (explicit) return explicit;

  const dir = process.env[ENV_OPENCODE_CONFIG_DIR];
  if (dir) {
    const json = path.join(dir, "opencode.json");
    if (await fileExists(json)) return json;
    const jsonc = path.join(dir, "opencode.jsonc");
    if (await fileExists(jsonc)) return jsonc;
    return json;
  }

  return DEFAULT_CONFIG_PATH;
}

async function readConfigFile(filePath: string): Promise<any> {
  const contents = await fs.readFile(filePath, "utf-8").catch(() => "");
  if (!contents.trim()) return {};
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Failed to parse ${filePath} as JSON. Convert to JSON or remove comments.`);
  }
}

async function writeConfigFile(filePath: string, config: any): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify(config, null, 2);
  await fs.writeFile(filePath, `${payload}\n`, "utf-8");
}

async function syncModels(input: { client: any }, token: string, organizationId?: string): Promise<void> {
  const configPath = await resolveConfigPath();
  if (!configPath) {
    prompts.log.warn(
      "[opencode-kilo-auth] OPENCODE_CONFIG_CONTENT is set; cannot update opencode.json automatically.",
    );
    return;
  }

  const config = await readConfigFile(configPath).catch((error) => {
    prompts.log.error(String(error));
    return null;
  });
  if (!config) return;

  const models = await fetchKiloModels({ token, organizationId, timeoutMs: 10_000 }).catch(() => ({}));
  if (Object.keys(models).length === 0) return;
  addOpenRouterAnthropicVariants(models);
  const provider = config.provider ?? {};
  const existing = provider.kilo ?? {};
  const baseUrl = ensureTrailingSlash(KILO_OPENROUTER_BASE);

  const mergedModels = { ...models };

  const nextProvider = {
    ...existing,
    name: existing.name ?? "Kilo",
    api: existing.api ?? baseUrl,
    npm: existing.npm ?? "@openrouter/ai-sdk-provider",
    env: existing.env ?? ["KILO_API_KEY"],
    options: {
      ...(existing.options ?? {}),
      baseURL: existing.options?.baseURL ?? baseUrl,
    },
    models: mergedModels,
  };

  const nextConfig = {
    ...config,
    provider: {
      ...provider,
      kilo: nextProvider,
    },
  };

  await writeConfigFile(configPath, nextConfig).catch((error) => {
    prompts.log.error(String(error));
  });
}

export const KiloAuthPlugin: Plugin = async (input) => {
  return {
    auth: {
      provider: "kilo",
      async loader(getAuth) {
        const auth = await getAuth().catch(() => undefined);
        const stored = await loadStoredAuth();

        const token =
          auth?.type === "oauth"
            ? auth.access
            : auth?.type === "api"
              ? auth.key
              : stored?.token;

        if (!token) return {};

        const organizationId = process.env[ENV_KILO_ORG_ID] ?? stored?.organizationId;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "User-Agent": "opencode-kilo-auth",
          [HEADER_EDITOR_NAME]: getEditorName(),
        };

        if (organizationId) {
          headers[HEADER_ORGANIZATION_ID] = organizationId;
        }

        return {
          apiKey: token,
          baseURL: KILO_OPENROUTER_BASE,
          headers,
        };
      },
      methods: [
        {
          type: "oauth",
          label: "Kilo (Device Authorization)",
          async authorize() {
            const auth = await initiateDeviceAuth();
            const { code, verificationUrl, expiresIn } = auth;

            await open(verificationUrl).catch(() => {
              // If the browser cannot be opened, the user can visit manually.
            });

            return {
              url: verificationUrl,
              instructions: `Open ${verificationUrl} and enter code: ${code}`,
              method: "auto",
              callback: async () => {
                const result = await waitForDeviceAuth(code, expiresIn);

                if (result.status !== "approved" || !result.token) {
                  return { type: "failed" };
                }

                const stored = await loadStoredAuth();
                const selectedOrg =
                  process.env[ENV_KILO_ORG_ID] ?? (await selectOrganization(result.token).catch(() => undefined));
                const organizationId = resolveOrganization(selectedOrg, stored?.organizationId);
                await saveStoredAuth({
                  token: result.token,
                  organizationId,
                  updatedAt: Date.now(),
                });

                return {
                  type: "success",
                  refresh: result.token,
                  access: result.token,
                  expires: Date.now() + TOKEN_EXPIRY_MS,
                };
              },
            };
          },
        },
        {
          type: "oauth",
          label: "Kilo (Sync models)",
          async authorize() {
            if (!shouldPromptForOrg()) {
              return {
                url: "",
                method: "auto",
                instructions: "Kilo model sync is only available in the CLI.",
                callback: async () => ({ type: "failed" }),
              };
            }

            const stored = await loadStoredAuth();
            if (!stored?.token) {
              return {
                url: "",
                method: "auto",
                instructions: "No stored Kilo auth found. Run Kilo (Device Authorization) first.",
                callback: async () => ({ type: "failed" }),
              };
            }

            const profile = await fetchProfile(stored.token).catch(() => undefined);
            const label = formatAccountLabel(profile);
            if (label) {
              prompts.log.info(`Kilo account: ${label}`);
            }

            const selectedOrg =
              process.env[ENV_KILO_ORG_ID] ?? (await selectOrganization(stored.token, profile).catch(() => undefined));
            const organizationId = resolveOrganization(selectedOrg, stored.organizationId);

            const confirm = await prompts.confirm({
              message: "Sync Kilo models into opencode.json now?",
              initialValue: true,
            });
            if (prompts.isCancel(confirm) || !confirm) {
              return {
                url: "",
                method: "auto",
                instructions: "Sync cancelled.",
                callback: async () => ({ type: "failed" }),
              };
            }

            return {
              url: "",
              instructions: "Syncing Kilo models...",
              method: "auto",
              callback: async () => {
                await syncModels(input, stored.token, organizationId);
                await saveStoredAuth({
                  token: stored.token,
                  organizationId,
                  updatedAt: Date.now(),
                });

                return {
                  type: "success",
                  refresh: stored.token,
                  access: stored.token,
                  expires: Date.now() + TOKEN_EXPIRY_MS,
                };
              },
            };
          },
        },
      ],
    },
    async config(config) {
      const providers = config.provider ?? {};

      if (!providers.kilo) {
        console.log(
          "[opencode-kilo-auth] provider.kilo is missing from opencode.json. Add a provider entry to enable Kilo models.",
        );
      }
    },
  };
};

export default KiloAuthPlugin;
