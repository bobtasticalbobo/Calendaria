import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DB_URL } from "../src/db/tauriDriver";
import { createPartlyMigratedDriver, migrationFiles } from "./sqliteDriver";

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

it("migrates a device that got the Calendar notebook through sync before 0012", async () => {
  const { driver, migrateRest } = createPartlyMigratedDriver(11);
  // What sync from a device already on 0012 leaves behind.
  await driver.execute(
    `INSERT INTO notebooks (id, name, color, position, created_at, updated_at)
     VALUES ('019a0a00-0000-7000-8000-000000000003', 'Calendar', '#ff5a1f', -1, $1, $1)`,
    ["2026-10-23T00:00:00.000Z"],
  );
  await driver.execute(
    `INSERT INTO chapters (id, notebook_id, name, position, created_at, updated_at)
     VALUES ('019a0a00-0000-7000-8000-000000000004', '019a0a00-0000-7000-8000-000000000003', 'Day notes', 0, $1, $1)`,
    ["2026-10-23T00:00:00.000Z"],
  );
  // This is what closed the app on launch.
  expect(migrateRest).toThrow(/UNIQUE/);

  const fixup = readFileSync(join(import.meta.dirname, "../src-tauri/fixups/before_0012.sql"), "utf8");
  const statements = fixup.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) await driver.execute(statement);
  migrateRest();
  const notebooks = await driver.select<{ name: string }>(
    "SELECT name FROM notebooks WHERE id = '019a0a00-0000-7000-8000-000000000003'",
  );
  expect(notebooks).toEqual([{ name: "Calendar" }]);
});

it("registers every fixup with the app", () => {
  const fixups = readFileSync(join(import.meta.dirname, "../src-tauri/src/fixups.rs"), "utf8");
  expect(fixups).toContain('include_str!("../fixups/before_0012.sql")');
});
