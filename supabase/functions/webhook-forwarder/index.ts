/**
 * Supabase Edge Function: Webhook Forwarder with Retry Logic
 *
 * Forwards Supabase webhook events to captionacc-api with automatic retries
 * to handle Fly.io machine wake-up delays (up to 60s grace period).
 *
 * Configuration via URL Parameters:
 *   - target_path: API endpoint path (e.g., "/webhooks/supabase/videos")
 *   - max_retries: Maximum retry attempts (default: 5)
 *   - initial_delay_ms: Initial retry delay in milliseconds (default: 2000)
 *   - max_delay_ms: Maximum retry delay in milliseconds (default: 15000)
 *   - total_timeout_ms: Total timeout including all retries (default: 65000)
 *
 * Example webhook configuration:
 *   URL: https://[project-ref].supabase.co/functions/v1/webhook-forwarder
 *   Method: POST
 *   HTTP Parameters:
 *     - target_path: /webhooks/supabase/videos
 *   HTTP Headers:
 *     - Authorization: Bearer [edge-function-anon-key]
 *     - x-webhook-secret: Bearer [captionacc-api-webhook-secret]
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  totalTimeoutMs: number;
}

interface ForwardResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  attempts: number;
  totalDurationMs: number;
  error?: string;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number
): number {
  const exponentialDelay = initialDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
  const delay = Math.min(exponentialDelay + jitter, maxDelayMs);
  return Math.floor(delay);
}

/**
 * Forward webhook request to captionacc-api with retries
 */
