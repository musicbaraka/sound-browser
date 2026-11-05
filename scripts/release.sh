#!/usr/bin/env bash
# Build the Windows installer and publish it as a GitHub Release.
# Usage: scripts/release.sh [patch|minor|major|x.y.z] "What changed"
# Installed apps pick up the new version automatically.
set -euo pipefail
cd "$(dirname "$0")/.."
BUMP="${1:-patch}"
NOTES="${2:-Improvements and fixes.}"
npm version "$BUMP" --no-git-tag-version >/dev/null
VERSION=$(node -p "require('./package.json').version")
rm -rf dist
WINEDEBUG=-all npx electron-builder --win --x64 --publish never
git add package.json package-lock.json
git commit -qm "Release $VERSION" || true
git push -q
gh release create "v$VERSION" --repo musicbaraka/sound-browser --title "Sound Browser $VERSION" --notes "$NOTES" \
  "dist/Sound-Browser-Setup-$VERSION.exe" "dist/Sound-Browser-Setup-$VERSION.exe.blockmap" dist/latest.yml
echo "Published v$VERSION"
