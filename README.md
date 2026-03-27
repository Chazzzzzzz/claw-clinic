# Claw Clinic

**A doctor for broken AI agents.**

Your AI agent stopped working. You don't know why. You spend 30 minutes debugging config files, restarting services, and reading error logs.

Claw Clinic fixes that. Type `/clinic`, and an AI doctor examines your agent — step by step, command by command — until the problem is found and fixed.

```
You:     /clinic my agent can't use shell commands

Doctor:  Let me check your config...
         > $ cat ~/.openclaw/openclaw.json

         I see — you're using gpt-4o-mini which doesn't support tool use.
         Let me check your extensions...
         > $ ls ~/.openclaw/extensions/

         No shell extension installed either. Here's the fix:

         Proposed fix (risk: low):
           $ openclaw config set model claude-sonnet-4-20250514
         Switch to a model that supports tool calling.

         Reply /clinic yes to apply
```

## How It Works

Claw Clinic is an **agentic diagnostic loop**. Instead of guessing what's wrong and giving you a list of things to try, the AI doctor:

1. **Examines** your agent — reads config, checks connectivity, inspects logs
2. **Investigates** step by step — runs diagnostic commands automatically
3. **Diagnoses** the root cause with an ICD-AI code (like medical ICD codes, but for AI agents)
4. **Treats** the issue — proposes a fix, you approve, it executes
5. **Verifies** the fix worked

All commands are executed on your machine. Secrets are automatically masked. Fix proposals require your approval before running.

## The ICD-AI Disease Classification

Every AI agent disease gets a standardized code, just like human diseases have ICD-10 codes:

| Code | Disease | What Goes Wrong |
|------|---------|----------------|
| `CFG.1.1` | Missing API Key | Agent can't authenticate with the provider |
| `CFG.2.1` | Stale Config | Config changes not applied after restart |
| `NET.1.1` | Provider Unreachable | Can't connect to AI provider API |
| `AUTH.1.1` | Token Validation Bypass | Gateway accepts invalid auth tokens |
| `LOOP.1.1` | Infinite Tool Loop | Agent calls the same tool forever |
| `COST.1.1` | Token Explosion | Burning through tokens 5x faster than expected |
| `PERF.1.1` | Latency Spike | Response times jumping from 200ms to 10+ seconds |
| `CTX.1.1` | Context Overflow | Agent loses coherence mid-conversation |
| `GEN.1.1` | Tool Capability Gap | Model can't use the tools it needs |
| `PERM.1.1` | Permission Denial | Agent blocked from executing commands |
| `SEC.1.1` | Credential Exposure | API keys stored in plaintext |
| `SYS.1.1` | Port Conflict | Gateway won't start — port already in use |

The AI doctor can also discover **novel diseases** that aren't in the catalog. When it finds a new pattern, it creates a new ICD-AI code on the spot.

## Community Cures Forum

**Every fix shared makes the next fix faster.**

When someone fixes a disease, they can share the cure on the [Community Cures Forum](https://claw-clinic-87776978284.asia-northeast1.run.app/forum). The next person with the same issue gets the proven fix instantly.

<!-- Screenshot: forum browse view -->
<!-- ![Community Cures Forum](docs/screenshots/forum-browse.png) -->

- **Browse** cures by disease code, name, or symptoms
- **Copy** commands with one click
- **Submit** your own fix — describe the problem and solution in plain language
- **Search** across all community cures

Submit a cure in **Simple mode** (just describe the problem and paste what fixed it) or **Advanced mode** (structured ICD-AI codes and treatment steps).

<!-- Screenshot: submit cure form -->
<!-- ![Submit a Cure](docs/screenshots/forum-submit.png) -->

## Quick Start

### As an OpenClaw Plugin

```bash
# Install the plugin
cd ~/.openclaw/extensions
git clone https://github.com/Chazzzzzzz/claw-clinic.git
cd claw-clinic && pnpm install && pnpm build

# Restart the gateway to load the plugin
openclaw gateway restart

# Now use it
/clinic my agent keeps timing out
```

### As a Standalone CLI

```bash
# Run diagnostics from the command line
openclaw claw-clinic diagnose "my agent can't connect to anthropic"
```

### Just the Forum

Browse and submit cures at:
**https://claw-clinic-87776978284.asia-northeast1.run.app/forum**

No installation needed — just a web browser.

## Architecture

```
┌─────────────────────────────────────────────────┐
│ Your Machine (Plugin)                           │
│                                                 │
│  /clinic "agent broken"                         │
│    ↓                                            │
│  Collect evidence (config, logs, connectivity)  │
│    ↓                                            │
│  POST /consult ──→ AI Doctor examines           │
│    ↓                  ↓                         │
│  Auto-execute    ←── "run: cat config"          │
│  diagnostic cmd       ↓                         │
│  Send result ────→   "run: ls extensions/"      │
│    ↓                  ↓                         │
│  Auto-execute    ←── "I see the issue..."       │
│  Send result ────→   "propose_fix: ..."         │
│    ↓                                            │
│  Show to user → /clinic yes → execute fix       │
│    ↓                                            │
│  Send result ────→ "mark_resolved: CFG.1.1"     │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Backend (Cloud Run)                             │
│                                                 │
│  POST /consult  — Multi-turn AI consultation    │
│  GET  /cases    — Query community cures         │
│  POST /cases    — Submit a cure                 │
│  GET  /forum    — Web UI for browsing cures     │
│  GET  /health   — Health check                  │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Supabase (Postgres)                             │
│                                                 │
│  cases            — Community-submitted cures   │
│  disease_registry — AI-discovered ICD-AI codes  │
└─────────────────────────────────────────────────┘
```

Three packages in a pnpm monorepo:

- **`shared`** — Disease catalog, types, utilities (zero runtime dependencies except zod)
- **`workers`** — Hono HTTP backend on Cloud Run (AI consultation, forum API, community cures)
- **`plugin`** — OpenClaw plugin (evidence collection, command execution, user approval flow)

## How the AI Doctor Thinks

The consultation AI has deep knowledge of the OpenClaw architecture:

- Knows real config paths (`~/.openclaw/openclaw.json`, not made-up ones)
- Knows there's no `tools.shell` config key (tool access is determined by the LLM, not the gateway)
- Uses `openclaw gateway restart` not `sudo systemctl restart`
- Never invents fake config keys or file paths
- Runs 1-2 commands at a time, analyzes results, then decides next steps

Diagnostic commands run automatically. Fix commands pause for your approval. Every output is sanitized — API keys and secrets are masked before being sent to the AI.

## Self-Hosting

### Backend

```bash
cd workers
cp .env.example .env  # Add your ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
pnpm install && pnpm build
pnpm dev  # http://localhost:8080
```

### Database

Create a [Supabase](https://supabase.com) project and run `workers/src/db/schema.sql` in the SQL Editor.

### Plugin

Point the plugin at your backend:

```json
// ~/.openclaw/openclaw.json
{
  "plugins": {
    "entries": {
      "claw-clinic": {
        "config": {
          "backendUrl": "http://localhost:8080"
        }
      }
    }
  }
}
```

## Contributing

The easiest way to contribute: **submit a cure on the forum.** You don't need to write code — just describe the problem and what fixed it.

For code contributions:

```bash
pnpm install          # Install all packages
pnpm build            # Build (shared must build first)
pnpm test             # Run all tests (132 tests across 3 packages)
cd workers && pnpm dev  # Dev server with hot reload
```

## License

MIT
