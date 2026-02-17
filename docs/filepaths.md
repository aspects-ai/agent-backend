# Conventions

This document describes project-wide conventions that apply across the agent-backend ecosystem.

## Path Handling

All file-based backends follow consistent path handling conventions. These conventions ensure flexibility while maintaining security through path escape prevention.

### The Three Cases

1. **Relative paths** (e.g., `.`, `file.txt`, `subdir/file.txt`)
   - Resolved relative to the workspace root (rootDir or scope)
   - Examples:
     - `file.txt` → `/var/workspace/file.txt`
     - `subdir/file.txt` → `/var/workspace/subdir/file.txt`
     - `.` → `/var/workspace`

2. **Absolute paths matching workspace** (e.g., `/var/workspace/file.txt` when rootDir is `/var/workspace`)
   - Used directly since they're already within the workspace
   - Validated to ensure they don't escape the boundary
   - Examples:
     - `/var/workspace/file.txt` → `/var/workspace/file.txt`
     - `/var/workspace/a/b/c` → `/var/workspace/a/b/c`

3. **Absolute paths not matching workspace** (e.g., `/other/file.txt`)
   - Treated as relative to the workspace (leading slashes stripped)
   - This prevents accidental access to system paths while allowing absolute-style references
   - Examples:
     - `/file.txt` → `/var/workspace/file.txt`
     - `/etc/passwd` → `/var/workspace/etc/passwd`

### Security: Path Escape Prevention

All paths are validated to ensure they stay within the workspace boundary:

```text
// These are REJECTED with PathEscapeError:
'../etc/passwd'           // Escapes via parent directory
'../../..'                // Escapes to filesystem root
'a/b/../../../../etc'     // Escapes via complex traversal
```

### Scoped Workspaces

Scoped backends (created via `backend.scope('subdir')`) follow the same conventions, but the boundary is the scope's full path (parent rootDir + scopePath):

```text
Context:
  Root Backend: /var/workspace
  Scoped Backend: users/user1

Path Resolution:
  read("file.txt")                            -> /var/workspace/users/user1/file.txt
  read("/file.txt")                           -> /var/workspace/users/user1/file.txt
  read("/var/workspace/users/user1/file.txt") -> /var/workspace/users/user1/file.txt
  read("../user2/secret")                     -> ERROR: Path Escape
```

Scoped backends validate paths against their full `rootDir` (e.g., `/var/workspace/users/user1`), so absolute paths that include the full path work correctly. This is implemented in both `ScopedFilesystemBackend` and `ScopedMemoryBackend`.

### Backend-Specific Notes

| Backend | Path Module | Notes |
|---------|-------------|-------|
| `LocalFilesystemBackend` | Native `path` | Uses OS-specific path handling |
| `RemoteFilesystemBackend` | `path.posix` | Always uses POSIX paths for remote Unix systems |
| `ScopedFilesystemBackend` | Inherits from parent | Adds scope boundary validation |
| `MemoryBackend` | `path.posix` | Keys are treated as paths |
| `ScopedMemoryBackend` | `path.posix` | Adds scope prefix validation |
