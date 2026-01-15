/**
 * Generate Gateway Token Edge Function
 *
 * Creates JWT tokens for API gateway authentication across multiple projects.
 * Tokens are validated locally by Traefik (no round-trip to Supabase on every request).
 *
 * POST /functions/v1/generate-gateway-token
 *
 * Request body:
 * {
 *   "project": "captionacc",        // Project identifier
 *   "service": "prefect",            // Service identifier
 *   "description": "Modal service token",
 *   "expiresInDays": 90,             // Optional, defaults to 90 days
 *   "backend": "banchelabs-gateway.internal:4200"  // Optional reference
 * }
 *
 * Response:
 * {
 *   "token": "eyJhbGciOiJIUzI1NiIs...",
 *   "jti": "uuid",
 *   "expiresAt": "2026-04-13T00:00:00Z",
 *   "project": "captionacc",
 *   "service": "prefect"
 * }
 *
 * Authorization: Service role key required (admin only)
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { generateJWT, hashToken, generateJTI, calculateExpiration } from "../_shared/jwt.ts";
// Environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_SERVICE_KEY = Deno.env.get("ADMIN_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const JWT_SIGNING_SECRET = Deno.env.get("TRAEFIK_JWT_SECRET");
// Default token expiration
const DEFAULT_EXPIRY_DAYS = 90;
const MAX_EXPIRY_DAYS = 365;
Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest();
  }
  // Only allow POST
  if (req.method !== "POST") {
    return jsonResponse({
      error: "Method not allowed"
    }, 405);
  }
  try {
    // Verify service role authorization via custom header
    const serviceKey = req.headers.get("X-Service-Role-Key");
    if (!serviceKey) {
      return jsonResponse({
        error: "Missing X-Service-Role-Key header",
        code: "UNAUTHORIZED"
      }, 401);
    }
    // Only service role can generate tokens (admin only)
    if (serviceKey !== ADMIN_SERVICE_KEY) {
      return jsonResponse({
        error: "Forbidden: Service role key required",
        code: "FORBIDDEN"
      }, 403);
    }
    // Validate JWT signing secret is configured
    if (!JWT_SIGNING_SECRET) {
      console.error("TRAEFIK_JWT_SECRET environment variable not set");
      return jsonResponse({
        error: "Server configuration error",
        code: "CONFIG_ERROR"
      }, 500);
    }
    // Parse request body
    const body = await req.json();
    const { project, service, description, expiresInDays = DEFAULT_EXPIRY_DAYS, backend, createdBy, metadata = {} } = body;
    // Validate required fields
    if (!project || !service) {
      return jsonResponse({
        error: "Missing required fields: project, service",
        code: "VALIDATION_ERROR"
      }, 400);
    }
    // Validate project name format (alphanumeric, dashes, underscores)
    if (!/^[a-z0-9_-]+$/i.test(project)) {
      return jsonResponse({
        error: "Invalid project name. Use only letters, numbers, dashes, and underscores.",
        code: "INVALID_PROJECT"
      }, 400);
    }
    // Validate service name format
    if (!/^[a-z0-9_-]+$/i.test(service)) {
      return jsonResponse({
        error: "Invalid service name. Use only letters, numbers, dashes, and underscores.",
        code: "INVALID_SERVICE"
      }, 400);
    }
    // Validate expiration
    if (expiresInDays < 1 || expiresInDays > MAX_EXPIRY_DAYS) {
      return jsonResponse({
        error: `Expiration must be between 1 and ${MAX_EXPIRY_DAYS} days`,
        code: "INVALID_EXPIRY"
      }, 400);
    }
    // Generate JWT
    const jti = generateJTI();
    const iat = Math.floor(Date.now() / 1000);
    const exp = calculateExpiration(expiresInDays);
    const payload = {
      jti,
      project,
      service,
      iat,
      exp
    };
    const jwt = await generateJWT(payload, JWT_SIGNING_SECRET);
    const tokenHash = await hashToken(jwt);
    // Create Supabase client
    const supabase = createClient(SUPABASE_URL, ADMIN_SERVICE_KEY, {
      auth: {
        persistSession: false
      }
    });
    // Store token metadata in database
    const expiresAt = new Date(exp * 1000).toISOString();
    const { error: insertError } = await supabase.from("gateway_tokens").insert({
      token_hash: tokenHash,
      jti,
      project,
      service,
      backend,
      description,
      created_by: createdBy,
      expires_at: expiresAt,
      is_active: true,
      metadata
    });
    if (insertError) {
      console.error("Failed to store token metadata:", insertError);
      return jsonResponse({
        error: "Failed to create token",
        code: "DB_ERROR"
      }, 500);
    }
    const response = {
      token: jwt,
      jti,
      expiresAt,
      project,
      service
    };
    return jsonResponse(response, 201);
  } catch (error) {
    console.error("Token generation error:", error);
    return jsonResponse({
      error: "Internal server error",
      code: "INTERNAL_ERROR"
    }, 500);
  }
});
function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
