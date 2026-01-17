#!/usr/bin/env python3
"""Create Prefect work pool for captionacc-workers."""

import asyncio
import sys

from prefect.client.orchestration import get_client


async def create_work_pool():
    """Create the captionacc-workers work pool."""
    async with get_client() as client:
        try:
            # Try to read existing pool
            try:
                pool = await client.read_work_pool("captionacc-workers")
                print(f"✓ Work pool 'captionacc-workers' already exists (UUID: {pool.id})")
                return True
            except Exception:
                pass  # Pool doesn't exist, create it

            # Create the work pool using low-level HTTP request
            response = await client._client.post(
                "/work_pools/",
                json={
                    "name": "captionacc-workers",
                    "type": "process",
                    "description": "Work pool for CaptionA.cc video processing",
                },
            )
            response.raise_for_status()
            pool_data = response.json()
            print(f"✓ Created work pool 'captionacc-workers' (UUID: {pool_data.get('id')})")
            return True

        except Exception as e:
            print(f"✗ Error creating work pool: {e}")
            return False


if __name__ == "__main__":
    success = asyncio.run(create_work_pool())
    sys.exit(0 if success else 1)
