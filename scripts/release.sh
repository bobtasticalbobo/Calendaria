#!/usr/bin/env bash
# Builds a signed Windows installer and publishes it as a GitHub release that
# installed copies of Calendaria pick up through the updater.
#
#   TAURI_SIGNING_PRIVATE_KEY=<key file or contents> scripts/release.sh
#
# Bump the version in tauri.conf.json, Cargo.toml and package.json first.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${TAURI_SIGNING_PRIVATE_KEY:?set it to the updater signing key}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
repo=bobtasticalbobo/Calendaria
version=$(node -p 'require("./src-tauri/tauri.conf.json").version')
target=${TARGET:-x86_64-pc-windows-gnu}
bundle=src-tauri/target/$target/release/bundle/nsis
setup="Calendaria_${version}_x64-setup.exe"

npx tauri build --target "$target" --bundles nsis

node -e '
  const [version, sig, url] = process.argv.slice(1);
  const manifest = {
    version,
    pub_date: new Date().toISOString(),
    platforms: { "windows-x86_64": { signature: sig, url } },
  };
  require("fs").writeFileSync(process.argv[4], JSON.stringify(manifest, null, 2));
' "$version" "$(cat "$bundle/$setup.sig")" \
  "https://github.com/$repo/releases/download/v$version/$setup" "$bundle/latest.json"

gh release create "v$version" --repo "$repo" --title "Calendaria $version" --notes "" --latest \
  "$bundle/$setup" "$bundle/latest.json"
