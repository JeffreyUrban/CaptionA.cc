# Supabase Documentation

## Setup Guides

**[MULTI_SCHEMA_SETUP.md](MULTI_SCHEMA_SETUP.md)** - Configure multi-schema architecture

**[WEBHOOK_SETUP.md](WEBHOOK_SETUP.md)** - Configure database webhook for video processing

## Architecture

**[multi-schema-architecture-plan.md](multi-schema-architecture-plan.md)** - Multi-schema design and implementation

## Schema Organization

CaptionA.cc uses four PostgreSQL schemas:
- `captionacc_prod` - Production data
- `captionacc_staging` - Staging/test data
- `captionacc_prefect` - Prefect workflows (optional)
- `umami` - Analytics (optional)
