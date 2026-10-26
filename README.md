# opencode-kilo-auth

Kilo device authorization for **OpenCode v2.1.4 and newer**. This version uses the v2 integration and provider APIs; OpenCode v1 needs the older plugin release.

## Build and install

Requires Node.js 20 or newer.

```bash
npm ci
npm run build
npm test
npm run install:opencode
```

The installer copies a self-contained build to:

```text
~/.local/share/opencode/plugin-builds/kilo-auth-v2.0.1/
```

It enables that directory in `~/.config/opencode/opencode.json` or `opencode.jsonc`, preserves unrelated settings and JSONC comments, and creates a dated backup before changing an existing config. `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME`, and `XDG_DATA_HOME` are respected. Existing Kilo plugin entries are replaced; other plugins are kept.

Restart OpenCode, or run `opencode reload` to load the plugin in an already running service. Verify it with `opencode plugin list`.

To configure a build yourself, add its **directory** to the v2 `plugins` array:

```json
{
  "plugins": ["/path/to/cloned-repo/dist"]
}
```

The bundled `dist` directory can be loaded without installing its runtime dependencies elsewhere.

## Connect Kilo

```bash
opencode auth login kilo --method device
```

You can also use `/connect`, select **Kilo**, and choose **Kilo (Device Authorization)**. Open the displayed URL and enter the device code. Organization selection is a form field in both the CLI and `/connect`: enter the organization ID, or leave it blank for a personal account. `KILO_ORG_ID` overrides the form.

API keys and `KILO_API_KEY` are also supported. OpenCode manages the active credential; switching accounts updates request authentication and organization headers immediately.

A login previously saved in `~/.kilocode/opencode-kilo-auth.json` is imported once if OpenCode has no active Kilo connection. An existing connection is preserved. Disconnecting afterward does not trigger another import.

## Sync models

Kilo models refresh automatically inside OpenCode when the plugin loads and when you connect or switch Kilo accounts. The refresh runs in the background and updates `/models` without rewriting your configuration or removing your custom models.

To refresh the catalog yourself, use the built-in command picker or type:

```text
/kilo-sync-models
```

The command uses your active OpenCode Kilo connection, including the selected organization, and makes refreshed models available immediately. A failed refresh keeps the last successful catalog for that account. You do not need to run an npm command for normal use.

The optional `npm run sync-models` maintenance script exports the catalog into `providers.kilo.models` for a configuration you want to keep on disk. That script supports JSON/JSONC, backs up existing files, and migrates only a legacy `provider.kilo` entry. It replaces the model definitions in that file; the normal in-app refresh leaves them unchanged.

A minimal native v2 provider configuration is:

```json
{
  "providers": {
    "kilo": {
      "name": "Kilo",
      "env": ["KILO_API_KEY"],
      "package": "@opencode/ai/providers/openrouter",
      "settings": {
        "baseURL": "https://api.kilo.ai/api/openrouter"
      },
      "models": {
        "anthropic/claude-sonnet-4": {
          "name": "Claude Sonnet 4",
          "capabilities": {
            "tools": true,
            "input": ["text", "image"],
            "output": ["text"],
            "reasoning": { "supported": true }
          },
          "limit": { "context": 200000, "output": 64000 }
        }
      }
    }
  }
}
```

Existing legacy provider definitions remain readable by OpenCode v2. Anthropic reasoning models receive `high` and `max` variants using native v2 `body.reasoning` settings. Model prices are converted from Kilo's per-token prices to OpenCode's per-million-token units.

To print model definitions without changing configuration:

```bash
npm run models --silent > kilo-models.json
```

## Auth storage and environment

Device logins are also saved with owner-only permissions in:

```text
~/.kilocode/opencode-kilo-auth.json
```

| Variable | Purpose |
| --- | --- |
| `KILO_API_KEY` | API key or token used for model fetching and environment authentication. |
| `KILO_API_URL` | Base API URL; defaults to `https://api.kilo.ai`. |
| `KILO_ORG_ID` | Organization ID for team usage. |
| `KILOCODE_EDITOR_NAME` | Overrides the `X-KILOCODE-EDITORNAME` header. |
| `KILOCODE_AUTH_PATH` | Overrides the saved Kilo auth file path. |

## v2 migration reference

The implementation follows OpenCode's [v1 plugin migration guide](https://dev.opencode.ai/v2/docs/build/plugins/migrate-v1/): a default `Plugin.define` export registers integration methods and a provider-scoped request hook through `setup(ctx)`. It uses the native OpenRouter runtime in place of the v1 AI SDK adapter.
