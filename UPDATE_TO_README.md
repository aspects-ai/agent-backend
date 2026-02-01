# Plan: Update NextJS Web Demo README

## Objective
Update `examples/NextJS/README.md` to comprehensively document the demo's public-facing capabilities and usage patterns, serving as a specification for future code updates.

## Current State Analysis

**What Demo Actually Does**:
- Dual AI routing: Codebuff SDK OR Vercel AI SDK + MCP (controlled by `USE_MCP` env var)
- Multi-agent orchestration system (orchestrator, React builder, ETL pipeline)
- Real-time chat with SSE streaming
- Live file explorer with syntax highlighting
- Component sandbox (Sandpack integration for live React previews)
- Cyberpunk-themed UI with Mantine components
- Local + Remote backend support (SSH)

**Current README Issues**:
- Outdated: References Claude Code SDK (line 116-143)
- Missing: Dual routing explanation, multi-agent system, component sandbox
- Incomplete: No environment variables table, no architecture diagram for dual routing
- Gaps: Doesn't explain cyberpunk theme, Sandpack, or sophisticated agent patterns

**Code Compatibility Issues Found** (to document as known issues):
- Demo uses archived `FileSystem` and `AgentBackend.setConfig()` (not in current public API)
- Environment variables in `.env.local` use old `CONSTELLATION_*` naming
- Docker paths reference wrong directory

## README Update Plan

### Structure (16 sections, ~400 lines)

#### 1. Hero Section (lines 1-15)
**Update**: Add visual appeal, feature badges, deploy button
```markdown
# AgentBackend NextJS Demo

Interactive web app showcasing AgentBackend with dual AI routing,
real-time streaming, and multi-agent orchestration.

🤖 Dual AI Routing • 🔄 Real-time Streaming • 📁 Live File Explorer
🎨 Component Sandbox • 🛡️ Isolated Workspaces • 🌐 Local + Remote
```

#### 2. Quick Start (lines 16-40)
**Update**: Three paths for different audiences
- Path A: Local dev (5 min setup)
- Path B: Vercel deploy (1-click)
- Path C: Docker (full testing)

#### 3. Architecture (NEW - lines 41-80)
**Add**: Visual ASCII diagram showing dual routing
```
Browser → Next.js API → Routing Logic → Backends
                          ↓        ↓
                      Codebuff  Vercel+MCP
                          ↓        ↓
                      AgentBackend (Local/Remote)
```

**Add**: Routing table
| USE_MCP | AI SDK | Integration | Use Case |
|---------|--------|-------------|----------|
| false | Codebuff | Direct workspace | Multi-agent orchestration |
| true | Vercel AI | MCP tools | Standard streaming API |

#### 4. Environment Variables (NEW - lines 81-120)
**Add**: Complete reference table

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENTBE_WORKSPACE_ROOT` | ✅ Yes | - | Workspace root directory |
| `NEXT_PUBLIC_AGENTBE_TYPE` | No | `local` | `local` or `remote` |
| `USE_MCP` | No | `false` | Routing: Codebuff or Vercel AI |
| `NEXT_PUBLIC_CODEBUFF_API_KEY` | If USE_MCP=false | - | Codebuff API key |
| `OPENROUTER_API_KEY` | If USE_MCP=true | - | OpenRouter API key |
| `REMOTE_VM_HOST` | If remote | - | SSH hostname |
| `REMOTE_VM_PASSWORD` | If remote | - | SSH password |
| `REMOTE_MCP_AUTH_TOKEN` | Optional | - | Remote MCP auth |

**Add**: Note about outdated naming in `.env.local`

#### 5. Features Deep Dive (lines 121-200)

**5a. Dual AI Routing**
- When to use Codebuff (direct workspace, multi-agent)
- When to use Vercel AI (standard MCP, streaming)
- Code snippet for each path

**5b. Multi-Agent Orchestration**
- Orchestrator agent (task coordination)
- React TypeScript Builder
- ETL Manager (Extract → Transform → Load pipeline)
- List all 7 agents with purposes

**5c. Component Sandbox**
- Live React rendering with Sandpack
- Hot reload on file changes
- Isolated preview environment

**5d. File Explorer**
- Real-time updates
- Syntax highlighting
- Upload/download

**5e. Cyberpunk UI**
- Mantine components
- Neon styling
- Matrix animations

#### 6. API Endpoints (lines 201-230)
**Update**: Complete endpoint table

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/message` | POST | Send message to AI |
| `/api/stream` | GET | SSE response stream |
| `/api/filesystem` | GET | File tree |
| `/api/file-content` | GET | Read file |
| `/api/upload` | POST | Upload files |
| `/api/download` | GET | Download files |
| `/api/sandbox-files` | GET | List sandbox files |
| `/api/sandbox-render` | GET | Render component |

