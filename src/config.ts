import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyEdits, createScanner, findNodeAtLocation, modify, parse, parseTree, SyntaxKind, type ParseError } from "jsonc-parser";

type Config = Record<string, any>;

export async function resolveConfigPath(): Promise<string> {
  if (process.env.OPENCODE_CONFIG_CONTENT) {
    throw new Error("OPENCODE_CONFIG_CONTENT is set; update that configuration instead of a file.");
  }
  if (process.env.OPENCODE_CONFIG) return path.resolve(process.env.OPENCODE_CONFIG);
  const dir = process.env.OPENCODE_CONFIG_DIR
    ?? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode");
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const file = path.join(dir, name);
    try {
      await fs.access(file);
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return path.join(dir, "opencode.json");
}

function parseConfig(contents: string, file: string): Config {
  const errors: ParseError[] = [];
  const config = parse(contents, errors, { allowTrailingComma: true, allowEmptyContent: true }) ?? {};
  if (errors.length || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Invalid JSON/JSONC in ${file}; the file has not been changed.`);
  }
  return config;
}

export async function readConfigFile(file: string): Promise<Config> {
  const contents = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return "{}\n";
  });
  return parseConfig(contents, file);
}

function removeProperty(contents: string, location: string[]): string {
  const tree = parseTree(contents);
  const property = tree && findNodeAtLocation(tree, location)?.parent;
  if (property?.type !== "property") return contents;
  const edits = [{ offset: property.offset, length: property.length, content: "" }];
  const scanner = createScanner(contents, true);
  scanner.setPosition(property.offset + property.length);
  if (scanner.scan() === SyntaxKind.CommaToken) {
    edits.push({ offset: scanner.getTokenOffset(), length: 1, content: "" });
  } else {
    const siblings = property.parent?.children ?? [];
    const previous = siblings[siblings.indexOf(property) - 1];
    if (previous) {
      scanner.setPosition(previous.offset + previous.length);
      if (scanner.scan() === SyntaxKind.CommaToken) edits.push({ offset: scanner.getTokenOffset(), length: 1, content: "" });
    }
  }
  // jsonc-parser's normal property deletion also removes preceding comments.
  return applyEdits(contents, edits);
}

export async function patchConfigFile(file: string, changes: Array<{ path: string[]; value: unknown }>): Promise<string | undefined> {
  const stat = await fs.stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  let contents = stat ? await fs.readFile(file, "utf8") : "{}\n";
  parseConfig(contents, file);
  const original = contents;
  for (const change of changes) {
    if (change.value === undefined) {
      contents = removeProperty(contents, change.path);
      continue;
    }
    contents = applyEdits(contents, modify(contents, change.path, change.value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
    }));
  }
  if (contents === original) return undefined;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const backup = stat ? `${file}.bak-kilo-v2-${Date.now()}` : undefined;
  if (backup) await fs.copyFile(file, backup, fsConstants.COPYFILE_EXCL);
  const temporary = `${file}.kilo-${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, contents.endsWith("\n") ? contents : `${contents}\n`, { mode: stat ? stat.mode & 0o777 : 0o600, flag: "wx" });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return backup;
}
