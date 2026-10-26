import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchConfigFile, readConfigFile, resolveConfigPath } from "../src/config.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const file = await resolveConfigPath();
const config = await readConfigFile(file);
const data = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
const target = path.join(data, "opencode", "plugin-builds", `kilo-auth-v${pkg.version}`);
const entries = [...(config.plugin ?? []), ...(config.plugins ?? [])].map((entry: any) => (
  Array.isArray(entry) ? { package: entry[0], options: entry[1] } : entry
));
const plugins = entries.filter((entry: any) => {
  const value = typeof entry === "string" ? entry : entry?.package;
  return typeof value !== "string" || !(value === target
    || /(?:^|\/)opencode-kilo-auth(?:entication)?(?:@[^/]+)?(?:\/|$)/.test(value)
    || /\/plugin-builds\/kilo-auth-v[^/]+\/?$/.test(value)
    || value === "-opencode-kilo-auth");
});
plugins.push(target);

await fs.mkdir(path.join(target, "scripts"), { recursive: true });
for (const name of ["index.js", "scripts/fetch-models.js", "scripts/sync-models.js"]) {
  await fs.copyFile(path.join(root, "dist", name), path.join(target, name));
}
await fs.writeFile(path.join(target, "package.json"), `${JSON.stringify({
  name: pkg.name, version: pkg.version, type: "module", main: "./index.js", exports: { ".": "./index.js" },
}, null, 2)}\n`);
const changes: Array<{ path: string[]; value: unknown }> = [{ path: ["plugins"], value: plugins }];
if (config.plugin) changes.push({ path: ["plugin"], value: undefined });
const backup = await patchConfigFile(file, changes);
console.log(`Installed ${pkg.name} ${pkg.version} to ${target}`);
console.log(`Enabled in ${file}`);
if (backup) console.log(`Backup: ${backup}`);
