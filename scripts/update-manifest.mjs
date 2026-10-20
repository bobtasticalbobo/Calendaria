// Writes latest.json, which installed copies of Calendaria read to find
// updates: node scripts/update-manifest.mjs <bundle dir> <repo> > latest.json
import { readFileSync } from "node:fs";

const [dir, repo] = process.argv.slice(2);
const { version } = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const setup = `Calendaria_${version}_x64-setup.exe`;
const manifest = {
  version,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(`${dir}/${setup}.sig`, "utf8"),
      url: `https://github.com/${repo}/releases/download/v${version}/${setup}`,
    },
  },
};
console.log(JSON.stringify(manifest, null, 2));