async function forwardWebhook(
  targetUrl: string,
  payload: unknown,
  webhookSecret: string,
  config: RetryConfig
): Promise<ForwardResult> {
  const startTime = Date.now();
  let attempts = 0;

  console.log(`[Forwarder] Starting forward to ${targetUrl}`);
  console.log(`[Forwarder] Config:`, JSON.stringify(config));

  while (attempts < config.maxRetries) {
    attempts++;
    const attemptStartTime = Date.now();

    // Check if we've exceeded total timeout
    const elapsedMs = attemptStartTime - startTime;
    if (elapsedMs >= config.totalTimeoutMs) {
      console.error(
        `[Forwarder] Total timeout exceeded (${elapsedMs}ms >= ${config.totalTimeoutMs}ms)`
      );
      return {
        success: false,
        attempts,
        totalDurationMs: elapsedMs,
        error: `Total timeout exceeded after ${attempts} attempts`,
      };
    }

    // Calculate remaining time for this attempt
    const remainingMs = config.totalTimeoutMs - elapsedMs;
    const attemptTimeoutMs = Math.min(
      15000, // Max 15s per attempt
      remainingMs
    );

    console.log(
      `[Forwarder] Attempt ${attempts}/${config.maxRetries} (timeout: ${attemptTimeoutMs}ms)`
    );

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        attemptTimeoutMs
      );

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: webhookSecret,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const attemptDurationMs = Date.now() - attemptStartTime;
      const totalDurationMs = Date.now() - startTime;
      const responseBody = await response.text();

      console.log(
        `[Forwarder] Attempt ${attempts} completed in ${attemptDurationMs}ms: ${response.status}`
      );

      // Success (2xx status codes)
      if (response.ok) {
        console.log(
          `[Forwarder] ✅ Success after ${attempts} attempts (${totalDurationMs}ms total)`
        );
        return {
          success: true,
          statusCode: response.status,
          responseBody,
          attempts,
          totalDurationMs,
        };
      }

      // Client errors (4xx) - don't retry
      if (response.status >= 400 && response.status < 500) {
        console.error(
          `[Forwarder] ❌ Client error ${response.status} - not retrying`
        );
        return {
          success: false,
          statusCode: response.status,
          responseBody,
          attempts,
          totalDurationMs,
          error: `Client error: ${response.status}`,
        };
      }

      // Server errors (5xx) - retry
      console.warn(
        `[Forwarder] ⚠️  Server error ${response.status} - will retry`
      );

      // If we have retries left, wait before next attempt
      if (attempts < config.maxRetries) {
        const delayMs = calculateBackoffDelay(
          attempts,
          config.initialDelayMs,
          config.maxDelayMs
        );
        console.log(`[Forwarder] Waiting ${delayMs}ms before retry...`);
        await sleep(delayMs);
      }
    } catch (error) {
      const attemptDurationMs = Date.now() - attemptStartTime;
      const totalDurationMs = Date.now() - startTime;

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if it's a timeout/abort
      const isTimeout =
        errorMessage.includes("abort") || errorMessage.includes("timeout");

      if (isTimeout) {
        console.warn(
          `[Forwarder] ⏱️  Attempt ${attempts} timed out after ${attemptDurationMs}ms`
        );
      } else {
        console.error(
          `[Forwarder] ❌ Attempt ${attempts} failed: ${errorMessage}`
        );
      }

      // If we have retries left, wait before next attempt
      if (attempts < config.maxRetries) {
        const delayMs = calculateBackoffDelay(
          attempts,
          config.initialDelayMs,
          config.maxDelayMs
        );
        console.log(`[Forwarder] Waiting ${delayMs}ms before retry...`);
        await sleep(delayMs);
      } else {
        // Last attempt failed
        return {
          success: false,
          attempts,
          totalDurationMs,
          error: errorMessage,
        };
      }
    }
  }

  // All retries exhausted
  const totalDurationMs = Date.now() - startTime;
  console.error(
    `[Forwarder] ❌ All ${config.maxRetries} attempts failed (${totalDurationMs}ms total)`
  );
  return {
    success: false,
    attempts,
    totalDurationMs,
    error: "All retry attempts exhausted",
  };
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-webhook-secret",
      },
    });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    // Parse URL parameters
    const url = new URL(req.url);
    const targetPath =
      url.searchParams.get("target_path") || "/webhooks/supabase/videos";
    const maxRetries = parseInt(url.searchParams.get("max_retries") || "5");
    const initialDelayMs = parseInt(
      url.searchParams.get("initial_delay_ms") || "2000"
    );
    const maxDelayMs = parseInt(
      url.searchParams.get("max_delay_ms") || "15000"
    );
    const totalTimeoutMs = parseInt(
      url.searchParams.get("total_timeout_ms") || "65000"
    );

    // Get webhook secret from headers
    // Supabase passes this from the webhook configuration
    const webhookSecret = req.headers.get("x-webhook-secret");
    if (!webhookSecret) {
      console.error("[Forwarder] Missing x-webhook-secret header");
      return new Response(
        JSON.stringify({
          error: "Missing x-webhook-secret header",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Parse webhook payload
    const payload = await req.json();
    console.log(`[Forwarder] Received webhook payload for table: ${payload.table}, type: ${payload.type}`);

    // Filter UPDATE events - only forward soft-deletes (deleted_at: NULL → timestamp)
    // This prevents unnecessary API wake-ups for regular video updates (status changes, metadata, etc.)
    if (payload.type === "UPDATE") {
      const oldDeletedAt = payload.old_record?.deleted_at;
      const newDeletedAt = payload.record?.deleted_at;

      // Only forward if this is a soft-delete (deleted_at changed from NULL to a timestamp)
      if (oldDeletedAt !== null || newDeletedAt === null) {
        console.log(
          `[Forwarder] Ignoring UPDATE event - not a soft-delete (old_deleted_at: ${oldDeletedAt}, new_deleted_at: ${newDeletedAt})`
        );
        return new Response(
          JSON.stringify({
            success: true,
            message: "UPDATE event ignored - not a soft-delete",
            skipped: true,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      console.log(
        `[Forwarder] Detected soft-delete (deleted_at: ${oldDeletedAt} → ${newDeletedAt}) - forwarding to API`
      );
    }

    // Construct target URL
    const targetUrl = `https://captionacc-api.fly.dev${targetPath}`;

    // Forward with retries
    const config: RetryConfig = {
      maxRetries,
      initialDelayMs,
      maxDelayMs,
      totalTimeoutMs,
    };

    const result = await forwardWebhook(
      targetUrl,
      payload,
      webhookSecret,
      config
    );

    // Return appropriate response
    if (result.success) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Webhook forwarded successfully",
          attempts: result.attempts,
          durationMs: result.totalDurationMs,
          targetUrl,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } else {
      // Forward failed - return error details
      console.error(
        `[Forwarder] Failed to forward webhook: ${result.error}`
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: result.error,
          attempts: result.attempts,
          durationMs: result.totalDurationMs,
          statusCode: result.statusCode,
          targetUrl,
        }),
        {
          status: 502, // Bad Gateway
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Forwarder] Unexpected error: ${errorMessage}`);

    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal edge function error",
        details: errorMessage,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
