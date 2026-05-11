# opencode-kilo-auth

Kilo device authorization plugin for OpenCode. It adds a Kilo OAuth device flow and returns tokens to OpenCode, while also storing a copy in a dedicated Kilo auth file.

## Install

```bash
npm install
npm run build
```

## Configure OpenCode

Add the plugin to your `opencode.json` (usually in `~/.config/opencode/opencode.json`).

```json
{
  "plugin": [
    "/path/to/cloned-repo"
  ]
}
```

## Add a Kilo provider

OpenCode does not ship a Kilo provider, so you must define one in `opencode.json`. Minimal example:

```json
{
  "provider": {
    "kilo": {
      "name": "Kilo",
      "api": "https://api.kilo.ai/api/openrouter/",
      "npm": "@openrouter/ai-sdk-provider",
      "env": ["KILO_API_KEY"],
      "options": {
        "baseURL": "https://api.kilo.ai/api/openrouter/"
      },
      "models": {
        "anthropic/claude-sonnet-4": {
          "id": "anthropic/claude-sonnet-4",
          "name": "Claude Sonnet 4",
          "release_date": "2025-01-01",
          "attachment": false,
          "reasoning": true,
          "temperature": true,
          "tool_call": true,
          "limit": {
            "context": 200000,
            "output": 64000
          },
          "options": {
            "description": "Kilo via OpenRouter"
          }
        }
      }
    }
  }
}
```

## CLI auth login (optional)

If you want to use `opencode auth login`, choose **Other** and enter `kilo` as the provider ID.  
This lets the plugin run its device auth flow (and optional org prompt).

## Sync models (manual)

Model sync is now manual to avoid interfering with OpenCode startup.

Run `opencode auth login`, choose **Other**, enter `kilo`, then pick **Kilo (Sync models)**.
It will show the logged-in account and prompt before writing the models into `opencode.json`.

By default it writes to `~/.config/opencode/opencode.json`. Override with `OPENCODE_CONFIG`
or `OPENCODE_CONFIG_DIR`.

### Anthropic reasoning variants (OpenRouter)

OpenRouter supports Anthropic reasoning via the unified `reasoning` parameter (the old
`:thinking` model variants are deprecated). During sync, this plugin injects `high` and
`max` variants for Anthropic models that advertise reasoning support, using:

- `high` → `reasoning: { effort: "high" }`
- `max` → `reasoning: { effort: "xhigh" }`

## Switch organization

Run `opencode auth login`, choose **Other**, enter `kilo`, then pick **Kilo (Switch organization)**.
The picker lists Personal and each org you belong to with the current balance next to each option,
and updates the stored active org for subsequent requests.

## Fetch models (optional)

You can fetch Kilo models into OpenCode’s model format:

```bash
KILO_API_KEY=your_token KILO_ORG_ID=org-123 npm run build
KILO_API_KEY=your_token KILO_ORG_ID=org-123 node dist/scripts/fetch-models.js > kilo-models.json
```

Then paste the JSON into `provider.kilo.models`.

## Auth storage

The plugin also stores tokens in:

```
~/.kilocode/opencode-kilo-auth.json
```

Override with:

```
KILOCODE_AUTH_PATH=/path/to/kilocode-auth.json
```

## Environment variables

- `KILO_API_URL` (optional): Override base API URL (default `https://api.kilo.ai`).
- `KILO_ORG_ID` (optional): Organization ID for team usage.
- `KILOCODE_EDITOR_NAME` (optional): Overrides `X-KILOCODE-EDITORNAME`.
- `KILOCODE_AUTH_PATH` (optional): Override auth file path.

## Notes

- Organization selection is shown automatically during `opencode auth login` if your account has orgs (CLI only), with the current balance shown next to each option. For `/connect`, set `KILO_ORG_ID` or edit the stored auth file.
- `KILO_ORG_ID` takes precedence at request time, so an interactive switch only affects the stored org when the env var is unset.
