# Local Development & Staging Environment Setup

## Implementation Status

### Completed

- [x] `scripts/validate-env.sh` - Prod detection, required vars validation
- [x] `scripts/generate-env-local.sh` - Generate `.env.local` with worktree-specific ports
- [x] `.env.local.template` - Template for local environment
- [x] `supabase/config.toml.template` - Template for Supabase worktree ports
- [x] `scripts/start-web.sh` - Validate env, start Vite dev server
- [x] `scripts/start-api.sh` - Validate env, start uvicorn
- [x] `scripts/start-supabase.sh` - Start local Supabase with worktree ports
- [x] `scripts/start-prefect.sh` - Start local Prefect server
- [x] `scripts/deploy-staging.sh` - Deploy all services to staging
- [x] `scripts/deploy-web-staging.sh` - Deploy web to staging
- [x] `scripts/deploy-api-staging.sh` - Deploy API to staging
- [x] JetBrains run configs: `Dev.run.xml`, `Web.run.xml`, `API.run.xml`, `Supabase.run.xml`, `Prefect.run.xml`
- [x] Worktree setup integration (`.claude/scripts/setup-worktree.sh`, `create-worktree.sh`)
- [x] Renamed `fly.dev.toml` → `fly.staging.toml` (web and API)
- [x] Renamed `prefect-dev.yaml` → `prefect-staging.yaml`
- [x] GitHub workflow: `captionacc-web-fly-deploy-staging.yml` (push to staging branch)
- [x] GitHub workflow: `deploy-captionacc-api-staging.yml` (push to staging branch)
- [x] Updated prod workflows to trigger on release tags (`v*`)
- [x] Disabled PR preview deployments (CI only)
- [x] Updated CI workflow to include staging branch

### Pending (Manual Steps Required)

- [ ] Create GitHub environment `staging` with secrets/vars
- [ ] Rename Fly.io apps: `captionacc-web-dev` → `captionacc-web-staging`, `captionacc-api-dev` → `captionacc-api-staging`
- [ ] Create Fly.io volumes for staging API
- [ ] Rename Modal apps (in Modal dashboard)
- [ ] Rename Prefect work pool (in Prefect Cloud)
- [ ] Rename Wasabi bucket or update references
- [ ] Create `staging` branch in GitHub

---

## Overview

Infrastructure-as-code solution for local development with:
- **Local-first** - all services run locally (Supabase, Prefect, Modal functions as Python)
- **Worktree support** - parallel development with isolated ports per worktree
- **Safety first** - fails loudly if `.env` contains prod configuration
- **Always debug** - all dev runs include debugging (Web + API)
- **Staging for integration** - remote "staging" environment for pre-prod verification

## Environments

| Environment | Purpose | Services |
|-------------|---------|----------|
| **Local** | Development, fast iteration, parallel worktrees | Local Supabase, local Prefect, functions run as Python |
| **Staging** | Integration testing, pre-prod verification | Fly.io (Web/API), Modal `-staging`, Prefect hosted, Supabase hosted |
| **Prod** | Production (GitHub Actions deploys) | Fly.io, Modal `-prod`, Prefect hosted, Supabase hosted |

### Deployment Workflow

```
Local Development          CI/CD Pipeline              Environments
─────────────────          ──────────────              ────────────

  ┌─────────┐
  │ Worktree│  ─── PR ───► │ CI: tests, lint,  │
  └─────────┘              │ typecheck (local/ │
                           │ mocked services)  │
       │                   └────────┬──────────┘
       │                            │
       ▼                            ▼
  ┌─────────┐              ┌────────────────┐
  │  main   │ ◄── merge ── │   PR Approved  │
  └─────────┘              └────────────────┘
       │
       │ (when ready for
       │  integration test)
       ▼
  ┌─────────┐              ┌────────────────┐          ┌─────────┐
  │ staging │ ─── push ──► │ Deploy to      │ ───────► │ STAGING │
  │ branch  │              │ staging env    │          └─────────┘
  └─────────┘              └────────────────┘
                                   │
                                   ▼
                           ┌────────────────┐
                           │ Staging        │
                           │ Verification   │
                           │ (automated)    │
                           └───────┬────────┘
                                   │
                          ┌────────┴────────┐
                          │                 │
                          ▼                 ▼
                    ┌──────────┐      ┌──────────┐
                    │  PASS    │      │  FAIL    │
                    │  ✓       │      │  ✗       │
                    └────┬─────┘      └────┬─────┘
                         │                 │
                         ▼                 ▼
                   Prod release       Blocked
                   enabled            (fix and retry)

       │ (after staging
       │  verification passes)
       ▼
  ┌─────────┐              ┌────────────────┐          ┌─────────┐
  │ v1.2.3  │ ─── tag ───► │ Deploy to      │ ───────► │  PROD   │
  │ release │              │ prod env       │          └─────────┘
  └─────────┘              └────────────────┘
```

