/**
 * S3 Credentials Edge Function (DEV)
 *
 * Development version - uses captionacc_dev schema.
 *
 * Returns temporary STS credentials for direct Wasabi S3 access,
 * scoped to the tenant's client/ paths (read-only).
 *
 * GET /functions/v1/captionacc-s3-credentials
 *
 * Response:
 * {
 *   "credentials": {
 *     "accessKeyId": "ASIA...",
 *     "secretAccessKey": "...",
 *     "sessionToken": "..."
 *   },
 *   "expiration": "2026-01-11T23:00:00Z",
 *   "bucket": "captionacc-prod",
 *   "region": "us-east-1",
 *   "endpoint": "https://s3.us-east-1.wasabisys.com",
 *   "prefix": "{tenant_id}/client/*"
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { assumeRole, STSConfig } from "../_shared/sts.ts";

// Environment variables (DEV uses DB_SCHEMA)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DB_SCHEMA = Deno.env.get("DB_SCHEMA") || "captionacc_dev";

const WASABI_STS_ACCESS_KEY = Deno.env.get("WASABI_STS_ACCESS_KEY")!
const WASABI_STS_SECRET_KEY = Deno.env.get("WASABI_STS_SECRET_KEY")!;
const WASABI_STS_ROLE_ARN = Deno.env.get("WASABI_STS_ROLE_ARN")!;
const WASABI_BUCKET = Deno.env.get("WASABI_BUCKET")!;
const WASABI_REGION = Deno.env.get("WASABI_REGION") || "us-east-1";
const WASABI_STS_DURATION_SECONDS = parseInt(
  Deno.env.get("WASABI_STS_DURATION_SECONDS") || "3600"
);

// CORS headers that allow GET
const getCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

interface CredentialsResponse {
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  };
  expiration: string;
  bucket: string;
  region: string;
  endpoint: string;
  prefix: string;
}

interface ErrorResponse {
  error: string;
  code?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders });
  }

  // Only allow GET
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // Get user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization header" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");

    // Create Supabase client with anon key and user's token
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      db: { schema: DB_SCHEMA },
      auth: { persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    // Verify user and get their profile
    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: "Invalid token", code: "AUTH_ERROR" }, 401);
    }

    // Get user's tenant_id from profile
    const { data: profile, error: profileError } = await supabaseUser
      .from("user_profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return jsonResponse(
        { error: "User profile not found", code: "PROFILE_NOT_FOUND" },
        403
      );
    }

    const tenantId = profile.tenant_id;

    // Build session policy to scope credentials to tenant's client/ path
    const sessionPolicy = JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:GetObject"],
          Resource: `arn:aws:s3:::${WASABI_BUCKET}/${tenantId}/client/*`,
        },
      ],
    });

    // Call STS AssumeRole
    const stsConfig: STSConfig = {
      accessKeyId: WASABI_STS_ACCESS_KEY,
      secretAccessKey: WASABI_STS_SECRET_KEY,
      region: WASABI_REGION,
    };

    const result = await assumeRole(stsConfig, {
      roleArn: WASABI_STS_ROLE_ARN,
      roleSessionName: `tenant-${tenantId.slice(0, 8)}`,
      durationSeconds: WASABI_STS_DURATION_SECONDS,
      policy: sessionPolicy,
    });

    const response: CredentialsResponse = {
      credentials: {
        accessKeyId: result.accessKeyId,
        secretAccessKey: result.secretAccessKey,
        sessionToken: result.sessionToken,
      },
      expiration: result.expiration,
      bucket: WASABI_BUCKET,
      region: WASABI_REGION,
      endpoint: `https://s3.${WASABI_REGION}.wasabisys.com`,
      prefix: `${tenantId}/client/*`,
    };

    return jsonResponse(response, 200);
  } catch (error) {
    console.error("S3 credentials error:", error);
    return jsonResponse(
      { error: "Failed to obtain credentials", code: "STS_ERROR" },
      503
    );
  }
});

function jsonResponse(
  data: CredentialsResponse | ErrorResponse,
  status: number
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...getCorsHeaders,
      "Content-Type": "application/json",
    },
  });
}
