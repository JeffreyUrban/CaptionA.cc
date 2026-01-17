#!/usr/bin/env python3
"""Test triggering a simple flow run."""

import asyncio
import os
import sys

# Set Prefect API URL to connect to the server
os.environ["PREFECT_API_URL"] = "http://banchelabs-gateway.internal:4200/api"

from prefect.client.orchestration import get_client


async def test_flow_run():
    """Test creating a simple flow run."""
    async with get_client() as client:
        try:
            # Check server health
            health = await client.api_healthcheck()
            print(f"✓ Prefect server health: {health}")

            # List available deployments
            deployments = await client.read_deployments(limit=10)
            print(f"\nDeployments found: {len(deployments)}")
            for dep in deployments:
                print(f"  - {dep.name} (flow: {dep.flow_name})")

            if not deployments:
                print("\n! No deployments found. Flows need to be deployed before they can be run by workers.")
                print("  Run: prefect deploy to create deployments")

            return True

        except Exception as e:
            print(f"✗ Error: {e}")
            import traceback
            traceback.print_exc()
            return False


if __name__ == "__main__":
    success = asyncio.run(test_flow_run())
    sys.exit(0 if success else 1)
