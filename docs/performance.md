# Performance Considerations

## Overview

Performance characteristics vary significantly between backend types based on their underlying protocols and deployment architecture.

---

## LocalFilesystemBackend

### Latency
- **File operations:** 1-5ms (direct OS filesystem APIs)
- **Command execution:** 5-50ms (local process spawn)

### Throughput
- **File reads:** Limited by disk I/O and buffer sizes
- **Commands:** Limited by CPU and process spawn overhead

### Optimization Tips
- Use batch operations when possible
- Avoid excessive small file operations
- Consider caching for frequently-read files
- Use streaming for large files

### Best For
- High-frequency file operations
- Low-latency requirements
- Single-machine deployments
- Development and testing

---

## RemoteFilesystemBackend

### Latency
- **File operations:** 10-100ms (SSH/SFTP + network round-trip)
- **Command execution:** 20-200ms (HTTP MCP + network round-trip)

### Throughput
- **File reads:** Limited by network bandwidth and SSH overhead
- **Commands:** Limited by network latency and HTTP request overhead

### Network Impact
- **LAN:** ~5-20ms base latency
- **WAN:** ~50-200ms base latency (varies by distance)
- **Bandwidth:** SFTP typically achieves 50-80% of raw network bandwidth

### Optimization Tips
- **Use connection pooling** (BackendPoolManager) - reuses SSH connections
- **Batch file operations** - combine multiple operations to reduce round-trips
- **Keep SSH connections alive** - avoid reconnection overhead
- **Use MCP for bulk operations** - can be more efficient than individual file ops
- **Consider compression** - Enable SSH compression for large transfers
- **Persistent connections** - Maintain long-lived connections for active workloads

### Best For
- Isolated execution environments
- Distributed architectures
- When network latency is acceptable (< 100ms)
- Production deployments with security requirements

---

## MemoryBackend

### Latency
- **All operations:** < 1ms (in-memory hash map)

### Throughput
- **Limited by:** In-memory hash map access speed and memory allocation
- **Typical:** 100K+ operations/second

### Memory Usage
- All data stored in process memory
- No persistence across restarts
- Memory grows with stored data size

### Best For
- Testing and development
- Caching scenarios
- Temporary storage
- Mock implementations

---

## Connection Pooling

The `BackendPoolManager` significantly improves performance for stateless request/response patterns:

### Benefits
- **Reuses SSH connections** - avoids 100-500ms connection overhead
- **Reduces memory** - limits total concurrent connections
- **Automatic cleanup** - closes idle connections after timeout

### Configuration
```text
pool = BackendPoolManager(
  backendClass:    RemoteFilesystemBackend,
  defaultConfig:   { ... },
  maxIdleTime:     30000,    // Close after 30s idle
  cleanupInterval: 5000      // Check every 5s
)

// Each request gets a pooled connection
pool.withBackend(key: userId, func(backend):
    return backend.exec("npm test")
)
```

### Performance Impact
- **First request:** Full connection overhead (~200-500ms)
- **Subsequent requests:** Near-zero connection overhead (~1-5ms)
- **Memory:** Fixed pool size vs unlimited connections

---

## MCP Protocol Overhead

### HTTP MCP (Remote)
- **Per-request overhead:** 5-20ms (HTTP parsing, JSON serialization)
- **Connection:** Stateless HTTP requests (no connection reuse by default)
- **Optimization:** Use keep-alive connections, batch operations

### Stdio MCP (Local)
- **Per-request overhead:** < 1ms (JSON serialization only)
- **Connection:** Persistent stdin/stdout pipes
- **Optimization:** Already optimal for local use

---

## Benchmark Examples

These are approximate values for typical hardware (2023-era laptop/server):

### LocalFilesystemBackend
```
File Operations:
- write(1KB):     1-2ms
- read(1KB):      1-2ms
- readdir(100):   2-5ms
- exec('ls'):     5-10ms
- exec('npm i'):  2000-5000ms
```

### RemoteFilesystemBackend (LAN)
```
File Operations (SSH/SFTP):
- write(1KB):     15-30ms
- read(1KB):      15-30ms
- readdir(100):   20-40ms

Commands (MCP HTTP):
- exec('ls'):     25-50ms
- exec('npm i'):  2000-5000ms + network latency
```

### RemoteFilesystemBackend (WAN, 50ms latency)
```
File Operations (SSH/SFTP):
- write(1KB):     100-150ms
- read(1KB):      100-150ms
- readdir(100):   120-180ms

Commands (MCP HTTP):
- exec('ls'):     150-200ms
- exec('npm i'):  2000-5000ms + network latency
```

---

## Choosing for Performance

### Choose LocalFilesystemBackend when:
- Operations/second > 100
- Latency requirement < 10ms
- Network is not available
- Single-machine deployment is acceptable

### Choose RemoteFilesystemBackend when:
- Security/isolation is more important than speed
- Network latency < 100ms is acceptable
- Distributed architecture is required
- Connection pooling can be used

### Choose MemoryBackend when:
- Operations/second > 10,000
- Latency requirement < 1ms
- Persistence is not needed
- Data size fits in memory

---

## Profiling Tips

### Measure your workload
```text
start = now()
backend.exec("npm install")
print("Took", now() - start, "ms")
```

### Identify bottlenecks
- **High latency per operation?** Network issue or protocol overhead
- **High total time?** Too many sequential operations, consider batching
- **Memory growth?** Connection leak or missing cleanup

### Use connection pooling
```text
// Before: New connection per request (~200ms overhead each)
for user in users:
    backend = RemoteFilesystemBackend(config)
    backend.connect()
    backend.exec("command")
    backend.disconnect()

// After: Pooled connections (~1ms overhead each)
for user in users:
    pool.withBackend(key: user.id, func(backend):
        backend.exec("command")
    )
```

### Monitor resource usage
- SSH connections: `netstat -an | grep :22`
- Memory: Use your runtime's memory profiling tools
- Event loop / async health: Use your runtime's latency monitoring
