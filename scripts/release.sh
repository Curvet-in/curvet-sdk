#!/usr/bin/env bash
#
# Release @curvet/sdk. No npm token needed — publishing happens in CI via npm
# Trusted Publishing (OIDC); this script just bumps, tags, and cuts the GitHub
# Release that triggers .github/workflows/publish.yml.
#
# Usage:
#   ./scripts/release.sh            # release the CURRENT package.json version
#   ./scripts/release.sh patch      # bump patch, then release   (0.2.0 -> 0.2.1)
#   ./scripts/release.sh minor      # bump minor, then release   (0.2.0 -> 0.3.0)
#   ./scripts/release.sh major      # bump major, then release   (0.2.0 -> 1.0.0)
#
# Prereqs: gh CLI authenticated; the npm Trusted Publisher configured once on
# npmjs.com (see .github/workflows/publish.yml header).
set -euo pipefail

BUMP="${1:-}"
if [[ -n "$BUMP" && "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: ./scripts/release.sh [patch|minor|major]" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

# Guardrails
branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "main" ]]; then
  echo "✋ Releases must be cut from 'main' (currently on '$branch')." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain | grep -v '^??')" ]]; then
  echo "✋ Working tree has uncommitted changes. Commit or stash first." >&2
  exit 1
fi

# Sanity gate (same checks CI runs)
echo "▶ Installing & validating…"
npm ci
npm run typecheck
npm test
npm run build

# Bump (optional). npm version commits and tags vX.Y.Z.
if [[ -n "$BUMP" ]]; then
  echo "▶ Bumping $BUMP…"
  npm version "$BUMP" -m "release: v%s"
fi

VERSION="v$(node -p "require('./package.json').version")"

# Ensure a tag exists for the current version (when no bump was requested).
if ! git rev-parse "$VERSION" >/dev/null 2>&1; then
  git tag -a "$VERSION" -m "release $VERSION"
fi

echo "▶ Pushing $VERSION…"
git push --follow-tags origin main

echo "▶ Creating GitHub release $VERSION (this triggers the OIDC publish)…"
gh release create "$VERSION" --title "$VERSION" --generate-notes

echo "✅ Release $VERSION created. Watch the publish at:"
echo "   https://github.com/Curvet-in/curvet-sdk/actions/workflows/publish.yml"
