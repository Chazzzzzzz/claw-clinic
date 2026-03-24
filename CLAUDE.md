# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Claw Clinic is a diagnostic system for AI coding agents (Claude Code, Cursor, Copilot, etc.). It uses a medical metaphor — diseases have ICD-AI codes, agents get diagnosed via symptom vectors, and treatment is prescribed and executed. Think of it as "a doctor for broken AI agents."

## Commands

```bash
# Install dependencies (pnpm monorepo)
pnpm install

# Build all packages (shared must build first — workers and plugin depend on it)
pnpm build          # runs `pnpm -r build` (tsc in each package)

# Run all tests
pnpm test           # runs `pnpm -r test` (vitest run in each package)

# Run tests in a single package
cd shared && pnpm test
cd workers && pnpm test
cd plugin && pnpm test

# Run a single test file
cd workers && npx vitest run src/__tests__/ai-diagnostician.test.ts

# Dev server (workers backend with hot reload)
cd workers && pnpm dev    # tsx src/index.ts — serves on PORT (default 8080)

# Typecheck without emitting
cd shared && pnpm typecheck
```

## Architecture

Three-package pnpm monorepo (`pnpm-workspace.yaml`): `shared`, `workers`, `plugin`.

### shared (`@claw-clinic/shared`)
Domain library — no runtime dependencies except zod. Contains:
- **Disease catalog** (`constants/diseases.ts`): `MVP_DISEASES` array of `DiseaseRecord` objects with ICD-AI codes, diagnostic criteria (vital sign thresholds + supporting symptoms), severity, prescriptions
- **Prescription catalog** (`constants/prescriptions.ts`): `STANDARD_PRESCRIPTIONS` — step-by-step treatment plans keyed by target disease code
- **Types** (`types/`): `TraceRecord`, `SymptomVector`, `DiseaseRecord`, `Evidence` (union of config/connectivity/behavior/log/environment/runtime), `VerificationStep`
- **Utils**: `extractSymptomVector` (trace -> metrics), `matchDiseases` (symptom vector -> ranked disease candidates), `computeVitals`, `createMinimalSymptomVector` (text -> heuristic vector)

### workers (`@claw-clinic/workers`)
Hono HTTP backend deployed to Cloud Run (Dockerfile). Three routes:
- **POST /diagnose** — Primary path uses `aiDiagnose()` which calls Claude Sonnet via `@anthropic-ai/sdk` with tool_use (forced `submit_diagnosis` tool). Falls back to rule-based `matchDiseases` when ANTHROPIC_API_KEY is absent.
- **POST /treat** — Stateful treatment session manager. In-memory session store tracks step-by-step treatment execution.
- **POST /verify** — Generates verification plans from disease diagnostic criteria thresholds.
- **doctor-agent.ts** — Deep rule-based consultation engine (Layer 3): sequence analysis, temporal trends, comorbidity detection, root cause analysis. Exported as separate entry point.
- **follow-up.ts** — Post-treatment verification at T+24h/48h/72h intervals. Compares current vs original symptom vectors.

### plugin (`@claw-clinic/plugin`)
OpenClaw plugin (`"openclaw": "./dist/index.js"` in package.json). Registers:
- **Tools**: `clinic_diagnose` (full workflow: local validation -> evidence collection -> backend AI diagnosis -> auto-execute treatment loop) and `clinic_treat` (resume paused treatment)
- **Commands**: `/clinic` chat command and CLI subcommands (`openclaw claw-clinic diagnose/treat/health`)
- **System prompt injection**: Adds clinic awareness to the agent via `before_prompt_build` hook

## Key Design Decisions

- **AI-first diagnosis**: The `/diagnose` endpoint always tries Claude Sonnet first. Rule-based matching is the fallback, not the primary path. The plugin should never do hardcoded regex diagnosis — it sends evidence to the backend.
- **ICD-AI codes**: Custom disease classification system (e.g., E.1.1 = Infinite Loop, CFG.1.1 = Invalid API Key, N.1.1 = Confabulation). Novel codes use `Department.Number.Variant` format.
- **Forced tool_use**: The AI diagnostician uses `tool_choice: { type: "tool", name: "submit_diagnosis" }` to guarantee structured output.
- **Three-layer diagnosis**: Layer 1 = local validation (plugin), Layer 2 = AI diagnosis (workers/ai-diagnostician), Layer 3 = deep rule-based consultation (workers/doctor-agent).
- **ESM throughout**: All packages use `"type": "module"` with NodeNext module resolution. Imports require `.js` extensions.

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`

## Deployment

- Backend: deployed via git push (Cloud Run). Binary at `/usr/local/bin/openclaw` on server.
- Plugin: deployed via SSH to `ubuntu@chaz-clawd`. Don't patch `@claw-clinic/shared` imports for remote deploy — openclaw handles workspace resolution natively.
- After plugin deploy, restart gateway: `sudo systemctl restart openclaw-gateway`
