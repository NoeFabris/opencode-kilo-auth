import { setTimeout as sleep } from "node:timers/promises";
import { KILO_API_BASE, POLL_INTERVAL_MS } from "./constants.js";

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

export async function initiateDeviceAuth(signal?: AbortSignal): Promise<DeviceAuthInitiateResponse> {
  const response = await fetch(`${KILO_API_BASE}/api/device-auth/codes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
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

async function pollDeviceAuth(code: string, signal: AbortSignal): Promise<DeviceAuthPollResponse> {
  const response = await fetch(`${KILO_API_BASE}/api/device-auth/codes/${encodeURIComponent(code)}`, { signal });

  if (response.status === 202) return { status: "pending" };
  if (response.status === 403) return { status: "denied" };
  if (response.status === 410) return { status: "expired" };

  if (!response.ok) {
    throw new Error(`Failed to poll device authorization: ${response.status}`);
  }

  const data = (await response.json()) as DeviceAuthPollResponse;
  return data;
}

export async function waitForDeviceAuth(code: string, expiresIn: number, signal?: AbortSignal): Promise<DeviceAuthPollResponse> {
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return { status: "expired" };
  const deadline = AbortSignal.timeout(Math.ceil(expiresIn * 1000));
  const lifetime = AbortSignal.any([deadline, ...(signal ? [signal] : [])]);
  try {
    while (true) {
      lifetime.throwIfAborted();
      const result = await pollDeviceAuth(code, AbortSignal.any([lifetime, AbortSignal.timeout(10_000)]));
      if (result.status !== "pending") return result;
      await sleep(POLL_INTERVAL_MS, undefined, { signal: lifetime });
    }
  } catch (error) {
    if (deadline.aborted && !signal?.aborted) return { status: "expired" };
    throw error;
  }
}
