/**
 * Wasabi S3 utilities for Supabase Edge Functions.
 *
 * Uses AWS Signature Version 4 for presigned URLs.
 */

// Deno built-in crypto
const encoder = new TextEncoder();

async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  message: string
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

async function sha256(message: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(message));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(encoder.encode("AWS4" + secretKey), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  return kSigning;
}

export interface WasabiConfig {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  endpoint?: string;
  pathStyle?: boolean; // Use path-style URLs (required for MinIO)
}

export interface PresignedUrlOptions {
  key: string;
  contentType: string;
  expiresIn?: number; // seconds, default 900 (15 min)
}

/**
 * Generate a presigned PUT URL for Wasabi S3.
 */
export async function generatePresignedPutUrl(
  config: WasabiConfig,
  options: PresignedUrlOptions
): Promise<{ url: string; expiresAt: string }> {
  const { accessKeyId, secretAccessKey, bucket, region } = config;
  const endpoint = config.endpoint || `https://s3.${region}.wasabisys.com`;
  const pathStyle = config.pathStyle ?? false;
  const { key, contentType, expiresIn = 900 } = options;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const expiresAt = new Date(now.getTime() + expiresIn * 1000);

  // Parse endpoint to get host and protocol
  const endpointUrl = new URL(endpoint);
  const protocol = endpointUrl.protocol; // http: or https:

  // Canonical request components
  const method = "PUT";
  // Path-style: /bucket/key, Virtual-hosted: /key
  const canonicalUri = pathStyle ? `/${bucket}/${key}` : `/${key}`;
  // Path-style: endpoint host, Virtual-hosted: bucket.s3.region.wasabisys.com
  const host = pathStyle
    ? endpointUrl.host
    : `${bucket}.s3.${region}.wasabisys.com`;

  // Query parameters for presigned URL
  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": algorithm,
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": expiresIn.toString(),
    "X-Amz-SignedHeaders": "content-type;host",
  });

  // Sort query params (required for signing)
  const sortedParams = new URLSearchParams(
    [...queryParams.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  );
  const canonicalQueryString = sortedParams.toString();

  // Canonical headers
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = "content-type;host";

  // For presigned URLs, payload is UNSIGNED-PAYLOAD
  const hashedPayload = "UNSIGNED-PAYLOAD";

  // Build canonical request
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join("\n");

  // String to sign
  const hashedCanonicalRequest = await sha256(canonicalRequest);
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  // Calculate signature
  const signingKey = await getSignatureKey(
    secretAccessKey,
    dateStamp,
    region,
    "s3"
  );
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  // Build final URL
  const presignedUrl = `${protocol}//${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;

  return {
    url: presignedUrl,
    expiresAt: expiresAt.toISOString(),
  };
}
