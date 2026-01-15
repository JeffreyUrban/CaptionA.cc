#!/usr/bin/env python3
"""
Generate API Gateway JWT Token

Helper script to generate JWT tokens for API gateway authentication.
Calls the Supabase Edge Function to create tokens with proper audit logging.

Usage:
    python generate-token.py --project captionacc --service modal --description "Modal GPU workers"
    python generate-token.py --project captionacc --service api --expires-in-days 30

Environment variables:
    SUPABASE_URL: Your Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY: Service role key (admin only)
"""

import argparse
import json
import os
import sys

try:
    import httpx
except ImportError:
    print("Error: httpx library not installed. Run: uv pip install httpx")
    sys.exit(1)


def generate_token(
    project: str,
    service: str,
    description: str | None = None,
    expires_in_days: int = 90,
    backend: str | None = None,
    created_by: str | None = None,
    supabase_url: str | None = None,
    service_role_key: str | None = None,
) -> dict:
    """
    Generate a JWT token via Supabase Edge Function.

    Args:
        project: Project identifier (e.g., "captionacc")
        service: Service identifier (e.g., "prefect", "modal")
        description: Human-readable description
        expires_in_days: Token expiration in days (1-365)
        backend: Optional backend URL for reference
        created_by: Optional creator identifier
        supabase_url: Supabase project URL
        service_role_key: Service role key

    Returns:
        dict: Token response with 'token', 'jti', 'expiresAt', etc.
    """
    # Get credentials from environment if not provided
    supabase_url = supabase_url or os.getenv("SUPABASE_URL")
    service_role_key = service_role_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url:
        raise ValueError("SUPABASE_URL environment variable not set")
    if not service_role_key:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY environment variable not set")

    # Construct edge function URL
    function_url = f"{supabase_url}/functions/v1/generate-gateway-token"

    # Prepare request payload
    payload = {
        "project": project,
        "service": service,
        "expiresInDays": expires_in_days,
    }

    if description:
        payload["description"] = description
    if backend:
        payload["backend"] = backend
    if created_by:
        payload["createdBy"] = created_by

    # Make request
    headers = {
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }

    try:
        response = httpx.post(function_url, json=payload, headers=headers, timeout=30.0)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as e:
        error_detail = e.response.text
        try:
            error_json = e.response.json()
            error_detail = error_json.get("error", error_detail)
        except Exception:
            pass
        raise RuntimeError(f"Token generation failed: {error_detail}") from e
    except httpx.RequestError as e:
        raise RuntimeError(f"Network error: {e}") from e


def main():
    parser = argparse.ArgumentParser(
        description="Generate API Gateway JWT token",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate token for Modal service
  python generate-token.py --project captionacc --service modal

  # Generate token with custom expiration
  python generate-token.py --project captionacc --service api --expires-in-days 30

  # Generate token with description
  python generate-token.py --project captionacc --service prefect \\
    --description "Production Prefect orchestrator token"

Environment variables:
  SUPABASE_URL              Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY Service role key (admin only)
        """,
    )

    parser.add_argument(
        "--project",
        required=True,
        help="Project identifier (e.g., captionacc)",
    )

    parser.add_argument(
        "--service",
        required=True,
        help="Service identifier (e.g., prefect, modal, api, orchestrator, web)",
    )

    parser.add_argument(
        "--description",
        help="Human-readable token description",
    )

    parser.add_argument(
        "--expires-in-days",
        type=int,
        default=90,
        help="Token expiration in days (default: 90, max: 365)",
    )

    parser.add_argument(
        "--backend",
        help="Backend URL for reference (optional)",
    )

    parser.add_argument(
        "--created-by",
        help="Creator identifier (optional)",
    )

    parser.add_argument(
        "--output-format",
        choices=["json", "text", "env"],
        default="text",
        help="Output format (default: text)",
    )

    args = parser.parse_args()

    try:
        # Generate token
        result = generate_token(
            project=args.project,
            service=args.service,
            description=args.description,
            expires_in_days=args.expires_in_days,
            backend=args.backend,
            created_by=args.created_by,
        )

        # Output based on format
        if args.output_format == "json":
            print(json.dumps(result, indent=2))
        elif args.output_format == "env":
            print(f"GATEWAY_TOKEN={result['token']}")
            print(f"GATEWAY_TOKEN_JTI={result['jti']}")
            print(f"GATEWAY_TOKEN_EXPIRES_AT={result['expiresAt']}")
        else:  # text
            print("✓ Token generated successfully!")
            print()
            print(f"Token:      {result['token']}")
            print(f"JTI:        {result['jti']}")
            print(f"Project:    {result['project']}")
            print(f"Service:    {result['service']}")
            print(f"Expires At: {result['expiresAt']}")
            print()
            print("Set this token in your service's environment variables:")
            print(f"  PREFECT_AUTH_TOKEN={result['token']}")
            print()
            print("For Fly.io:")
            print(f"  fly secrets set PREFECT_AUTH_TOKEN='{result['token']}' -a your-app")
            print()
            print("For Modal:")
            print(f"  modal secret create PREFECT_AUTH_TOKEN='{result['token']}'")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