#### 7. Try These Prompts (lines 231-270)
**Expand**: Categorized examples

**Basic Operations**:
- Create files, list workspace

**Component Building**:
- "Create a React counter component"
- "Build a dashboard with charts"

**Data Processing (ETL)**:
- "Find top 10 coffee shops in SF"
- "Research YC startups in healthcare"

**Multi-file Projects**:
- Full apps with proper structure

#### 8. Deployment Guides (lines 271-340)

**8a. Local Development**
```bash
npm install
npm run dev
# Visit http://localhost:3000
```

**8b. Docker Deployment**
```bash
docker-compose up --build
```
Fix: Note docker-compose.yml has path issue

**8c. Vercel Deployment**
- Environment variable setup
- Timeout considerations (60s limit)

#### 9. How It Works (lines 341-380)
**Update**: User flow with dual routing
1. User sends message
2. Route based on USE_MCP flag
3. AI processing (Codebuff OR Vercel AI)
4. Backend operations (local OR remote)
5. Stream response via SSE
6. Update file explorer

#### 10. Usage Patterns (NEW - lines 381-440)
**Add**: Code examples for reference

**Pattern 1**: Current demo usage (FileSystem wrapper)
**Pattern 2**: Codebuff integration
**Pattern 3**: MCP integration
**Pattern 4**: Migration to new API (future)

#### 11. Project Structure (lines 441-480)
**Update**: Annotated tree with agent descriptions
```
lib/agents/
├── orchestrator-agent.ts      # Master coordinator
├── react-typescript-builder.ts # UI builder
├── etl-manager.ts             # Data pipeline
├── extract-agent.ts           # Data extraction
├── transform-agent.ts         # Data transformation
└── load-agent.ts              # Data loading
```

#### 12. Technical Details (lines 481-520)
**Update**: Remove Claude Code SDK references, add:
- Dual routing implementation
- Session management
- SSE streaming
- Security features (workspace isolation, dangerous command blocking)

#### 13. Known Issues (NEW - lines 521-550)
**Add**: Transparent documentation
1. Uses archived `FileSystem` API (not current public API)
2. `.env.local` has old `CONSTELLATION_*` naming
4. Vercel timeout limitations (60s)
5. Missing features: No pooling, MemoryBackend, or logging demonstrations

#### 14. Troubleshooting (lines 551-580)
**Add**: Common issues
- Module not found
- Connection errors
- API key issues
- Timeout problems

#### 15. What's Next (lines 581-600)
**Add**: Roadmap
- [ ] Migrate to current public API
- [ ] Add MemoryBackend demo
- [ ] Show pooling patterns
- [ ] Add authentication
- [ ] Persist workspaces

#### 16. Contributing & License (lines 601-620)
**Keep**: Links to main docs

## Content Priorities

**Must Highlight** (top 30% of README):
1. Dual AI routing capability
2. Multi-agent orchestration
3. Component sandbox
4. Easy deployment

**Should Document** (middle 50%):
1. Environment variables (complete table)
2. All features with examples
3. API endpoints
4. Deployment guides

**Can Be Brief** (bottom 20%):
1. Known issues
2. Project structure details
3. Future enhancements

## Writing Style

- **Tone**: Professional but approachable, transparent about limitations
- **Format**: Scannable (headers, tables, code blocks, bullets)
- **Examples**: Concrete code snippets throughout
- **Visual**: ASCII diagrams, emoji markers, tables
- **Voice**: Active, present tense, direct ("You can" not "Users can")

## Critical Files to Modify

1. `/Users/danny/Documents/devspresso/constellation-fs/examples/NextJS/README.md` - Main update target

## Verification Plan

After updating README:

1. **Accuracy check**: Verify all code snippets match actual implementation
3. **Link check**: All internal links resolve correctly
4. **Completeness**: All env vars documented, all features explained
5. **Scannability**: Can find key info in 30 seconds
6. **Actionability**: Can follow deployment steps without external docs

## Success Criteria

- ✅ README documents all current capabilities accurately
- ✅ Environment variables fully documented with table
- ✅ Dual routing architecture clearly explained
- ✅ Multi-agent system described
- ✅ Component sandbox documented
- ✅ Known issues transparently listed
- ✅ Code examples are copy-pasteable
- ✅ Can serve as spec for future code updates
- ✅ Scannable in 2 minutes, comprehensive for deep dive

## Notes

- This is Phase 1: Update README only
- Future phases will update code to match README spec
- Known issues section sets expectations for upcoming work
- README length: ~400-500 lines (currently ~211 lines)
