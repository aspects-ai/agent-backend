# Contributing to AgentBackend

Thank you for your interest in contributing to AgentBackend! We welcome contributions from everyone, whether you're fixing bugs, adding features, improving documentation, or helping with other aspects of the project.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## How to Contribute

### Reporting Issues

Before creating an issue, please:

1. **Search existing issues** to avoid duplicates
2. **Check the documentation** to ensure it's not a usage question
3. **Use the appropriate issue template** when creating new issues

When reporting bugs, please include:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node.js version, OS, etc.)
- Minimal code example if applicable

### Suggesting Features

We welcome feature suggestions! Please:
- Use the feature request template
- Explain the use case and benefit
- Consider implementation complexity
- Be open to discussion and alternatives

## Development Setup

This is a multi-language monorepo (TypeScript + Python). Use Makefile for all commands.

### Prerequisites

- Node.js 18+
- pnpm (package manager)
- Git
- Docker (for remote backend testing)

### Initial Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/agent-backend.git
   cd agent-backend
   ```

2. **Install dependencies**
   ```bash
   make install        # Installs deps + mprocs
   ```

3. **Run tests to ensure everything works**
   ```bash
   make test
   ```

4. **Build the project**
   ```bash
   make build
   ```

5. **Link CLI for development** (optional but recommended)
   ```bash
   cd typescript && pnpm link --global
   ```
   This makes the `agent-backend` CLI available system-wide and keeps it synced with your dev changes.

### Common Commands

```bash
make help           # Show all available commands
make install        # Install dependencies (including mprocs)
make build          # Build all packages
make test           # Run all tests
make typecheck      # Type check everything
make ci             # Full CI pipeline
```

Language-specific: `make build-typescript`, `make test-python`, etc.

### Development Mode

Start all dev processes with unified TUI:

```bash
make dev            # Local development (TypeScript + NextJS)
make dev-remote     # Test with Docker-based remote backend
```

Uses [mprocs](https://github.com/pvolok/mprocs) for process management with interactive TUI, auto-restart on changes, and Docker support.

**mprocs keyboard shortcuts:**
- `Tab`/`Shift+Tab` - Cycle through processes
- `Space` - Start/stop process
- `r` - Restart process
- `f` - Focus process (full screen)
- `/` - Search logs
- `q` - Quit all

### Development Workflows

#### Working on TypeScript Package

```bash
make dev

# In mprocs:
# 1. Watch typescript-watch logs to see compilation
# 2. Make changes to typescript/src/**
# 3. See rebuild happen automatically
# 4. NextJS picks up changes on next request
```

#### Working on NextJS Example

```bash
make dev

# In mprocs:
# 1. Focus on nextjs-dev logs (press f)
# 2. Make changes to examples/NextJS/app/**
# 3. See hot reload in browser
```

#### Testing Remote Backend Locally

```bash
make dev-remote     # Auto-builds Docker image if needed

# This simulates:
# - Remote server with MCP server on port 3001
# - SSH access on port 2222 (user: root, password: agents)
# - NextJS connecting to "remote" backend
```

#### Adding Python Examples

Edit `mprocs.yaml`:
```yaml
procs:
  python-app:
    cmd: ["python", "-m", "uvicorn", "main:app", "--reload"]
    cwd: "examples/python-app"
```

Then run `make dev` - Python app starts automatically.

### Docker Commands

```bash
make docker-build   # Build agentbe-daemon Docker image
make docker-clean   # Remove containers and images
```

Manual testing:
```bash
docker run --rm -it \
  -p 3001:3001 -p 2222:22 \
  -v "$(pwd)/tmp/workspace:/var/workspace" \
  agentbe-daemon:latest

# Test: ssh -p 2222 root@localhost (password: agents)
# Test: curl http://localhost:3001/health
```

### Configuration

- **mprocs.yaml** - All dev processes (edit to add new services)
- **.env** - Daemon configuration (copy from `.env.example`)

Use `REMOTE=1 mprocs` or `make dev-remote` to enable the Docker daemon.

### Troubleshooting

**mprocs not found**
```bash
make install        # Includes mprocs (macOS: Homebrew, Linux: cargo)
```

**Port conflicts**
```bash
lsof -ti:3000 | xargs kill -9    # NextJS
lsof -ti:3001 | xargs kill -9    # MCP server
```

**TypeScript changes not appearing**
1. Check typescript-watch logs in mprocs
2. Verify compilation succeeded
3. Restart nextjs-dev (press `r` in mprocs)

**Remote mode not working**
1. Verify Docker image: `docker images | grep agentbe-daemon`
2. Check container: `docker ps | grep agentbe-daemon`
3. Test MCP: `curl http://localhost:3001/health`
4. View logs: `docker logs agentbe-daemon`

### Development Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes**
   - Write code following our style guidelines
   - Add tests for new functionality
   - Update documentation as needed

3. **Run quality checks & tests**
   ```bash
   make typecheck      # Verify TypeScript types
   make build          # Ensure it builds
   make test           # Run tests
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

5. **Push and create a pull request**
   ```bash
   git push origin feature/your-feature-name
   ```

## Code Style Guidelines

### TypeScript Standards

- Use TypeScript for all new code
- Prefer explicit types over `any`
- Use interfaces for object shapes
- Export types that might be useful to consumers

### Code Organization

- Keep functions focused and single-purpose
- Use descriptive variable and function names
- Add JSDoc comments for public APIs
- Group related functionality in modules

### Testing

- Write tests for new features and bug fixes
- Prefer unit tests over integration tests
- Use descriptive test names

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation changes
- `style:` code style changes (formatting, etc.)
- `refactor:` code refactoring
- `test:` adding or updating tests
- `chore:` maintenance tasks

Examples:
```
feat(agentbe-typescript): add userId-based workspace management
fix(remote): handle edge case in path resolution
docs(agentbe): update README with new examples
```

## Pull Request Process

1. **Ensure your PR**:
   - Has a clear title and description
   - Links to related issues
   - Includes tests for changes
   - Updates documentation if needed
   - Passes all CI checks

2. **PR Review Process**:
   - PRs require at least one review
   - Address feedback promptly
   - Keep discussions constructive
   - Be patient with the review process

3. **After Approval**:
   - PRs are squash-merged to main
   - Delete your feature branch after merge

## Documentation

### Code Documentation

- Use JSDoc for public APIs
- Include parameter and return type information
- Add usage examples for complex functions
- Document any gotchas or limitations

## Release Process

Releases are handled by maintainers:

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create GitHub release
4. Publish to npm

## Getting Help

- **Questions**: Use GitHub Discussions
- **Bugs**: Create an issue with the bug template
- **Features**: Create an issue with the feature template

## Recognition

Contributors are recognized in:
- GitHub contributors list
- Release notes for significant contributions
- Special mentions for ongoing contributors

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to AgentBackend! 🌟