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
  publish           Publish package to npm (bump version, build, publish, tag)
  start-deploy-ui   Start deployment UI for cloud VM setup
  help              Show this help message

Examples:
  ./manage.sh publish
  ./manage.sh start-deploy-ui

EOF
}

publish_package() {
  local PKG_DIR="$SCRIPT_DIR/typescript"
  local PKG_JSON="$PKG_DIR/package.json"

  # Check for jq
  if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required. Install with: brew install jq (macOS) or apt-get install jq (Linux)" >&2
    exit 1
  fi

  # Check if package.json exists
  if [[ ! -f "$PKG_JSON" ]]; then
    echo "Error: package.json not found at $PKG_JSON" >&2
    exit 1
  fi

  cd "$PKG_DIR"

  # Show current version
  VERSION=$(jq -r '.version' package.json)
  echo "Current version: $VERSION"
  echo ""

  # Choose bump type
  echo "Which version bump?"
  echo "  1) patch (0.0.x)"
  echo "  2) minor (0.x.0)"
  echo "  3) major (x.0.0)"
  echo ""
  read -p "Enter choice (1-3 or patch/minor/major): " BUMP_INPUT

  case "$BUMP_INPUT" in
    1|patch)
      BUMP_TYPE="patch"
      ;;
    2|minor)
      BUMP_TYPE="minor"
      ;;
    3|major)
      BUMP_TYPE="major"
      ;;
    *)
      echo "Invalid choice. Use 1-3 or patch/minor/major." >&2
      exit 1
      ;;
  esac

  echo ""
  echo "Bumping version: $BUMP_TYPE"
  echo ""

  # Bump version using npm
  npm version "$BUMP_TYPE" --no-git-tag-version

  NEW_VERSION=$(jq -r '.version' package.json)
  echo "New version: $NEW_VERSION"
  echo ""

  # Build project
  echo "Building package..."
  npm run build
  echo ""

  # Confirm before publishing
  read -p "Publish agent-backend@$NEW_VERSION to npm? (y/N): " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Aborted. Version was bumped but not published."
    exit 1
  fi

  # Publish
  echo ""
  echo "Publishing package to npm..."
  npm publish
  echo ""

  echo "✓ Successfully published agent-backend@$NEW_VERSION"
  echo ""

  # Commit and push
  echo "Committing and pushing version bump to GitHub..."
  cd "$SCRIPT_DIR"
  git add "$PKG_DIR/package.json" "$PKG_DIR/package-lock.json" 2>/dev/null || true
  git commit -m "chore: bump agent-backend to v$NEW_VERSION"
  git tag "agent-backend-v$NEW_VERSION"
  git push origin HEAD
  git push origin "agent-backend-v$NEW_VERSION"
  echo ""

  echo "✓ All done!"
  echo ""
  echo "Published: agent-backend@$NEW_VERSION"
  echo "Tagged: agent-backend-v$NEW_VERSION"
  echo "Pushed to GitHub"
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