**Key points:**
- CI runs tests against local/mocked services (no external dependencies)
- No PR preview deployments
- Staging deploys when pushing to `staging` branch
- Staging verification runs automatically after staging deploy
- Prod release only allowed after staging verification passes
- Prod deploys via release tag (e.g., `v1.2.3`)

### Environment Files

| File | Purpose |
|------|---------|
| `.env.local` | Generated per worktree, local services, worktree-specific ports |
| `.env.staging` | Shared remote staging services |
| `.env.prod` | Production (never used by local dev setup) |
| `.env` | Symlink to active environment (`.env.local` for dev) |

## Port Allocation

Each worktree gets a unique port range. Worktree index determines the "hundreds" digit.

**Formula:** `port = 6000 + (worktree × 100) + service_offset`

| Service | Offset | WT 0 (main) | WT 1 | WT 2 | WT 3 |
|---------|--------|-------------|------|------|------|
| Web | +0 | 6000 | 6100 | 6200 | 6300 |
| API | +1 | 6001 | 6101 | 6201 | 6301 |
| Supabase API | +10 | 6010 | 6110 | 6210 | 6310 |
| Supabase DB | +11 | 6011 | 6111 | 6211 | 6311 |
| Supabase Studio | +12 | 6012 | 6112 | 6212 | 6312 |
| Prefect | +20 | 6020 | 6120 | 6220 | 6320 |

**Mental model:** "Worktree 2's API is 6201"

## Safety: Production Detection

Scripts read `.env` and **fail loudly** if any production indicators are detected.

### Prod Indicators to Check

| Service | Variable | Prod pattern |
|---------|----------|--------------|
| Wasabi | `WASABI_BUCKET` | Contains `-prod` |
| Wasabi | `WASABI_STS_ROLE_ARN` | Contains `captionacc-prod` |
| Prefect | `PREFECT_WORK_POOL` | Contains `-prod` |
| API | `VITE_API_URL` | Contains `captionacc-api-prod` |
| Supabase | `SUPABASE_URL` | Known prod project ID: `cuvzwbtarrkngqeqmdaz` |

### Staging Detection (for deploy scripts)

Deploy scripts detect staging vs local based on `.env`:
- Staging: `SUPABASE_URL` contains `okxgkojcukqjzlrqrmox` (hosted)
- Local: `SUPABASE_URL` contains `localhost` or `127.0.0.1`

### Modal/Prefect Safety

