/**
 * Wasabi STS utilities for Supabase Edge Functions.
 *
 * Uses AWS Signature Version 4 for STS AssumeRole requests.
 */

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

export interface STSConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint?: string;
}

export interface AssumeRoleOptions {
  roleArn: string;
  roleSessionName: string;
  durationSeconds?: number;
  policy?: string; // JSON session policy
}

export interface AssumeRoleResult {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}

/**
 * Call STS AssumeRole to get temporary credentials.
 */
export async function assumeRole(
  config: STSConfig,
  options: AssumeRoleOptions
): Promise<AssumeRoleResult> {
  const { accessKeyId, secretAccessKey, region } = config;
  const endpoint = config.endpoint || `https://sts.${region}.wasabisys.com`;
  const host = new URL(endpoint).host;

  const {
    roleArn,
    roleSessionName,
    durationSeconds = 3600,
    policy,
  } = options;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  // Build request body (form-encoded)
  const bodyParams = new URLSearchParams({
    Action: "AssumeRole",
    Version: "2011-06-15",
    RoleArn: roleArn,
    RoleSessionName: roleSessionName,
    DurationSeconds: durationSeconds.toString(),
  });

  if (policy) {
    bodyParams.set("Policy", policy);
  }

  const requestBody = bodyParams.toString();
  const hashedPayload = await sha256(requestBody);

  // Canonical request
  const method = "POST";
  const canonicalUri = "/";
  const canonicalQueryString = "";
  const contentType = "application/x-www-form-urlencoded";

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = "content-type;host;x-amz-date";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join("\n");

  // String to sign
  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/sts/aws4_request`;
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
    "sts"
  );
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  // Authorization header
  const authorizationHeader =
    `${algorithm} ` +
    `Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  // Make request
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "X-Amz-Date": amzDate,
      Authorization: authorizationHeader,
    },
    body: requestBody,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("STS AssumeRole failed:", response.status, errorText);
    throw new Error(`STS AssumeRole failed: ${response.status}`);
  }

  const responseText = await response.text();

  // Parse XML response
  const accessKeyIdMatch = responseText.match(
    /<AccessKeyId>([^<]+)<\/AccessKeyId>/
  );
  const secretAccessKeyMatch = responseText.match(
    /<SecretAccessKey>([^<]+)<\/SecretAccessKey>/
  );
  const sessionTokenMatch = responseText.match(
    /<SessionToken>([^<]+)<\/SessionToken>/
  );
  const expirationMatch = responseText.match(
    /<Expiration>([^<]+)<\/Expiration>/
  );

  if (
    !accessKeyIdMatch ||
    !secretAccessKeyMatch ||
    !sessionTokenMatch ||
    !expirationMatch
  ) {
    console.error("Failed to parse STS response:", responseText);
    throw new Error("Failed to parse STS response");
  }

  return {
    accessKeyId: accessKeyIdMatch[1],
    secretAccessKey: secretAccessKeyMatch[1],
    sessionToken: sessionTokenMatch[1],
    expiration: expirationMatch[1],
  };
}
