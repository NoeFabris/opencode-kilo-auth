import { KILO_API_BASE, POLL_INTERVAL_MS } from "./constants";

export type DeviceAuthInitiateResponse = {
  code: string;
  verificationUrl: string;
  expiresIn: number;
};

export type DeviceAuthPollResponse = {
  status: "pending" | "approved" | "denied" | "expired";
  token?: string;
  userEmail?: string;
};

export async function initiateDeviceAuth(): Promise<DeviceAuthInitiateResponse> {
  const response = await fetch(`${KILO_API_BASE}/api/device-auth/codes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Too many pending authorization requests. Please try again later.");
    }
    throw new Error(`Failed to initiate device authorization: ${response.status}`);
  }

  const data = (await response.json()) as DeviceAuthInitiateResponse;
  return data;
}

async function pollDeviceAuth(code: string): Promise<DeviceAuthPollResponse> {
  const response = await fetch(`${KILO_API_BASE}/api/device-auth/codes/${code}`);

  if (response.status === 202) return { status: "pending" };
  if (response.status === 403) return { status: "denied" };
  if (response.status === 410) return { status: "expired" };

  if (!response.ok) {
    throw new Error(`Failed to poll device authorization: ${response.status}`);
  }

  const data = (await response.json()) as DeviceAuthPollResponse;
  return data;
}

export async function waitForDeviceAuth(code: string, expiresIn: number): Promise<DeviceAuthPollResponse> {
  const maxAttempts = Math.ceil((expiresIn * 1000) / POLL_INTERVAL_MS);

  for (const _ of Array.from({ length: maxAttempts })) {
    const result = await pollDeviceAuth(code);

    if (result.status === "approved") return result;
    if (result.status === "denied") return result;
    if (result.status === "expired") return result;

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { status: "expired" };
}
