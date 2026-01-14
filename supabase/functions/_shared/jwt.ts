/**
 * JWT Token Generation and Validation Utilities
 *
 * Provides functions for creating and verifying JWT tokens for API gateway authentication.
 * Uses HMAC SHA-256 signing.
 */

import { encode as base64UrlEncode } from "https://deno.land/std@0.208.0/encoding/base64url.ts";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";

export interface JWTPayload {
  jti: string; // JWT ID for revocation
  project: string; // e.g., "captionacc"
  service: string; // e.g., "prefect", "api", "modal"
  iat: number; // Issued at (Unix timestamp)
  exp: number; // Expires at (Unix timestamp)
  [key: string]: unknown; // Allow additional claims
}

export interface JWTHeader {
  alg: string;
  typ: string;
}

/**
 * Generate a JWT token for API gateway authentication
 *
 * @param payload - JWT payload with required claims
 * @param secret - HMAC signing secret
 * @returns Signed JWT token
 */
export async function generateJWT(
  payload: JWTPayload,
  secret: string
): Promise<string> {
  // Validate required fields
  if (!payload.jti || !payload.project || !payload.service || !payload.exp) {
    throw new Error(
      "Missing required JWT claims: jti, project, service, exp"
    );
  }

  if (!payload.iat) {
    payload.iat = Math.floor(Date.now() / 1000);
  }

  // Create header
  const header: JWTHeader = {
    alg: "HS256",
    typ: "JWT",
  };

  // Encode header and payload
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  // Create signature
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = await createHmacSignature(data, secret);

  // Return complete JWT
  return `${data}.${signature}`;
}

/**
 * Create HMAC SHA-256 signature
 *
 * @param data - Data to sign
 * @param secret - HMAC secret
 * @returns Base64URL-encoded signature
 */
async function createHmacSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  // Import key for HMAC
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Create signature
  const signature = await crypto.subtle.sign("HMAC", key, messageData);

  // Convert to base64url
  return base64UrlEncode(new Uint8Array(signature));
}

/**
 * Create a SHA-256 hash of the JWT token for storage
 *
 * @param token - JWT token to hash
 * @returns Hex-encoded SHA-256 hash
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a cryptographically secure random JTI (JWT ID)
 *
 * @returns Random UUID v4
 */
export function generateJTI(): string {
  return crypto.randomUUID();
}

/**
 * Calculate expiration timestamp
 *
 * @param daysFromNow - Number of days until expiration
 * @returns Unix timestamp
 */
export function calculateExpiration(daysFromNow: number): number {
  const now = Date.now();
  const expirationMs = now + daysFromNow * 24 * 60 * 60 * 1000;
  return Math.floor(expirationMs / 1000);
}
