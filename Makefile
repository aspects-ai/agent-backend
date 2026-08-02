.PHONY: help install dev dev-local demo demo-test rooms rooms-test k8s-up k8s-test k8s-forward k8s-down dev-down nextjs tsbasic pybasic build test clean typecheck lint lint-fix build-typescript build-python test-typescript test-python test-unit typecheck-typescript typecheck-python lint-typescript lint-python publish publish-typescript publish-python start-deploy-ui ci ci-fast sync-assets docker-build

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
	uv sync || echo "⚠️  Python install failed (is uv installed?)"
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

dev: sync-assets ## Start dev environment (daemon in Docker; NEXTJS=1 adds the NextJS example)
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

dev-local: ## Start dev environment (daemon on the host, no Docker)
	@command -v mprocs >/dev/null 2>&1 || { \
		echo "Error: mprocs not installed. Run 'make install' first."; \
		exit 1; \
	}
	LOCAL=1 mprocs

##@ Examples

demo: build-typescript ## Run the demo document-room MCP server over HTTP :8848 (PG=1 for pgvector)
	@bash room/examples/demo-room/run.sh --http $(if $(filter 1,$(PG)),--pg,)

demo-test: build-typescript ## Verify the demo room end-to-end over a real MCP connection (PG=1 for pgvector)
	@node room/examples/demo-room/smoke.mjs --reset $(if $(filter 1,$(PG)),--pg,)

rooms: build-typescript ## Run a multi-room deploy locally (one process per room: acme :8861, globex :8862; S3=1 for the S3 tier)
	@bash room/examples/multi-room/run.sh $(if $(filter 1,$(S3)),--s3,)

rooms-test: build-typescript ## Verify multi-room isolation: cross-room credentials, content, sandboxes (S3=1 for the S3 tier)
	@node room/examples/multi-room/check.mjs --reset $(if $(filter 1,$(S3)),--s3,)

k8s-up: ## Provision the local k8s room environment (kind + Calico + agent-sandbox + rooms)
	@bash room/examples/k8s/up.sh $(if $(filter 1,$(SKIP_IMAGES)),--skip-images,)

k8s-test: ## Verify the k8s deploy: room isolation, sandbox-per-session, cleanup
	@node room/examples/k8s/check.mjs

k8s-forward: ## Supervised port-forwards to the k8s rooms (mprocs; acme :18861, globex :18862)
	@command -v mprocs >/dev/null 2>&1 || { echo "mprocs not installed. Run 'make install'."; exit 1; }
	@K8S=1 mprocs

k8s-down: ## Delete the local k8s cluster
	@kind delete cluster --name agentbe

dev-down: ## Stop all local dev infrastructure (k8s cluster + LocalStack + pgvector)
	@echo "Deleting kind cluster (if present)..."
	@kind delete cluster --name agentbe 2>/dev/null || true
	@echo "Removing helper containers..."
	@docker rm -f agentbe-localstack agentbe-pgvector 2>/dev/null || true
	@echo "Removing any stray room sandboxes..."
	@docker ps -aq --filter label=agentbe.room.sandbox | xargs -r docker rm -f >/dev/null 2>&1 || true
	@echo "✓ Local dev infrastructure stopped"

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

pybasic: build-python ## Run PyBasic CLI example
	cd examples/PyBasic && uv run python main.py

##@ Build & Test

build: build-typescript build-python ## Build all packages

test: test-typescript test-python ## Run all tests

clean: ## Remove build artifacts and dependencies
	@echo "Cleaning TypeScript packages..."
	rm -rf packages/agent-backend/typescript/dist packages/agent-backend/typescript/node_modules
	rm -rf examples/NextJS/dist examples/NextJS/.next examples/NextJS/node_modules
	rm -rf examples/TSBasic/node_modules
	rm -rf node_modules
	@echo "Cleaning Python packages..."
	rm -rf .venv dist
	@if [ -d "packages/agent-backend/python" ]; then \
		cd packages/agent-backend/python && rm -rf build *.egg-info .pytest_cache .mypy_cache __pycache__; \
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
	cd packages/agent-backend/python && uv run ruff check --fix . || true

##@ Language-Specific

build-typescript: ## Build TypeScript packages
	@echo "Building TypeScript packages..."
	pnpm -r build

build-python: ## Build Python package
	@echo "Building Python package..."
	uv build --package agent-backend

test-typescript: ## Run TypeScript tests
	@echo "Running TypeScript tests..."
	pnpm -r test:run

test-python: ## Run Python tests
	@echo "Running Python tests..."
	cd packages/agent-backend/python && uv run pytest -m "not integration" --cov=agent_backend --cov-report=term-missing --cov-fail-under=80

test-unit: ## Run unit tests only
	@echo "Running unit tests..."
	pnpm -r run test:unit 2>/dev/null || echo "No unit tests configured"

typecheck-typescript: ## Type check TypeScript packages
	@echo "Type checking TypeScript packages..."
	pnpm -r typecheck

typecheck-python: ## Type check Python package
	@echo "Type checking Python package..."
	cd packages/agent-backend/python && uv run ty check

lint-typescript: ## Lint TypeScript packages
	@echo "Linting TypeScript packages..."
	pnpm -r --filter '!nextjs-agent-backend-demo' lint

lint-python: ## Lint Python package
	@echo "Linting Python package..."
	cd packages/agent-backend/python && uv run ruff check .

##@ Publishing & CI

publish: ## Bump versions, create release branch & PR (manually trigger publish after merge)
	./manage.sh publish

publish-typescript: ## Publish TypeScript package to npm
	@echo "Publishing TypeScript package..."
	./manage.sh publish

publish-python: build-python ## Publish Python package to PyPI
	@echo "Publishing Python package..."
	uv run twine upload dist/agent_backend-*

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

docker-build: ## Build agentbe-daemon Docker image
	@echo "Building agent-backend TypeScript package..."
	@pnpm --filter=agent-backend build
	@echo "Building agentbe-daemon Docker image..."
	@cd agentbe-daemon/docker && \
		docker build -f Dockerfile -t agentbe-daemon:latest ../..
