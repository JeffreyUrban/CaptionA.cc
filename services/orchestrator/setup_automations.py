#!/usr/bin/env python3
"""
Setup Prefect Automations for webhook notifications.

This script creates:
1. A webhook block pointing to the web app
2. An automation that calls the webhook on flow state changes

Run this once when deploying, or whenever the webhook configuration changes.
"""

import os
import sys
from pathlib import Path

import httpx

# Load environment variables
from dotenv import load_dotenv

monorepo_root = Path(__file__).parent.parent.parent
env_path = monorepo_root / ".env"
if env_path.exists():
    load_dotenv(env_path)

PREFECT_API_URL = os.getenv("PREFECT_API_URL", "https://prefect-service.fly.dev/api")
WEB_APP_URL = os.getenv("WEB_APP_URL", "http://localhost:5173")


async def create_webhook_block():
    """Create a webhook block for the web app notification endpoint."""
    webhook_url = f"{WEB_APP_URL}/api/webhooks/prefect"

    # Check if block already exists
    async with httpx.AsyncClient() as client:
        # Search for existing webhook block
        response = await client.post(
            f"{PREFECT_API_URL}/block_documents/filter",
            json={
                "block_documents": {
                    "name": {"any_": ["captionacc-web-notifications"]}
                }
            },
        )

        if response.status_code == 200:
            existing_blocks = response.json()
            if existing_blocks:
                block_id = existing_blocks[0]["id"]
                print(f"✓ Webhook block already exists: {block_id}")
                return block_id

        # Create webhook block
        # First, get the webhook block type ID and schema
        response = await client.get(f"{PREFECT_API_URL}/block_types/slug/webhook")
        if response.status_code != 200:
            raise Exception(f"Failed to get webhook block type: {response.text}")

        block_type = response.json()
        block_type_id = block_type["id"]

        # Get the block schema
        response = await client.post(
            f"{PREFECT_API_URL}/block_schemas/filter",
            json={"block_schemas": {"block_type_id": {"any_": [block_type_id]}}},
        )
        if response.status_code != 200:
            raise Exception(f"Failed to get block schema: {response.text}")

        schemas = response.json()
        if not schemas:
            raise Exception("No block schema found for webhook")

        block_schema_id = schemas[0]["id"]

        # Create the block document
        response = await client.post(
            f"{PREFECT_API_URL}/block_documents/",
            json={
                "name": "captionacc-web-notifications",
                "block_type_id": block_type_id,
                "block_schema_id": block_schema_id,
                "data": {
                    "url": webhook_url,
                    "method": "POST",
                    "headers": {"Content-Type": "application/json"},
                },
            },
        )

        if response.status_code not in [200, 201]:
            raise Exception(f"Failed to create webhook block: {response.text}")

        block = response.json()
        block_id = block["id"]
        print(f"✓ Created webhook block: {block_id}")
        print(f"  URL: {webhook_url}")
        return block_id


async def create_flow_state_automation(webhook_block_id: str):
    """Create automation to notify web app on flow state changes."""

    async with httpx.AsyncClient() as client:
        # Check if automation already exists
        response = await client.post(
            f"{PREFECT_API_URL}/automations/filter",
            json={"automations": {"name": {"any_": ["notify-web-app-flow-state"]}}},
        )

        if response.status_code == 200:
            existing = response.json()
            if existing:
                automation_id = existing[0]["id"]
                print(f"✓ Automation already exists: {automation_id}")
                return automation_id

        # Create automation
        automation_config = {
            "name": "notify-web-app-flow-state",
            "description": "Notify web app via webhook when flows complete, fail, or start",
            "enabled": True,
            "trigger": {
                "type": "event",
                "posture": "Reactive",
                "match": {
                    "prefect.resource.id": "prefect.flow-run.*",
                },
                "match_related": [
                    {
                        "prefect.resource.role": "flow",
                    }
                ],
                "after": [
                    "prefect.flow-run.Completed",
                    "prefect.flow-run.Failed",
                    "prefect.flow-run.Running",
                ],
            },
            "actions": [
                {
                    "type": "call-webhook",
                    "block_document_id": webhook_block_id,
                    "payload": """
{
  "event": "{{ event.event }}",
  "flowRunId": "{{ event.resource.id }}",
  "flowName": "{{ event.resource['prefect.resource.name'] }}",
  "state": "{{ event.resource['prefect.state-name'] }}",
  "timestamp": "{{ event.occurred }}",
  "tags": {{ event.resource.get('prefect.tags', []) | tojson }},
  "parameters": {{ event.related | selectattr('prefect.resource.role', 'equalto', 'flow-run-parameters') | map(attribute='prefect.resource') | list | tojson }}
}
""".strip(),
                }
            ],
        }

        response = await client.post(
            f"{PREFECT_API_URL}/automations/", json=automation_config
        )

        if response.status_code not in [200, 201]:
            raise Exception(f"Failed to create automation: {response.text}")

        automation = response.json()
        automation_id = automation["id"]
        print(f"✓ Created automation: {automation_id}")
        print("  Triggers on: Completed, Failed, Running")
        print(f"  Calls webhook: {WEB_APP_URL}/api/webhooks/prefect")
        return automation_id


async def main():
    """Set up all automations."""
    print("Setting up Prefect Automations...")
    print(f"Prefect Server: {PREFECT_API_URL}")
    print(f"Web App: {WEB_APP_URL}")
    print()

    try:
        # Create webhook block
        webhook_block_id = await create_webhook_block()
        print()

        # Create flow state automation
        await create_flow_state_automation(webhook_block_id)
        print()

        print("✅ Automation setup complete!")
        print()
        print("Next steps:")
        print("  1. Flows will automatically notify the web app on state changes")
        print("  2. No need to call webhooks from flow code")
        print("  3. Check Prefect UI for automation status:")
        print(f"     {PREFECT_API_URL.replace('/api', '')}/automations")

        return 0

    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    import asyncio

    sys.exit(asyncio.run(main()))
