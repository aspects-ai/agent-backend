# Python Client Library

Python implementation of the `agent-backend` package. See the [main README](../README.md) for an overview, quick start, and core usage.

## Package Info

| Field        | Value                       |
|--------------|-----------------------------|
| Package      | `agent-backend`             |
| Registry     | PyPI                        |
| Manager      | uv / pip                    |
| Test runner  | pytest                      |
| Build        | python -m build             |
| Linter       | ruff                        |
| Type checker | mypy                        |
| Source        | `python/agent_backend/`    |
| Tests         | `python/tests/`            |

## Advanced Features

### Environment Variables

Scoped backends support custom environment variables that apply to all commands:

```python
from agent_backend import ScopeConfig

scoped_backend = backend.scope("projects/my-app", ScopeConfig(
    env={
        "PYTHONPATH": "/workspace/lib",
        "API_KEY": "secret",
        "DATABASE_URL": "postgres://...",
    }
))

await scoped_backend.exec("python -m build")  # uses custom env
```

### Operations Logging

```python
from agent_backend import ConsoleOperationsLogger, ScopeConfig

scoped_backend = backend.scope("project", ScopeConfig(
    operations_logger=ConsoleOperationsLogger()
))

await scoped_backend.exec("pip install -r requirements.txt")
# Logs: [AgentBackend] exec: pip install -r requirements.txt
```

### Binary Data

```python
from agent_backend import ReadOptions

image_data = await backend.read("logo.png", ReadOptions(encoding="buffer"))
tarball = await backend.exec("tar -czf - .", ExecOptions(encoding="buffer"))
```

### Timeouts

```python
from agent_backend import RemoteFilesystemBackend, RemoteFilesystemBackendConfig

backend = RemoteFilesystemBackend(RemoteFilesystemBackendConfig(
    root_dir="/tmp/agentbe-workspace",
    host="server.com",
    auth_token="...",
    operation_timeout_ms=300_000,  # 5 minutes
    max_output_length=10 * 1024 * 1024,  # 10MB
))
```

## Backend Connection Pooling

See [docs/connection-pooling.md](../docs/connection-pooling.md) for `BackendPoolManager` usage, key-based pooling, idle cleanup, and graceful shutdown.

## Examples

### Code Execution Sandbox

```python
from agent_backend import LocalFilesystemBackend, LocalFilesystemBackendConfig, IsolationMode

sandbox = LocalFilesystemBackend(LocalFilesystemBackendConfig(
    root_dir="/tmp/agentbe-workspace",
    isolation=IsolationMode.AUTO,
))

user_code_backend = sandbox.scope(f"users/{user_id}")
await user_code_backend.write("script.py", untrusted_code)
result = await user_code_backend.exec("python script.py")
```

### Multi-tenant SaaS

```python
from agent_backend import RemoteFilesystemBackend, RemoteFilesystemBackendConfig

# Separate backend per organization
org1_backend = RemoteFilesystemBackend(RemoteFilesystemBackendConfig(
    root_dir="/var/saas/org1",
    host="org1-server.example.com",
    auth_token="...",
))

org2_backend = RemoteFilesystemBackend(RemoteFilesystemBackendConfig(
    root_dir="/var/saas/org2",
    host="org2-server.example.com",
    auth_token="...",
))

# Scoped backends per user within each org
org1_user1 = org1_backend.scope("users/user1")
org1_user2 = org1_backend.scope("users/user2")
```

### Agent State Management

```python
from agent_backend import MemoryBackend

state = MemoryBackend()

await state.write("agents/agent1/current-task", "building")
await state.write("agents/agent1/progress", "50%")

all_agents = await state.list_keys("agents/")
```

## Error Handling

```python
from agent_backend import BackendError, DangerousOperationError, PathEscapeError

try:
    await backend.exec("rm -rf /")
except DangerousOperationError as e:
    # Command blocked by safety validation
    print("Blocked:", e.operation)
except PathEscapeError:
    # Path attempted to escape scope
    pass
except BackendError as e:
    # General backend error (check e.code)
    print("Error:", e.code, str(e))
```

---

## Development

### Commands

All commands can be run from the monorepo root via Make or from the `python/` directory via uv.

| Task        | Make (root)              | uv (`python/`)                                      |
|-------------|--------------------------|------------------------------------------------------|
| Build       | `make build-python`      | `uv build`                                           |
| Test        | `make test-python`       | `uv run pytest`                                      |
| Test (cov)  | --                       | `uv run pytest --cov=agent_backend --cov-fail-under=80` |
| Lint        | `make lint-python`       | `uv run ruff check .`                               |
| Lint (fix)  | `make lint-fix`          | `uv run ruff check --fix .`                         |
| Typecheck   | `make typecheck-python`  | `uv run ty check`                                   |

### Code Style

- ruff enforces formatting (`line-length = 100`, `target-version = "py311"`)
- Type hints on all function signatures -- avoid `Any`
- `snake_case` for functions and variables, `PascalCase` for classes
- Dataclasses for all config objects (`LocalFilesystemBackendConfig`, `ScopeConfig`, etc.)
- Custom error classes: `BackendError`, `DangerousOperationError`, `PathEscapeError`
- Imports sorted with ruff (`isort` rules enabled)

### Testing

Tests live in `python/tests/` and use pytest with `pytest-asyncio`.

`asyncio_mode = "auto"` is configured in `pyproject.toml`, so async test functions are detected automatically -- no `@pytest.mark.asyncio` decorator needed.

**Shared fixtures** in `conftest.py` provide pre-configured backends:

```python
@pytest.fixture
def local_backend(tmp_workspace):
    config = LocalFilesystemBackendConfig(
        root_dir=tmp_workspace,
        prevent_dangerous=True,
    )
    return LocalFilesystemBackend(config)
```

Use `unittest.mock.AsyncMock` for mocking async methods. Use the shared fixtures (`local_backend`, `memory_backend`, `tmp_workspace`) rather than building backends from scratch.

**Running tests:**

```bash
uv run pytest                            # All tests, single run
uv run pytest -k "safety"               # Filter by pattern
uv run pytest --cov=agent_backend       # With coverage report
uv run pytest -m "not integration"      # Skip integration tests
```

### Gotchas

- All backend methods are `async` -- always `await` them, including `read`, `write`, `readdir`, and `exists`.
- `MemoryBackend.exec()` raises `NotImplementedBackendError` -- memory backends do not support command execution.
- Use `list_keys(prefix)` on `MemoryBackend`, not `list()`.
- `IsolationMode.AUTO` and `IsolationMode.NONE` are enum members, not string literals.
- `BackendType` enum values are `"local-filesystem"`, `"remote-filesystem"`, `"memory"`.
- Config objects are dataclasses, not dicts -- use keyword arguments (e.g., `LocalFilesystemBackendConfig(root_dir=...)`).
- Scoped backends delegate `track_closeable()` to their parent, so resources are closed when the parent is destroyed.
- `destroy()` closes all tracked closeables (MCP clients, transports) before tearing down the backend.
- Coverage threshold is 80% (`--cov-fail-under=80`). Remote backend and transport modules are excluded from coverage.
- `ExecOptions` and `ReadOptions` use `encoding: Literal["utf8", "buffer"]`, not Python's standard encoding names.
