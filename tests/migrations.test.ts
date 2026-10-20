import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DB_URL } from "../src/db/tauriDriver";
import { migrationFiles } from "./sqliteDriver";

const libRs = readFileSync(join(import.meta.dirname, "../src-tauri/src/lib.rs"), "utf8");

it("registers every migration file with the app, in order", () => {
  const registered = [...libRs.matchAll(/include_str!\("\.\.\/migrations\/([^"]+)"\)/g)].map(
    (m) => m[1],
  );
  expect(registered).toEqual(migrationFiles());
  const versions = [...libRs.matchAll(/version:\s*(\d+)/g)].map((m) => Number(m[1]));
  expect(versions).toEqual(migrationFiles().map((_, i) => i + 1));
});

it("uses the same database URL in Rust and TypeScript", () => {
  expect(libRs).toContain(`pub const DB_URL: &str = "${DB_URL}";`);
});
