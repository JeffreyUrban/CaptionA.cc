#!/usr/bin/env python3
"""Create Prefect work pool for captionacc-workers-{namespace}."""

import asyncio
import os
import sys

from prefect.client.orchestration import get_client


def get_work_pool_name() -> str:
    """Get the work pool name based on namespace (defaults to 'prod')."""
    namespace = os.getenv("CAPTIONACC_NAMESPACE", "") or "prod"
    return f"captionacc-workers-{namespace}"


async def create_work_pool():
    """Create the captionacc-workers work pool."""
    work_pool_name = get_work_pool_name()

    async with get_client() as client:
        try:
            # Try to read existing pool
            try:
                pool = await client.read_work_pool(work_pool_name)
                print(f"✓ Work pool '{work_pool_name}' already exists (UUID: {pool.id})")
                return True
            except Exception:
                pass  # Pool doesn't exist, create it

            # Create the work pool using low-level HTTP request
            response = await client._client.post(
                "/work_pools/",
                json={
                    "name": work_pool_name,
                    "type": "process",
                    "description": f"Work pool for CaptionA.cc video processing ({work_pool_name})",
                },
            )
            response.raise_for_status()
            pool_data = response.json()
            print(f"✓ Created work pool '{work_pool_name}' (UUID: {pool_data.get('id')})")
            return True

        except Exception as e:
            print(f"✗ Error creating work pool: {e}")
            return False


if __name__ == "__main__":
    success = asyncio.run(create_work_pool())
    sys.exit(0 if success else 1)
