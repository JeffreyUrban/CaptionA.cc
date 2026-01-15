/**
 * Presigned Upload Edge Function
 *
 * Generates a presigned PUT URL for direct video upload to Wasabi S3.
 * Creates a video record in Supabase with status 'uploading'.
 *
 * POST /functions/v1/presigned-upload
 *
 * Request body:
 * {
 *   "filename": "video.mp4",
 *   "contentType": "video/mp4",
 *   "sizeBytes": 104857600
 * }
 *
 * Response:
 * {
 *   "uploadUrl": "https://...",
 *   "videoId": "uuid",
 *   "storageKey": "tenant_id/videos/video_id/video.mp4",
 *   "expiresAt": "2026-01-11T11:00:00Z"
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { generatePresignedPutUrl, WasabiConfig } from "../_shared/wasabi.ts";

// Environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DB_SCHEMA = Deno.env.get("DB_SCHEMA") || "captionacc_production";

const WASABI_ACCESS_KEY_ID = Deno.env.get("WASABI_ACCESS_KEY_READWRITE")!;
const WASABI_SECRET_ACCESS_KEY = Deno.env.get("WASABI_SECRET_KEY_READWRITE")!;
const WASABI_BUCKET = Deno.env.get("WASABI_BUCKET")!;
const WASABI_REGION = Deno.env.get("WASABI_REGION") || "us-east-1";

// Allowed content types for video upload
const ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-matroska",
];

// Max file size: 10GB
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;

interface UploadRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
  videoPath?: string;
  width?: number;
  height?: number;
}

interface UploadResponse {
  uploadUrl: string;
  videoId: string;
  storageKey: string;
  expiresAt: string;
}

interface ErrorResponse {
  error: string;
  code?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // Get user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization header" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");

    // Create Supabase client with service role key (needed to validate JWT)
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      db: { schema: DB_SCHEMA },
      auth: { persistSession: false },
    });

    // Verify user and get their profile
    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Invalid token", code: "AUTH_ERROR" }, 401);
    }

    // Get user's tenant_id from profile
    const { data: profile, error: profileError } = await supabaseUser
      .from("user_profiles")
      .select("tenant_id, approval_status")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return jsonResponse(
        { error: "User profile not found", code: "PROFILE_NOT_FOUND" },
        403
      );
    }

    if (profile.approval_status !== "approved") {
      return jsonResponse(
        { error: "User not approved for uploads", code: "NOT_APPROVED" },
        403
      );
    }

    const tenantId = profile.tenant_id;

    // Parse request body
    const body: UploadRequest = await req.json();
    const { filename, contentType, sizeBytes, videoPath, width, height } = body;

    // Validate request
    if (!filename || !contentType || !sizeBytes) {
      return jsonResponse(
        { error: "Missing required fields: filename, contentType, sizeBytes" },
        400
      );
    }

    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return jsonResponse(
        {
          error: `Invalid content type. Allowed: ${ALLOWED_CONTENT_TYPES.join(", ")}`,
          code: "INVALID_CONTENT_TYPE",
        },
        400
      );
    }

    if (sizeBytes > MAX_FILE_SIZE) {
      return jsonResponse(
        {
          error: `File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB`,
          code: "FILE_TOO_LARGE",
        },
        400
      );
    }

    // Create video record with service role client (bypasses RLS)
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      db: { schema: DB_SCHEMA },
      auth: { persistSession: false },
    });

    // Generate video ID
    const videoId = crypto.randomUUID();

    // Storage key pattern: {tenant_id}/client/videos/{video_id}/video.mp4
    const storageKey = `${tenantId}/client/videos/${videoId}/video.mp4`;

    // Create video record
    const { error: insertError } = await supabaseAdmin.from("videos").insert({
      id: videoId,
      tenant_id: tenantId,
      video_path: videoPath || filename, // Use videoPath for better organization
      display_path: videoPath || filename, // Display path for UI
      storage_key: storageKey,
      size_bytes: sizeBytes,
      width: width ?? 0, // Use client-provided dimensions or default to 0
      height: height ?? 0,
      status: "uploading",
      uploaded_by_user_id: user.id,
      uploaded_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error("Failed to create video record:", insertError);
      return jsonResponse(
        { error: "Failed to create video record", code: "DB_ERROR" },
        500
      );
    }

    // Generate presigned URL
    const wasabiConfig: WasabiConfig = {
      accessKeyId: WASABI_ACCESS_KEY_ID,
      secretAccessKey: WASABI_SECRET_ACCESS_KEY,
      bucket: WASABI_BUCKET,
      region: WASABI_REGION,
    };

    const { url, expiresAt } = await generatePresignedPutUrl(wasabiConfig, {
      key: storageKey,
      contentType: contentType,
      expiresIn: 3600, // 1 hour for large uploads
    });

    const response: UploadResponse = {
      uploadUrl: url,
      videoId,
      storageKey,
      expiresAt,
    };

    return jsonResponse(response, 200);
  } catch (error) {
    console.error("Presigned upload error:", error);
    return jsonResponse(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      500
    );
  }
});

function jsonResponse(
  data: UploadResponse | ErrorResponse,
  status: number
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
