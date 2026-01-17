/**
 * Presigned Upload Edge Function
 *
 * Two-phase upload process:
 *
 * Phase 1 - Generate presigned URL (no video record created):
 * POST /functions/v1/captionacc-presigned-upload
 * Request: { filename, contentType, sizeBytes, videoPath?, width?, height? }
 * Response: { uploadUrl, videoId, storageKey, expiresAt }
 *
 * Phase 2 - Confirm upload completion (creates video record with workflow statuses at 'wait'):
 * POST /functions/v1/captionacc-presigned-upload/confirm
 * Request: { videoId, storageKey, filename, contentType, sizeBytes, videoPath?, width?, height? }
 * Response: { success: true }
 *
 * The video record is only created after upload completes, so the Supabase
 * INSERT webhook fires when the video is fully uploaded and ready for processing.
 * Workflow statuses (layout_status, boundaries_status, text_status) default to 'wait'.
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

interface ConfirmRequest {
  videoId: string;
  storageKey: string;
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

interface ConfirmResponse {
  success: boolean;
}

interface ErrorResponse {
  error: string;
  code?: string;
}

/**
 * Phase 1: Generate presigned URL and return video ID for tracking
 * Does NOT create video record yet
 */
async function handleGenerate(
  req: Request,
  userId: string,
  tenantId: string
): Promise<Response> {
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

  // Generate video ID for tracking
  const videoId = crypto.randomUUID();

  // Storage key pattern: {tenant_id}/client/videos/{video_id}/video.mp4
  const storageKey = `${tenantId}/client/videos/${videoId}/video.mp4`;

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
}

/**
 * Phase 2: Confirm upload completion and create video record with workflow statuses at 'wait'
 * This triggers the Supabase INSERT webhook for backend processing
 */
async function handleConfirm(
  req: Request,
  userId: string,
  tenantId: string
): Promise<Response> {
  const body: ConfirmRequest = await req.json();
  const { videoId, storageKey, filename, contentType, sizeBytes, videoPath, width, height } = body;

  // Validate request
  if (!videoId || !storageKey || !filename || !contentType || !sizeBytes) {
    return jsonResponse(
      { error: "Missing required fields: videoId, storageKey, filename, contentType, sizeBytes" },
      400
    );
  }

  // Create video record with service role client (bypasses RLS)
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: DB_SCHEMA },
    auth: { persistSession: false },
  });

  // Create video record with workflow statuses defaulting to 'wait'
  // This will trigger the Supabase INSERT webhook for backend processing
  // Note: storage_key is computed as {tenant_id}/client/videos/{video_id}/video.mp4 (not stored)
  // Note: layout_status, boundaries_status, text_status default to 'wait' via database defaults
  const { error: insertError } = await supabaseAdmin.from("videos").insert({
    id: videoId,
    tenant_id: tenantId,
    display_path: videoPath || filename,
    size_bytes: sizeBytes,
    width: width ?? 0,
    height: height ?? 0,
    uploaded_by_user_id: userId,
    uploaded_at: new Date().toISOString(),
  });

  if (insertError) {
    console.error("Failed to create video record:", insertError);
    return jsonResponse(
      { error: "Failed to create video record", code: "DB_ERROR" },
      500
    );
  }

  const response: ConfirmResponse = {
    success: true,
  };

  return jsonResponse(response, 200);
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
    // Determine if this is a confirm request based on URL path
    const url = new URL(req.url);
    const isConfirm = url.pathname.endsWith("/confirm");

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

    // Route to appropriate handler
    if (isConfirm) {
      return await handleConfirm(req, user.id, tenantId);
    } else {
      return await handleGenerate(req, user.id, tenantId);
    }
  } catch (error) {
    console.error("Presigned upload error:", error);
    return jsonResponse(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      500
    );
  }
});

function jsonResponse(
  data: UploadResponse | ConfirmResponse | ErrorResponse,
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
