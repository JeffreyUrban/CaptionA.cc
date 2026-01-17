#!/usr/bin/env python3
"""Check Prefect worker status and recent activity."""

import asyncio
import sys

from prefect.client.orchestration import get_client


async def check_worker_status():
    """Check Prefect worker and work pool status."""
    async with get_client() as client:
        try:
            # Check work pool
            try:
                pool = await client.read_work_pool("captionacc-workers")
                print(f"✓ Work pool 'captionacc-workers' exists")
                print(f"  ID: {pool.id}")
                print(f"  Type: {pool.type}")
                print(f"  Concurrency: {pool.concurrency_limit}")
                print()
            except Exception as e:
                print(f"✗ Work pool 'captionacc-workers' not found: {e}")
                return False

            # Check workers
            try:
                workers = await client.read_workers_for_work_pool(work_pool_name="captionacc-workers")
                print(f"Workers: {len(workers)} found")
                for worker in workers:
                    print(f"  - {worker.name}")
                    print(f"    Status: {worker.status}")
                    print(f"    Last heartbeat: {worker.last_heartbeat_time}")
                print()
            except Exception as e:
                print(f"✗ Error reading workers: {e}")

            # Check recent flow runs
            try:
                flow_runs = await client.read_flow_runs(
                    limit=5,
                )
                print(f"Recent flow runs: {len(flow_runs)} found")
                for run in flow_runs:
                    print(f"  - {run.name}")
                    print(f"    State: {run.state_type}")
                    print(f"    Created: {run.created}")
                print()
            except Exception as e:
                print(f"✗ Error reading flow runs: {e}")

            return True

        except Exception as e:
            print(f"✗ Error: {e}")
            return False


if __name__ == "__main__":
    success = asyncio.run(check_worker_status())
    sys.exit(0 if success else 1)
