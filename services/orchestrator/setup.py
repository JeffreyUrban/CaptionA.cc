#!/usr/bin/env python3
"""
Setup script for Prefect Cloud Hobby plan.

This interactive script helps you:
1. Configure Prefect Cloud authentication
2. Create work pool
3. Verify setup

Usage:
    python setup.py
"""

import asyncio
import subprocess
import sys

from prefect.client.orchestration import get_client


async def check_prefect_installed():
    """Check if Prefect is installed."""
    try:
        import prefect

        print(f"✅ Prefect {prefect.__version__} is installed")
        return True
    except ImportError:
        print("❌ Prefect is not installed")
        print("\nTo install: uv pip install prefect")
        return False


async def check_prefect_auth():
    """Check if user is authenticated to Prefect Cloud."""
    try:
        async with get_client() as client:
            await client.hello()
            print("✅ Authenticated to Prefect Cloud")
            return True
    except Exception as e:
        print(f"❌ Not authenticated to Prefect Cloud: {e}")
        return False


async def login_to_prefect_cloud():
    """Prompt user to log in to Prefect Cloud."""
    print("\n" + "=" * 80)
    print("Prefect Cloud Login")
    print("=" * 80)
    print("\nYou need to authenticate to Prefect Cloud Hobby plan.")
    print("This will open a browser window for authentication.\n")

    response = input("Continue with login? (y/n): ")
    if response.lower() != "y":
        print("Setup cancelled.")
        return False

    # Run prefect cloud login
    result = subprocess.run(["prefect", "cloud", "login"], check=False)

    if result.returncode != 0:
        print("\n❌ Login failed")
        return False

    # Verify authentication
    return await check_prefect_auth()


async def check_work_pool(pool_name: str):
    """Check if work pool exists."""
    async with get_client() as client:
        try:
            work_pools = await client.read_work_pools()
            for pool in work_pools:
                if pool.name == pool_name:
                    print(f"✅ Work pool '{pool_name}' exists")
                    return True

            print(f"❌ Work pool '{pool_name}' does not exist")
            return False
        except Exception as e:
            print(f"❌ Failed to check work pools: {e}")
            return False


async def create_work_pool(pool_name: str):
    """Create a work pool for video processing."""
    print(f"\n📦 Creating work pool: {pool_name}")
    print("   Type: process (runs flows as subprocesses)")

    result = subprocess.run(
        ["prefect", "work-pool", "create", pool_name, "--type", "process"],
        check=False,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(f"❌ Failed to create work pool: {result.stderr}")
        return False

    print(f"✅ Work pool '{pool_name}' created successfully")
    return True


async def verify_setup():
    """Verify the complete setup."""
    print("\n" + "=" * 80)
    print("Verifying Setup")
    print("=" * 80 + "\n")

    checks = {
        "Prefect installed": await check_prefect_installed(),
        "Prefect Cloud authenticated": await check_prefect_auth(),
        "Work pool exists": await check_work_pool("video-processing-pool"),
    }

    print("\n" + "=" * 80)
    print("Setup Summary")
    print("=" * 80)

    all_passed = all(checks.values())

    for check, passed in checks.items():
        status = "✅" if passed else "❌"
        print(f"{status} {check}")

    return all_passed


async def main():
    """Main setup flow."""
    print("=" * 80)
    print("CaptionA.cc Prefect Cloud Setup")
    print("Hobby Plan (Free Tier)")
    print("=" * 80)

    # Step 1: Check if Prefect is installed
    if not await check_prefect_installed():
        print("\nPlease install Prefect first:")
        print("  uv pip install prefect prefect[async]")
        sys.exit(1)

    # Step 2: Check/setup authentication
    if not await check_prefect_auth():
        if not await login_to_prefect_cloud():
            print("\n❌ Setup failed: Could not authenticate to Prefect Cloud")
            sys.exit(1)

    # Step 3: Check/create work pool
    work_pool_name = "video-processing-pool"
    if not await check_work_pool(work_pool_name):
        if not await create_work_pool(work_pool_name):
            print(f"\n❌ Setup failed: Could not create work pool '{work_pool_name}'")
            sys.exit(1)

    # Step 4: Verify everything
    if await verify_setup():
        print("\n" + "=" * 80)
        print("✅ Setup Complete!")
        print("=" * 80)
        print("\nNext steps:")
        print("  1. Deploy flows:  python deploy.py")
        print("  2. Start worker:  python start_worker.py")
        print("  3. Start API:     uvicorn api.main:app --reload --port 8000")
        print("\nView your flows at: https://app.prefect.cloud/")
        print("=" * 80)
    else:
        print("\n❌ Setup incomplete. Please fix the issues above.")
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nSetup cancelled by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Setup failed with error: {e}")
        sys.exit(1)
