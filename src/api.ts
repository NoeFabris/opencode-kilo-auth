import {
  KILO_API_BASE,
  HEADER_EDITOR_NAME,
  HEADER_ORGANIZATION_ID,
  ENV_KILOCODE_EDITOR_NAME,
  DEFAULT_EDITOR_NAME,
} from "./constants";

export type Organization = {
  id: string;
  name: string;
  role: string;
};

export type ProfileResponse = {
  user?: {
    email?: string;
    name?: string;
  };
  email?: string;
  name?: string;
  organizations?: Organization[];
};

function getEditorName(): string {
  return process.env[ENV_KILOCODE_EDITOR_NAME] ?? DEFAULT_EDITOR_NAME;
}

function buildHeaders(token: string, organizationId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    [HEADER_EDITOR_NAME]: getEditorName(),
  };
  if (organizationId) {
    headers[HEADER_ORGANIZATION_ID] = organizationId;
  }
  return headers;
}

export async function fetchProfile(token: string, organizationId?: string): Promise<ProfileResponse> {
  const response = await fetch(`${KILO_API_BASE}/api/profile`, {
    headers: buildHeaders(token, organizationId),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch profile: ${response.status}`);
  }

  return (await response.json()) as ProfileResponse;
}

export async function fetchBalance(token: string, organizationId?: string): Promise<number | null> {
  try {
    const response = await fetch(`${KILO_API_BASE}/api/profile/balance`, {
      headers: buildHeaders(token, organizationId),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { balance?: number };
    return typeof body.balance === "number" ? body.balance : null;
  } catch {
    return null;
  }
}

export function formatBalance(value: number | null): string {
  if (value === null) return "balance unavailable";
  return `$${value.toFixed(2)}`;
}
