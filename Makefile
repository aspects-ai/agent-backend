.PHONY: help install build test typecheck lint clean dev publish start-daemon stop-daemon

# Default target - show help
.DEFAULT_GOAL := help

# Colors for output
CYAN := \033[0;36m
RESET := \033[0m

##@ General

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@awk 'BEGIN {FS = ":.*##"; printf "Available targets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  $(CYAN)%-15s$(RESET) %s\n", $$1, $$2 } /^##@/ { printf "\n%s\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Dependencies

install: ## Install all dependencies (TypeScript + Python + dev tools)
	@echo "Installing TypeScript dependencies..."
	pnpm install
	@echo ""
	@echo "Installing Python dependencies..."
	@if [ -d "python" ]; then \
		cd python && pip install -e .[dev]; \
	else \
		echo "Python package not found (will be added later)"; \
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

##@ Build

build: build-typescript build-python ## Build all packages

build-typescript: ## Build TypeScript packages only
	@echo "Building TypeScript packages..."
	pnpm -r build

build-python: ## Build Python package only
	@echo "Building Python package..."
	@if [ -d "python" ]; then \
		cd python && python -m build; \
	else \
		echo "Python package not found (skipping)"; \
	fi

##@ Testing

test: test-typescript test-python ## Run all tests

test-typescript: ## Run TypeScript tests only
	@echo "Running TypeScript tests..."
	pnpm -r test

test-python: ## Run Python tests only
	@echo "Running Python tests..."
	@if [ -d "python" ]; then \
		cd python && pytest; \
	else \
		echo "Python package not found (skipping)"; \
	fi

test-unit: ## Run unit tests only
	@echo "Running unit tests..."
	pnpm -r run test:unit 2>/dev/null || echo "No unit tests configured"

##@ Type Checking & Linting

typecheck: typecheck-typescript typecheck-python ## Run type checking for all packages

typecheck-typescript: ## Type check TypeScript packages only
	@echo "Type checking TypeScript packages..."
	pnpm -r typecheck

typecheck-python: ## Type check Python package only
	@echo "Type checking Python package..."
	@if [ -d "python" ]; then \
		cd python && mypy .; \
	else \
		echo "Python package not found (skipping)"; \
	fi

lint: lint-typescript lint-python ## Lint all packages

lint-typescript: ## Lint TypeScript packages only
	@echo "Linting TypeScript packages..."
	pnpm -r lint

lint-python: ## Lint Python package only
	@echo "Linting Python package..."
	@if [ -d "python" ]; then \
		cd python && ruff check .; \
	else \
		echo "Python package not found (skipping)"; \
	fi

lint-fix: ## Auto-fix linting issues
	@echo "Auto-fixing TypeScript..."
	pnpm -r lint:fix || true
	@echo "Auto-fixing Python..."
	@if [ -d "python" ]; then \
		cd python && ruff check --fix .; \
	fi

##@ Development

dev: ## Start all dev processes with interactive TUI (local mode)
	@command -v mprocs >/dev/null 2>&1 || { \
		echo "Error: mprocs not installed. Run 'make install' first."; \
		exit 1; \
	}
	mprocs

dev-remote: ## Start dev with Docker-based daemon
	@command -v mprocs >/dev/null 2>&1 || { \
		echo "Error: mprocs not installed. Run 'make install' first."; \
		exit 1; \
	}
	@command -v docker >/dev/null 2>&1 || { \
		echo "Error: Docker not installed"; \
		echo "Install: https://docs.docker.com/get-docker/"; \
		exit 1; \
	}
	@mkdir -p tmp/deploy
	@if ! docker images | grep -q "agentbe-daemon.*latest"; then \
		echo "Docker image not found. Building agentbe-daemon:latest..."; \
		$(MAKE) docker-build; \
	fi
	REMOTE=1 mprocs

clean: ## Clean build artifacts and dependencies
	@echo "Cleaning TypeScript packages..."
	rm -rf typescript/dist typescript/node_modules
	rm -rf examples/NextJS/dist examples/NextJS/.next examples/NextJS/node_modules
	rm -rf node_modules
	@echo "Cleaning Python package..."
	@if [ -d "python" ]; then \
		cd python && rm -rf dist build *.egg-info .pytest_cache .mypy_cache __pycache__; \
	fi
	@echo "Cleaning development artifacts..."
	rm -rf tmp/
	@echo "Cleaning lockfiles..."
	rm -f pnpm-lock.yaml

##@ Docker

docker-build: build-typescript ## Build Docker image for daemon testing
	@echo "Building agentbe-daemon Docker image..."
	@cd typescript/deploy/docker && \
		docker build -f Dockerfile.runtime -t agentbe-daemon:latest ../../..

docker-clean: ## Remove agentbe-daemon Docker images and containers
	@echo "Stopping and removing containers..."
	@docker stop agentbe-daemon 2>/dev/null || true
	@docker rm agentbe-daemon 2>/dev/null || true
	@echo "Removing images..."
	@docker rmi agentbe-daemon:latest 2>/dev/null || true

start-daemon: ## Start agentbe-daemon Docker container in background
	@command -v docker >/dev/null 2>&1 || { \
		echo "Error: Docker not installed"; \
		echo "Install: https://docs.docker.com/get-docker/"; \
		exit 1; \
	}
	@if ! docker images | grep -q "agentbe-daemon.*latest"; then \
		echo "Docker image not found. Building agentbe-daemon:latest..."; \
		$(MAKE) docker-build; \
	fi
	@mkdir -p typescript/deploy/docker/var/workspace
	@if docker ps -q -f name=agentbe-daemon | grep -q .; then \
		echo "agentbe-daemon is already running"; \
	else \
		echo "Starting agentbe-daemon..."; \
		docker run -d --name agentbe-daemon \
			-p 2222:22 -p 3001:3001 \
			-v $(PWD)/typescript/deploy/docker/var/workspace:/var/workspace \
			--restart unless-stopped \
			agentbe-daemon:latest; \
		echo "✓ agentbe-daemon started (SSH: 2222, MCP: 3001)"; \
	fi

stop-daemon: ## Stop agentbe-daemon Docker container
	@if docker ps -q -f name=agentbe-daemon | grep -q .; then \
		echo "Stopping agentbe-daemon..."; \
		docker stop agentbe-daemon; \
		docker rm agentbe-daemon; \
		echo "✓ agentbe-daemon stopped"; \
	else \
		echo "agentbe-daemon is not running"; \
	fi

##@ Publishing & Deployment

publish-typescript: ## Publish TypeScript package to npm
	@echo "Publishing TypeScript package..."
	./manage.sh publish

publish-python: ## Publish Python package to PyPI
	@echo "Publishing Python package..."
	@if [ -d "python" ]; then \
		cd python && python -m twine upload dist/*; \
	else \
		echo "Python package not found"; \
	fi

start-deploy-ui: ## Start deployment UI for cloud VM setup
	./manage.sh start-deploy-ui

##@ Continuous Integration

ci: install typecheck lint test ## Run full CI pipeline (install, typecheck, lint, test)

ci-fast: typecheck test-unit ## Run fast CI checks (typecheck + unit tests only)