Deploy scripts hardcode the staging environment:
- Modal apps: `-staging` suffix
- Modal secrets: `wasabi-staging`
- Prefect work pool: `captionacc-workers-staging`
- Cannot accidentally deploy to prod from local scripts

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    JetBrains Run Configurations                     │
├─────────────────────────────────────────────────────────────────────┤
│  Dev.run.xml (Compound)      │  Deploy (to Staging)                 │
│  ├─ Web + Chrome Debug       │  ├─ Deploy_Modal.run.xml             │
│  └─ API + Python Debug       │  ├─ Deploy_Prefect.run.xml           │
│                              │  └─ Deploy_Supabase.run.xml          │
├──────────────────────────────┴──────────────────────────────────────┤
│  Local Services                                                     │
│  ├─ Supabase.run.xml (supabase start with worktree ports)           │
│  └─ Prefect.run.xml (prefect server start with worktree port)       │
├─────────────────────────────────────────────────────────────────────┤
│  Single-service (when needed)                                       │
│  ├─ Web.run.xml (with Chrome Debug)                                 │
│  └─ API.run.xml (with Python Debug)                                 │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               v
┌─────────────────────────────────────────────────────────────────────┐
│                           scripts/                                  │
│                                                                     │
│  validate-env.sh        - Prod detection, required vars check       │
│  generate-env-local.sh  - Generate .env.local for worktree ports    │
│  start-web.sh           - Validate, start Vite                      │
│  start-api.sh           - Validate, start uvicorn                   │
│  start-supabase.sh      - Start local Supabase with worktree ports  │
│  start-prefect.sh       - Start local Prefect with worktree port    │
│  deploy-modal.sh        - Deploy Modal to staging                   │
│  deploy-prefect.sh      - Deploy Prefect flows to staging           │
│  deploy-supabase.sh     - Deploy Supabase migrations to staging     │
│                                                                     │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   v
┌─────────────────────────────────────────────────────────────────────┐
│                         .env.local                                  │
│  (Generated per worktree with correct ports)                        │
└─────────────────────────────────────────────────────────────────────┘
```

## Files Created

### Scripts (`scripts/`)

| File | Status | Purpose |
|------|--------|---------|
| `scripts/validate-env.sh` | ✅ | Check .env exists, no prod indicators, required vars present |
| `scripts/generate-env-local.sh` | ✅ | Generate `.env.local` from template with worktree-specific ports |
| `scripts/start-web.sh` | ✅ | Validate, start Vite dev server (hot reload) |
| `scripts/start-api.sh` | ✅ | Validate, start uvicorn (hot reload) |
| `scripts/start-supabase.sh` | ✅ | Start local Supabase with worktree-specific ports |
| `scripts/start-prefect.sh` | ✅ | Start local Prefect server with worktree-specific port |
| `scripts/deploy-staging.sh` | ✅ | Deploy all services to staging |
| `scripts/deploy-web-staging.sh` | ✅ | Deploy web to staging via Fly.io |
| `scripts/deploy-api-staging.sh` | ✅ | Deploy API to staging via Fly.io |
| `scripts/deploy-modal.sh` | ⏳ | Deploy Modal to staging (future) |
| `scripts/deploy-prefect.sh` | ⏳ | Deploy Prefect flows to staging (future) |
| `scripts/deploy-supabase.sh` | ⏳ | Deploy Supabase migrations to staging (future) |

### JetBrains Run Configs (`.run/`)

All run configs include debugging by default.

| File | Status | Type | Purpose |
|------|--------|------|---------|
| `Dev.run.xml` | ✅ | Compound | Supabase + Prefect + API + Web (primary workflow) |
| `Web.run.xml` | ✅ | npm + JavaScript Debug | Vite dev server with Chrome debug |
| `API.run.xml` | ✅ | Python | uvicorn with debugger attached |
| `Supabase.run.xml` | ✅ | Shell Script | Start local Supabase |
| `Prefect.run.xml` | ✅ | Shell Script | Start local Prefect server |
| `Deploy_Modal.run.xml` | ⏳ | Shell Script | Deploy Modal to staging (future) |
| `Deploy_Prefect.run.xml` | ⏳ | Shell Script | Deploy Prefect to staging (future) |
| `Deploy_Supabase.run.xml` | ⏳ | Shell Script | Deploy Supabase to staging (future) |

### Config Files

| File | Purpose |
|------|--------|
| `supabase/config.toml` | Template with port placeholders, or generated per worktree |
| `.env.local.template` | Template for generating `.env.local` |

### Worktree Setup Integration

Update `.claude/scripts/setup-worktree.sh` to:
1. Detect worktree index from path
2. Run `scripts/generate-env-local.sh` with worktree index
3. Generate `supabase/config.toml` with correct ports
4. Create `.env` symlink to `.env.local`

## Local Services

The `Dev.run.xml` compound config starts all local services automatically. Each service has its own run config for independent control.

### Supabase Local

`Supabase.run.xml` runs `scripts/start-supabase.sh` which:
1. Generates `supabase/config.toml` with worktree-specific ports
2. Starts Supabase via `supabase start`
3. Applies migrations

**Prerequisites:**
- Supabase CLI: `brew install supabase/tap/supabase`
- Docker running

### Prefect Local

`Prefect.run.xml` runs `scripts/start-prefect.sh` which:
1. Reads worktree port from `.env.local`
2. Starts Prefect server on that port
3. Registers flows

**Prerequisites:**
- Prefect installed (via uv in API project)

### Modal Functions (Local)

Modal functions run as plain Python locally - no Modal infrastructure.

`scripts/start-api.sh` configures the environment so Modal functions:
- Execute directly (bypass Modal decorator)
- Use local Supabase, local file storage (or Wasabi dev bucket)
- Skip GPU-dependent code paths (or mock them)

No separate run config needed - API startup handles this.

## First-Time Setup

### Prerequisites (one-time)

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Install Node.js (if not present)
brew install node

# Install uv (if not present)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Ensure Docker is installed and running
```

### Project Setup

```bash
# 1. Clone and install dependencies
git clone <repo>
cd CaptionA.cc
npm install
cd services/api && uv sync && cd ../..

# 2. Generate local environment (main worktree = index 0)
./scripts/generate-env-local.sh 0

# 3. Open in JetBrains and run "Dev"
# This starts everything: Supabase, Prefect, Web, API with debuggers
```

