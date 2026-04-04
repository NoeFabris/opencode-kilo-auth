export const ENV_KILO_API_URL = "KILO_API_URL";
export const DEFAULT_KILO_API_URL = "https://api.kilo.ai";

export const KILO_API_BASE = process.env[ENV_KILO_API_URL] ?? DEFAULT_KILO_API_URL;
export const KILO_OPENROUTER_BASE = `${KILO_API_BASE}/api/openrouter`;

export const ENV_KILO_ORG_ID = "KILO_ORG_ID";
export const ENV_KILOCODE_AUTH_PATH = "KILOCODE_AUTH_PATH";
export const ENV_KILOCODE_EDITOR_NAME = "KILOCODE_EDITOR_NAME";

export const POLL_INTERVAL_MS = 3000;
export const TOKEN_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

export const HEADER_ORGANIZATION_ID = "X-KILOCODE-ORGANIZATIONID";
export const HEADER_EDITOR_NAME = "X-KILOCODE-EDITORNAME";

export const DEFAULT_EDITOR_NAME = "opencode";
