#!/usr/bin/env bash
# Publish a new version. Usage: scripts/release.sh [patch|minor|major|x.y.z]
# This bumps the version and pushes. GitHub Actions builds the Windows
# installer and publishes the release; installed apps update themselves.
set -euo pipefail
cd "$(dirname "$0")/.."
npm version "${1:-patch}" --no-git-tag-version >/dev/null
VERSION=$(node -p "require('./package.json').version")
git add -A
git commit -qm "Release $VERSION"
git push -q
echo "Pushed v$VERSION. GitHub is building it: https://github.com/musicbaraka/sound-browser/actions"