**That's it.** The `Dev.run.xml` handles starting all services with correct ports.

## Worktree Setup

For parallel development, run from the main worktree:

```bash
./.claude/scripts/create-worktree.sh claude
```

This automatically:
- Creates worktree with next available index (1-9)
- Generates `.env.local` with worktree-specific ports (61xx, 62xx, etc.)
- Generates `supabase/config.toml` with correct ports
- Creates `.env` symlink to `.env.local`
- Opens in IDE

Then just run `Dev.run.xml` in the new worktree - all services start with isolated ports.

## Deploy to Staging

Staging deployment is triggered by pushing to the `staging` branch:

```bash
git push origin main:staging
```

GitHub Actions then:
1. Deploys all services to staging (Web, API, Modal, Prefect, Supabase)
2. Runs staging verification (automated tests against live staging)
3. If verification passes, enables prod release
4. If verification fails, blocks prod release until fixed

**Manual deployment** (for testing deploy scripts locally):

```bash
./scripts/deploy-modal.sh      # or Deploy_Modal.run.xml
./scripts/deploy-prefect.sh    # or Deploy_Prefect.run.xml
./scripts/deploy-supabase.sh   # or Deploy_Supabase.run.xml
```

These scripts validate `.env` is not prod, then deploy to staging.

## Staging Verification Gate

Staging verification is an automated check that runs after every staging deployment.

**Purpose:** Ensure staging is healthy before allowing prod release.

**Implementation options:**
- GitHub Actions workflow that runs after staging deploy
- GitHub environment protection rules (prod environment requires staging verification to pass)
- Status check on the `staging` branch that must be green

**What it verifies:** Health checks, smoke tests, critical path validation against live staging services.

**Release flow:**
1. Push to `staging` branch
2. Staging deploys
3. Verification runs automatically
4. If pass → `git tag v1.2.3 && git push --tags` works
5. If fail → fix issues, push to staging again, verification re-runs

## Rename: dev → staging

All non-local "dev" resources need to be renamed to "staging" for clarity.

### External Services (requires manual changes in each service's dashboard/CLI)

| Service | Current | New |
|---------|---------|-----|
| Modal apps | `captionacc-extract-*-dev` | `captionacc-extract-*-staging` |
| Modal secrets | `wasabi-dev` | `wasabi-staging` |
| Prefect work pool | `captionacc-workers-dev` | `captionacc-workers-staging` |
| Wasabi bucket | `captionacc-dev` | `captionacc-staging` |
| Fly.io apps | `captionacc-api-dev`, `captionacc-web-dev` | `captionacc-api-staging`, `captionacc-web-staging` |

### Codebase Changes

| File/Location | Change |
|---------------|--------|
| `.env.staging` | Update all `-dev` references to `-staging` |
| `fly.toml` files | Update app names |
| GitHub Actions workflows | Update deployment targets |
| Modal deploy scripts | Update app suffix |
| Prefect flow registration | Update work pool name |
| Any hardcoded references | Search and replace |

### GitHub Actions Workflow Updates

| Trigger | Current | New |
|---------|---------|-----|
| PR to main | Fly preview deploy | CI only (tests, lint, typecheck) |
| Push to `staging` branch | (none) | Deploy to staging, then run staging verification |
| Staging verification pass | (none) | Enable prod release (e.g., update GitHub environment protection) |
| Release tag (`v*.*.*`) | (none or partial) | Deploy all to prod (blocked if staging verification failed) |

## Verification Steps

### Local Development
1. **Prod rejection**: Point `.env` → `.env.prod`, run any script → Should fail loudly
2. **Local setup**: Run `generate-env-local.sh 0` → Creates `.env.local` with port 60xx
3. **Supabase local**: Run `supabase start` → Runs on ports 6010-6012
4. **Prefect local**: Run `prefect server start` → Runs on port 6020
5. **Full dev startup**: Run `Dev.run.xml` → Web (6000) + API (6001) with debuggers
6. **Hot reload**: Edit code → Changes reflect without restart

### Worktree Isolation
7. **Create worktree**: Run `create-worktree.sh claude` → Gets index 1, ports 61xx
8. **No port conflicts**: Run dev in both worktrees simultaneously → Both work

### Staging Deployment
9. **Modal deploy**: Run `Deploy_Modal.run.xml` → Apps deployed to staging
10. **Prefect deploy**: Run `Deploy_Prefect.run.xml` → Flows registered to staging
11. **Supabase deploy**: Run `Deploy_Supabase.run.xml` → Migrations applied to staging
