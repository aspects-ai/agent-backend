# Python Development

Python-specific development guide for Agent Backend.

> Python support is under active development. The commands below work when the `python/` directory contains a valid `pyproject.toml`.

## Commands

| Task        | Command                    |
|-------------|----------------------------|
| Build       | `make build-python`        |
| Test        | `make test-python`         |
| Lint        | `make lint-python`         |
| Typecheck   | `make typecheck-python`    |

### Details

- **Build** uses `python -m build` to produce distributable packages.
- **Test** runs `pytest` from the `python/` directory.
- **Lint** runs `ruff check .` from the `python/` directory.
- **Typecheck** runs `mypy .` from the `python/` directory.

### Install

To install the Python package in development mode with dev dependencies:

```bash
cd python
pip install -e .[dev]
```

Or use `make install` from the monorepo root, which handles both TypeScript and Python dependencies.
