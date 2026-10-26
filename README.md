# opencode-kilo-auth

Kilo device authorization and automatic model discovery for **OpenCode v2.1.4 and newer**. Connect your Kilo account inside OpenCode, choose a personal or organization account, and select a model with `/models`.

## Distribution

Install this plugin from [NoeFabris/opencode-kilo-auth](https://github.com/NoeFabris/opencode-kilo-auth) using the instructions below. Its package name, `opencode-kilo-authentication`, currently has no public npm release.

The npm package named `opencode-kilo-auth` links to a different repository. Use this GitHub checkout to install this implementation. The `npm` commands below install this checkout's dependencies and build it locally.

## Install from GitHub

Requires Node.js 20 or newer and OpenCode v2.1.4 or newer. OpenCode v1 needs an older version of this plugin.

```bash
git clone https://github.com/NoeFabris/opencode-kilo-auth.git
cd opencode-kilo-auth
npm ci
npm run build
npm run install:opencode
```

The installer copies a self-contained build into a versioned directory, currently:

```text
~/.local/share/opencode/plugin-builds/kilo-auth-v2.0.1/
```

It enables that directory in `~/.config/opencode/opencode.json` or `opencode.jsonc`. Existing Kilo plugin entries are replaced; other plugins, provider settings, custom models, and JSONC comments are preserved. A dated backup is created before an existing configuration is changed.

Restart OpenCode or run `opencode reload` to load the new build in a running service. Check installation with:

```bash
opencode plugin list
```

The active plugin ID is `opencode-kilo-auth`.

The installer respects `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME`, and `XDG_DATA_HOME`. If you use `OPENCODE_CONFIG_CONTENT`, add the plugin directory to that inline configuration yourself.

To configure a built checkout manually, add its **directory** to the v2 `plugins` array:

```json
{
  "plugins": ["/absolute/path/to/opencode-kilo-auth/dist"]
}
```

The bundled `dist` directory includes its runtime dependencies.

## Connect Kilo

Inside OpenCode:

1. Run `/connect` and select **Kilo**.
2. Choose **Kilo (Device Authorization)**.
3. Enter an organization ID, or leave it blank for a personal account.
4. Open the displayed authorization URL and enter the device code.
5. Open `/models` to select a Kilo model.

You can also connect from the terminal:

```bash
opencode auth login kilo --method device
```

API keys and `KILO_API_KEY` are supported. `KILO_ORG_ID` overrides the organization form field. Switching accounts updates request authentication and organization headers immediately.

A login previously saved in `~/.kilocode/opencode-kilo-auth.json` is imported once if OpenCode has no active Kilo connection. An existing connection is preserved. Disconnecting afterward does not trigger another import.

## Models inside OpenCode

Models refresh automatically in the background when the plugin loads and when you connect or switch Kilo accounts. Refreshed models appear in `/models`; your saved provider configuration and custom models are preserved.

For an immediate refresh, open the command picker or type:

```text
/kilo-sync-models
```

The command uses the active OpenCode Kilo connection and its selected organization. A failed refresh keeps the last successful catalog for that account. Normal use requires no npm sync command or manual provider definition.

Anthropic reasoning models receive `high` and `max` variants through native v2 `body.reasoning` settings. Model prices are converted from Kilo's per-token prices to OpenCode's per-million-token units.

## Update from GitHub

From your existing checkout:

```bash
git pull --ff-only
npm ci
npm run build
npm run install:opencode
opencode reload
```

The installer replaces the configured Kilo plugin path with the current version's build. Run `opencode plugin list` to verify that it is active.

## Optional model export

To print model definitions without changing your configuration:

```bash
npm run models --silent > kilo-models.json
```

To write model definitions into your configuration explicitly:

```bash
npm run sync-models
```

These maintenance scripts use `KILO_API_KEY` or the saved device login. The file-writing script backs up the configuration, supports JSON/JSONC, and migrates a legacy `provider.kilo` entry to `providers.kilo`. It replaces that entry's model definitions. The in-app refresh leaves the configuration file unchanged.

## Auth storage and environment

Device logins are also saved with owner-only permissions in:

```text
~/.kilocode/opencode-kilo-auth.json
```

| Variable | Purpose |
| --- | --- |
| `KILO_API_KEY` | API key or token for environment authentication and maintenance scripts. |
| `KILO_API_URL` | Base API URL; defaults to `https://api.kilo.ai`. |
| `KILO_ORG_ID` | Organization ID for team usage; overrides the connection form. |
| `KILOCODE_EDITOR_NAME` | Overrides the `X-KILOCODE-EDITORNAME` request header. |
| `KILOCODE_AUTH_PATH` | Overrides the saved Kilo auth file path. |

## Development

After installing dependencies and building:

```bash
npm run typecheck
npm test
```

The implementation follows OpenCode's [v1 plugin migration guide](https://dev.opencode.ai/v2/docs/build/plugins/migrate-v1/). A default `Plugin.define` export registers authentication methods, model discovery, a native command, and request hooks through `setup(ctx)`. Requests use OpenCode's native OpenRouter runtime.
