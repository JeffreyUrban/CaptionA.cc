# Prefect Deployment Automation

## Overview

Prefect flow deployments are automatically registered as part of the deployment process using Fly.io's release commands. This ensures that flow definitions are always up-to-date with the code being deployed.

## How It Works

### Infrastructure-as-Code Components

1. **prefect.yaml** - Declarative deployment definitions
   - Defines all Prefect flows to be deployed
   - Specifies work pool, entrypoints, and metadata
   - Source of truth for deployment configuration

2. **scripts/deploy_flows.sh** - Deployment script
   - Idempotent script that registers/updates deployments
   - Runs `prefect deploy --all` to sync prefect.yaml with server
   - Includes error handling and validation

3. **fly.toml [deploy]** - Release command configuration
   ```toml
   [deploy]
   release_command = "bash scripts/deploy_flows.sh"
   ```
   - Runs after build, before deployment
   - Fails deployment if registration fails
   - Ensures atomic deployments

4. **Dockerfile** - Build includes deployment artifacts
   - Copies `scripts/` directory
   - Copies `prefect.yaml` configuration
   - Makes scripts executable

## Deployment Flow

```
Developer runs: fly deploy
    ↓
1. Build Docker image
    ↓
2. Run release_command (register flows)
    ├─ Validate PREFECT_API_URL is set
    ├─ Validate prefect.yaml exists
    ├─ Run: prefect deploy --all
    └─ Exit with status (fail deployment on error)
    ↓
3. Deploy new machines (only if release_command succeeds)
    ↓
4. Workers automatically discover new deployments
```

## Benefits

✅ **Zero Manual Steps** - Deployments register automatically
✅ **Always In Sync** - Flow definitions match deployed code
✅ **Atomic Deployments** - Registration failure prevents bad deploys
✅ **Idempotent** - Safe to run multiple times
✅ **Version Controlled** - All configuration in git

## Configuration

### Environment Variables

Required in Fly.io secrets:
- `PREFECT_API_URL` - Prefect server API endpoint

Set via:
```bash
fly secrets set PREFECT_API_URL="https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api" --app captionacc-api
```

### Adding New Flows

1. Create flow in `app/flows/your_flow.py`
2. Add deployment definition to `prefect.yaml` (prod) or `prefect-dev.yaml` (dev):
   ```yaml
   deployments:
     - name: captionacc-prod-your-deployment-name  # or captionacc-dev-* for dev
       description: What this flow does
       entrypoint: app/flows/your_flow.py:your_flow_function
       work_pool:
         name: captionacc-workers-prod  # or captionacc-workers-dev for dev
       schedules: []
   ```
3. Deploy: `fly deploy`

The flow will be automatically registered!

### Modifying Existing Flows

Simply update the code and deploy. The release command will update the deployment definition automatically.

## Troubleshooting

### Deployment Fails with "PREFECT_API_URL not set"

Check secrets:
```bash
fly secrets list --app captionacc-api
```

Set if missing:
```bash
fly secrets set PREFECT_API_URL="..." --app captionacc-api
```

### Flow not found error

Check that:
1. Flow function name matches `prefect.yaml` entrypoint
2. Flow is decorated with `@flow`
3. File path in entrypoint is correct

### Manual Registration (for testing)

If needed, you can manually register flows:

```bash
# Set API URL
export PREFECT_API_URL="https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api"

# Register all flows
prefect deploy --all

# Or register specific deployment
prefect deploy -n captionacc-video-initial-processing
```

## Monitoring

View deployments:
```bash
PREFECT_API_URL="..." prefect deployment ls
```

View flow runs:
```bash
PREFECT_API_URL="..." prefect flow-run ls --limit 10
```

Check release command logs:
```bash
fly logs --app captionacc-api | grep release_command
```
