# Local Development Setup with Namespace Isolation

## Overview

Enable running captionacc-web and captionacc-api locally against remote services (Supabase, Wasabi, Prefect, Modal) with full namespace isolation from production.

## Namespace Strategy

| Service | Production                         | Development (namespace: `dev`)    |
|---------|------------------------------------|-----------------------------------|
| Supabase schema | `captionacc_prod`                  | `captionacc_dev`                  |
| Prefect work pool | `captionacc-workers-prod`          | `captionacc-workers-dev`          |
| Prefect deployments | `captionacc-prod-*`                | `captionacc-dev-*`                |
| Modal apps | `extract-full-frames-and-ocr-prod` | `extract-full-frames-and-ocr-dev` |
| Wasabi | `captionacc-prod`                  | `captionacc-dev`                  |

## Implementation

### 1. Add Namespace Config to API Settings

**File:** `services/api/app/config.py`

Add settings:
```python
# Namespace for dev isolation (empty = production)
captionacc_namespace: str = ""

@property
def effective_work_pool(self) -> str:
    if self.captionacc_namespace:
        return f"captionacc-workers-{self.captionacc_namespace}"
    return "captionacc-workers"

@property
def modal_app_suffix(self) -> str:
    """Suffix for Modal app names (e.g., 'dev' or 'prod')"""
    if self.captionacc_namespace:
        return f"{self.captionacc_namespace}"
    return ""
```

### 2. Update Prefect Worker to Use Dynamic Work Pool

**File:** `services/api/app/prefect_runner.py`

Replace hardcoded `"captionacc-workers"` with `settings.effective_work_pool` in:
- Line 52: logging
- Line 68: work pool check
- Line 106: worker start command

### 3. Update Flows to Use Dynamic Modal App Names

**Files:**
- `services/api/app/flows/video_initial_processing.py`
- `services/api/app/flows/crop_and_infer.py`
- `services/api/app/flows/caption_ocr.py`

Change from:
```python
extract_fn = modal.Function.from_name(
    "extract-full-frames-and-ocr", "extract_full_frames_and_ocr"
)
```

To:
```python
settings = get_settings()
extract_fn = modal.Function.from_name(
    f"extract-full-frames-and-ocr-{settings.modal_app_suffix}",
    "extract_full_frames_and_ocr"
)
```

### 4. Update Modal Apps to Support Namespace Suffix

**Files:**
- `data-pipelines/extract-full-frames-and-ocr/src/extract_full_frames_and_ocr/app.py`
- `data-pipelines/extract-crop-frames-and-infer-extents/src/extract_crop_frames_and_infer_extents/app.py`

Change from:
```python
app = modal.App("extract-full-frames-and-ocr")
```

To:
```python
import os
app_suffix = os.environ.get("modal_app_suffix", "")
app = modal.App(f"extract-full-frames-and-ocr-{app_suffix}")
```

### 5. Create Development Config Files

**File:** `services/api/prefect-dev.yaml`
```yaml
work_pool:
  name: captionacc-workers-dev

deployments:
  - name: captionacc-dev-video-initial-processing
    entrypoint: app/flows/video_initial_processing.py:video_initial_processing
    work_pool:
      name: captionacc-workers-dev
    # ... (all 4 deployments with dev suffix)
```

**File:** `services/api/.env.development`
```bash
CAPTIONACC_NAMESPACE=dev
SUPABASE_SCHEMA=captionacc_dev
PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api
# ... other settings
```

### 6. Create Setup Script

**File:** `services/api/scripts/setup-local-dev.sh`

Script that:
1. Creates `.env.development` from template
2. Generates `prefect-dev.yaml` with namespace
3. Prints instructions for Supabase schema setup
4. Registers dev Prefect deployments
5. Deploys dev Modal apps

### 7. Update Documentation

**File:** `docs/prefect-orchestration/QUICKSTART.md`

Add "Local Development" section explaining:
- How to set up namespace
- How to run locally with remote services
- What gets namespaced and why

## Files to Modify

| File | Change                                         |
|------|------------------------------------------------|
| `services/api/app/config.py` | Add namespace settings and computed properties |
| `services/api/app/prefect_runner.py` | Use dynamic work pool name                     |
| `services/api/app/flows/video_initial_processing.py` | Use dynamic Modal app name                     |
| `services/api/app/flows/crop_and_infer.py` | Use dynamic Modal app name                     |
| `services/api/app/flows/caption_ocr.py` | Use dynamic Modal app name                     |
| `data-pipelines/extract-full-frames-and-ocr/.../app.py` | Support app name suffix                        |
| `data-pipelines/extract-crop-frames-and-infer-extents/.../app.py` | Support app name suffix                        |

## Files to Create

| File | Purpose |
|------|---------|
| `services/api/prefect-dev.yaml` | Dev Prefect deployment config |
| `services/api/.env.development.template` | Template for dev environment |
| `services/api/scripts/setup-local-dev.sh` | Setup automation |
| `docs/LOCAL_DEVELOPMENT.md` | Developer guide |

### 8. Web App Local Development Config

**File:** `apps/captionacc-web/.env.development`
```bash
# Point to local API
VITE_API_URL=http://localhost:8000

# Supabase (same project, web app uses RLS for access control)
VITE_SUPABASE_URL=https://stbnsczvywpwjzbpfehp.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

Note: The web app connects to Supabase via the anon key with RLS policies. Schema selection is handled server-side by the API service.

## Verification

1. **Config loads correctly:**
   ```bash
   cd services/api
   CAPTIONACC_NAMESPACE=dev python -c "from app.config import get_settings; s=get_settings(); print(s.effective_work_pool, s.modal_app_suffix)"
   # Should print: captionacc-workers-dev dev
   ```

2. **Prefect deployments register:**
   ```bash
   PREFECT_API_URL=... prefect deploy --all --prefect-file prefect-dev.yaml
   prefect deployment ls | grep dev
   ```

3. **Modal apps deploy:**
   ```bash
   cd data-pipelines/extract-full-frames-and-ocr
   modal_app_suffix=dev modal deploy deploy.py
   modal app list | grep dev
   ```

4. **API starts with dev config:**
   ```bash
   cd services/api
   cp .env.development.template .env
   # Fill in credentials
   uvicorn app.main:app --reload
   # Check logs show: "Starting Prefect worker for work pool 'captionacc-workers-dev'"
   ```

5. **End-to-end flow execution:**
   - Trigger a video processing flow
   - Verify it uses dev Modal app
   - Verify Supabase updates go to dev schema
