#!/bin/bash
# Agent Backend Management Script
# Combines publishing and deployment tooling

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

show_help() {
  cat <<EOF
Agent Backend Management Script

Usage: ./manage.sh <command>

Commands:
  publish           Bump versions, create release branch & PR (CI publishes on merge)
  start-deploy-ui   Start deployment UI for cloud VM setup
  help              Show this help message

Examples:
  ./manage.sh publish
  ./manage.sh start-deploy-ui

EOF
}

publish_package() {
  local TS_DIR="$SCRIPT_DIR/typescript"
  local TS_PKG="$TS_DIR/package.json"
  local PY_TOML="$SCRIPT_DIR/python/pyproject.toml"

  # Check prerequisites
  if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required. Install with: brew install jq (macOS) or apt-get install jq (Linux)" >&2
    exit 1
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "Error: gh CLI is required. Install with: brew install gh (macOS) or https://cli.github.com" >&2
    exit 1
  fi
  if [[ ! -f "$TS_PKG" ]]; then
    echo "Error: package.json not found at $TS_PKG" >&2
    exit 1
  fi
  if [[ ! -f "$PY_TOML" ]]; then
    echo "Error: pyproject.toml not found at $PY_TOML" >&2
    exit 1
  fi

  # Show current version
  local CURRENT_VERSION
  CURRENT_VERSION=$(jq -r '.version' "$TS_PKG")
  echo "Current version: $CURRENT_VERSION"
  echo ""

  # Choose bump type
  echo "Which version bump?"
  echo "  1) patch (0.0.x)"
  echo "  2) minor (0.x.0)"
  echo "  3) major (x.0.0)"
  echo ""
  read -p "Enter choice (1-3 or patch/minor/major): " BUMP_INPUT

  case "$BUMP_INPUT" in
    1|patch) BUMP_TYPE="patch" ;;
    2|minor) BUMP_TYPE="minor" ;;
    3|major) BUMP_TYPE="major" ;;
    *)
      echo "Invalid choice. Use 1-3 or patch/minor/major." >&2
      exit 1
      ;;
  esac

  echo ""
  echo "Bumping version: $BUMP_TYPE"
  echo ""

  # 1. Bump TypeScript version
  local NEW_VERSION
  cd "$TS_DIR"
  NEW_VERSION=$(jq -r '.version' package.json | awk -F. -v bump="$BUMP_TYPE" '{
    if (bump == "major") printf "%d.0.0", $1+1
    else if (bump == "minor") printf "%s.%d.0", $1, $2+1
    else printf "%s.%s.%d", $1, $2, $3+1
  }')
  jq --arg v "$NEW_VERSION" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json
  echo "New version: $NEW_VERSION"
  echo ""

  # 2. Sync Python version
  echo "Syncing Python version..."
  cd "$SCRIPT_DIR"
  sed -i '' "s/^version = \".*\"/version = \"$NEW_VERSION\"/" "$PY_TOML"
  echo "Updated $PY_TOML to $NEW_VERSION"
  echo ""

  # 3. Build TypeScript to verify it compiles
  echo "Building TypeScript to verify..."
  cd "$TS_DIR"
  pnpm run build
  echo ""

  # 4. Create release branch, commit, and open PR
  cd "$SCRIPT_DIR"
  local BRANCH="release/v$NEW_VERSION"

  echo "Creating release branch: $BRANCH"
  git checkout -b "$BRANCH"

  git add "$TS_PKG" "$PY_TOML"
  git commit -m "chore: bump version to v$NEW_VERSION"

  echo "Pushing branch..."
  git push -u origin "$BRANCH"
  echo ""

  echo "Creating pull request..."
  gh pr create \
    --title "chore: release v$NEW_VERSION" \
    --body "$(cat <<EOF
## Summary
- Bump version to **v$NEW_VERSION** ($BUMP_TYPE)
- TypeScript \`package.json\` updated
- Python \`pyproject.toml\` synced

## Post-merge
CI will auto-publish to npm via the \`publish\` workflow.
EOF
)" \
    --base main
  echo ""

  echo "✓ All done!"
  echo ""
  echo "Release branch: $BRANCH"
  echo "Version: $NEW_VERSION"
  echo "A PR has been opened — merge it to publish via CI."
}

start_deploy_ui() {
  local DEPLOY_DIR="$SCRIPT_DIR/typescript/deploy/deploy-tool"

  if [[ ! -d "$DEPLOY_DIR" ]]; then
    echo "Error: Deploy tool directory not found at $DEPLOY_DIR" >&2
    exit 1
  fi

  cd "$DEPLOY_DIR"

  # Install dependencies if needed
  if [[ ! -d "node_modules" ]]; then
    echo "Installing dependencies..."
    npm install
  fi

  echo "Starting Agent Backend deployment UI..."
  echo "Will be available at: http://localhost:3456"
  echo ""
  echo "Press Ctrl+C to stop"
  echo ""

  node server.js
}

# Main script logic
case "${1:-}" in
  publish)
    publish_package
    ;;
  start-deploy-ui)
    start_deploy_ui
    ;;
  help|--help|-h|"")
    show_help
    ;;
  *)
    echo "Error: Unknown command '$1'" >&2
    echo ""
    show_help
    exit 1
    ;;
esac
