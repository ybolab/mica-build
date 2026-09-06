// Validate per-package JSON pins and render temporary dpkg installation records.
// mos-build-side: container -- docker.sh and BuildKit use the pinned Bun image.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
function fail(message: string): never { throw new Error(message); }
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object");
  return value as Record<string, unknown>;
};
function fields(value: unknown, expected: string[]): Record<string, unknown> {
  const record = object(value);
  if (Object.keys(record).sort().join() !== [...expected].sort().join()) fail("unexpected or missing fields");
  return record;
}
function string(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) fail("invalid field value");
  return value;
}
function read(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")); }
function lines(path: string): string[] {
  return readFileSync(path, "utf8").split("\n").map(line => line.replace(/#.*/, "").trim()).filter(Boolean);
}
const packageName = /^[a-z0-9][a-z0-9+.-]+$/;
const snapshotURL = /^https:\/\/snapshot\.debian\.org\/archive\/debian\/[0-9]{8}T[0-9]{6}Z\/pool\/[^\s?#]+\.deb$/;
function pin(value: unknown, target: string, helper = false): string[] {
  const record = object(value);
  const version = string(record.version, /^[0-9][A-Za-z0-9.+:~_-]*$/);
  const architecture = string(record.architecture, /^(amd64|arm64|all)$/);
  if (architecture !== target && architecture !== "all") fail("architecture differs from target");
  const sha256 = string(record.sha256, /^[0-9a-f]{64}$/);
  const url = string(record.url, helper ? /^https:\/\/deb\.debian\.org\/debian\/pool\/[^\s?#]+\.deb$/ : snapshotURL);
  return [version, architecture, sha256, url];
}

try {
  const [command, arch, mode = "base", selection] = Bun.argv.slice(2);
  if (command === "helper") {
    const record = fields(read(join(here, "helpers/debootstrap.json")), ["name", "version", "architecture", "sha256", "url"]);
    if (record.name !== "debootstrap" || record.architecture !== "all") fail("invalid bootstrap helper");
    console.log([record.name, ...pin(record, "all", true)].join("\t"));
  } else {
    if (command !== "runtime" || !["amd64", "arm64"].includes(arch ?? "") || !["base", "all", "consumers", "package"].includes(mode)) fail("invalid manifest command");
    const consumers = new Set(lines(join(here, "consumers.pkgs")));
    const wanted = new Set(["base"]);
    if (mode === "consumers") {
      if (!selection) fail("package selection is missing");
      const requested = lines(selection);
      if (!requested.length) fail("package selection is empty");
      for (const consumer of requested) {
        if (!consumers.has(consumer)) fail(`unknown package consumer: ${consumer}`);
        wanted.add(consumer);
      }
    }
    const directory = join(here, "packages");
    const names = mode === "package"
      ? [string(selection, packageName)]
      : readdirSync(directory).filter(file => file.endsWith(".json")).map(file => file.slice(0, -5)).sort();
    const rows: string[] = [];
    for (const name of names) {
      try {
        const record = fields(read(join(directory, `${name}.json`)), ["name", "targets"]);
        if (string(record.name, packageName) !== name || name === "apt") fail("invalid package name");
        const targets = object(record.targets);
        if (!Object.keys(targets).length) fail("no target variants");
        for (const [target, value] of Object.entries(targets)) {
          if (!["amd64", "arm64"].includes(target)) fail("unsupported target");
          const variant = fields(value, ["version", "architecture", "sha256", "url", "consumers"]);
          const metadata = pin(variant, target);
          if (!Array.isArray(variant.consumers) || !variant.consumers.length || new Set(variant.consumers).size !== variant.consumers.length) fail("invalid consumers");
          for (const consumer of variant.consumers) {
            if (typeof consumer !== "string" || (consumer !== "base" && !consumers.has(consumer))) fail("unknown package consumer");
          }
          if (target === arch && (mode === "all" || mode === "package" || variant.consumers.some(consumer => wanted.has(consumer)))) {
            rows.push([name, ...metadata, variant.consumers.join(",")].join("\t"));
          }
        }
        if (mode === "package" && !targets[arch!]) fail(`package has no ${arch} variant`);
      } catch (error) {
        fail(`${name}.json: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (!rows.length) fail("package selection is empty");
    console.log(rows.join("\n"));
  }
} catch (error) {
  console.error(`debian-base: invalid package lock: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
