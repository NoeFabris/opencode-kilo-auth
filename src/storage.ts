import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ENV_KILOCODE_AUTH_PATH } from "./constants";

export type StoredAuth = {
  token: string;
  organizationId?: string;
  updatedAt: number;
};

const DEFAULT_AUTH_PATH = path.join(os.homedir(), ".kilocode", "opencode-kilo-auth.json");

export function getAuthPath(): string {
  return process.env[ENV_KILOCODE_AUTH_PATH] ?? DEFAULT_AUTH_PATH;
}

export async function loadStoredAuth(): Promise<StoredAuth | null> {
  const file = getAuthPath();
  const data = await fs.readFile(file, "utf-8").catch(() => "");
  if (!data) return null;

  try {
    const parsed = JSON.parse(data) as StoredAuth;
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveStoredAuth(auth: StoredAuth): Promise<void> {
  const file = getAuthPath();
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const payload = JSON.stringify(auth, null, 2);
  await fs.writeFile(file, payload, { mode: 0o600 });
}
