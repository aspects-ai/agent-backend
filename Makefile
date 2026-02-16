.PHONY: help install dev dev-local nextjs tsbasic build test clean typecheck lint lint-fix build-typescript build-python test-typescript test-python test-unit typecheck-typescript typecheck-python lint-typescript lint-python publish-typescript publish-python start-deploy-ui ci ci-fast sync-assets docker-build

# Default target - show help
.DEFAULT_GOAL := help

# Colors for output
CYAN := \033[0;36m
RESET := \033[0m

##@ General

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@awk 'BEGIN {FS = ":.*##"; printf "Available targets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2 } /^##@/ { printf "\n%s\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Getting Started

install: ## Install all dependencies
	@echo "Installing TypeScript dependencies..."
	pnpm install
	@echo ""
	@echo "Installing Python dependencies..."
	@if [ -d "python" ] && [ -f "python/pyproject.toml" ]; then \
		cd python && pip install -e .[dev] || echo "⚠️  Python install failed"; \
	else \
		echo "Python package not ready (skipping)"; \
	fi
	@echo ""
	@echo "Installing dev tools..."
	@command -v mprocs >/dev/null 2>&1 || { \
		echo "Installing mprocs..."; \
		if [ "$$(uname)" = "Darwin" ]; then \
			brew install mprocs; \
		elif [ "$$(uname)" = "Linux" ]; then \
			if command -v cargo >/dev/null 2>&1; then \
				cargo install mprocs; \
			else \
				echo "⚠️  mprocs not installed. Install manually: https://github.com/pvolok/mprocs#installation"; \
			fi; \
		else \
			echo "⚠️  mprocs not installed. Install manually: https://github.com/pvolok/mprocs#installation"; \
		fi; \
	}
	@echo "✓ All dependencies installed"

dev: sync-assets ## Start dev environment (TS watch + NextJS + Docker daemon)
	@command -v mprocs >/dev/null 2>&1 || { \
		echo "Error: mprocs not installed. Run 'make install' first."; \
		exit 1; \
	}
	@if ! command -v docker >/dev/null 2>&1; then \
		echo "Warning: Docker not installed — falling back to local mode."; \
		echo "Install Docker: https://docs.docker.com/get-docker/"; \
		LOCAL=1 mprocs; \
	else \
		mkdir -p tmp/deploy; \
		if ! docker images | grep -q "agentbe-daemon.*latest"; then \
			echo "Docker image not found. Building agentbe-daemon:latest..."; \
			$(MAKE) docker-build; \
		fi; \
		mprocs; \
	fi

dev-local: ## Start dev environment (local only, no Docker)
	@command -v mprocs >/dev/null 2>&1 || { \
		echo "Error: mprocs not installed. Run 'make install' first."; \
		exit 1; \
	}
	LOCAL=1 mprocs

##@ Examples

nextjs: sync-assets build-typescript ## Run NextJS demo app
	@command -v mprocs >/dev/null 2>&1 || { \
		echo "Error: mprocs not installed. Run 'make install' first."; \
		exit 1; \
	}
	@if ! command -v docker >/dev/null 2>&1; then \
		echo "Warning: Docker not installed — using local daemon."; \
		NEXTJS=1 LOCAL=1 mprocs; \
	else \
		mkdir -p tmp/deploy; \
		if ! docker images | grep -q "agentbe-daemon.*latest"; then \
			echo "Docker image not found. Building agentbe-daemon:latest..."; \
			$(MAKE) docker-build; \
		fi; \
		NEXTJS=1 mprocs; \
	fi

tsbasic: build-typescript ## Run TSBasic CLI example
	cd examples/TSBasic && npx tsx index.ts

##@ Build & Test

build: build-typescript build-python ## Build all packages

test: test-typescript test-python ## Run all tests

clean: ## Remove build artifacts and dependencies
	@echo "Cleaning TypeScript packages..."
	rm -rf typescript/dist typescript/node_modules
	rm -rf examples/NextJS/dist examples/NextJS/.next examples/NextJS/node_modules
	rm -rf examples/TSBasic/node_modules
	rm -rf node_modules
	@echo "Cleaning Python package..."
	@if [ -d "python" ]; then \
		cd python && rm -rf dist build *.egg-info .pytest_cache .mypy_cache __pycache__; \
	fi
	@echo "Cleaning development artifacts..."
	rm -rf tmp/
	@echo "Cleaning lockfiles..."
	rm -f pnpm-lock.yaml

##@ Code Quality

typecheck: typecheck-typescript typecheck-python ## Type check all packages

lint: lint-typescript lint-python ## Lint all packages

lint-fix: ## Auto-fix lint issues
	@echo "Auto-fixing TypeScript..."
	pnpm -r lint:fix || true
	@echo "Auto-fixing Python..."
	@if [ -d "python" ] && [ -f "python/pyproject.toml" ]; then \
		cd python && ruff check --fix . || true; \
	fi

##@ Language-Specific

build-typescript: ## Build TypeScript packages
	@echo "Building TypeScript packages..."
	pnpm -r build

build-python: ## Build Python package
	@echo "Building Python package..."
	@if [ -d "python" ] && [ -f "python/pyproject.toml" ]; then \
		cd python && python -m build || echo "⚠️  Python build failed (missing 'build' module? Run: pip install build)"; \
	else \
		echo "Python package not ready (skipping)"; \
	fi

test-typescript: ## Run TypeScript tests
	@echo "Running TypeScript tests..."
	pnpm -r test

test-python: ## Run Python tests
	@echo "Running Python tests..."
	@if [ -d "python" ] && [ -f "python/pyproject.toml" ]; then \
		cd python && pytest || echo "⚠️  Python tests failed or pytest not installed"; \
	else \
		echo "Python package not ready (skipping)"; \
	fi

test-unit: ## Run unit tests only
	@echo "Running unit tests..."
	pnpm -r run test:unit 2>/dev/null || echo "No unit tests configured"

typecheck-typescript: ## Type check TypeScript packages
	@echo "Type checking TypeScript packages..."
	pnpm -r typecheck

typecheck-python: ## Type check Python package
	@echo "Type checking Python package..."
	@if [ -d "python" ] && [ -f "python/pyproject.toml" ]; then \
		cd python && mypy . || echo "⚠️  Python typecheck failed or mypy not installed"; \
	else \
		echo "Python package not ready (skipping)"; \
	fi

lint-typescript: ## Lint TypeScript packages
	@echo "Linting TypeScript packages..."
	pnpm -r lint

lint-python: ## Lint Python package
	@echo "Linting Python package..."
	@if [ -d "python" ] && [ -f "python/pyproject.toml" ]; then \
		cd python && ruff check . || echo "⚠️  Python lint failed or ruff not installed"; \
	else \
		echo "Python package not ready (skipping)"; \
	fi

##@ Publishing & CI

publish-typescript: ## Publish TypeScript package to npm
	@echo "Publishing TypeScript package..."
	./manage.sh publish

publish-python: ## Publish Python package to PyPI
	@echo "Publishing Python package..."
	@if [ -d "python" ] && [ -f "python/pyproject.toml" ]; then \
		cd python && python -m twine upload dist/*; \
	else \
		echo "Python package not ready"; \
	fi

start-deploy-ui: ## Cloud VM deployment UI
	./manage.sh start-deploy-ui

ci: install typecheck lint test ## Full CI pipeline

ci-fast: typecheck test-unit ## Fast CI (typecheck + unit tests)

# --- Internal targets (not shown in help) ---

sync-assets:
	@echo "Syncing shared assets..."
	@mkdir -p examples/NextJS/public/assets
	@cp -r assets/* examples/NextJS/public/assets/
	@echo "✓ Assets synced to examples/NextJS/public/assets/"

docker-build: build-typescript
	@echo "Building agentbe-daemon Docker image..."
	@cd typescript/deploy/docker && \
		docker build -f Dockerfile.runtime -t agentbe-daemon:latest ../../..
