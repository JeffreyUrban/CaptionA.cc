-- Migration: API Gateway Token Management
-- Description: Creates tables and functions for managing JWT tokens across multiple projects

-- Table to track issued gateway tokens (audit log)
CREATE TABLE IF NOT EXISTS public.gateway_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Token identification
    token_hash TEXT NOT NULL UNIQUE,
    jti TEXT NOT NULL UNIQUE, -- JWT ID for revocation

    -- Project and service identification
    project TEXT NOT NULL, -- e.g., "captionacc", "otherproject"
    service TEXT NOT NULL, -- e.g., "prefect", "api", "orchestrator"
    backend TEXT, -- Optional: target backend URL for reference

    -- Token metadata
    description TEXT,
    created_by TEXT, -- User/admin who created the token
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ,

    -- Token status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    revoked_at TIMESTAMPTZ,
    revoked_by TEXT,
    revocation_reason TEXT,

    -- Audit fields
    metadata JSONB DEFAULT '{}'::jsonb,

    CONSTRAINT token_expiry_check CHECK (expires_at > created_at)
);

-- Indexes for performance
CREATE INDEX idx_gateway_tokens_project_service ON public.gateway_tokens(project, service);
CREATE INDEX idx_gateway_tokens_jti ON public.gateway_tokens(jti) WHERE is_active = true;
CREATE INDEX idx_gateway_tokens_active ON public.gateway_tokens(is_active, expires_at);
CREATE INDEX idx_gateway_tokens_token_hash ON public.gateway_tokens(token_hash);

-- Table to track revoked tokens (for JWT blocklist)
CREATE TABLE IF NOT EXISTS public.gateway_tokens_revoked (
    jti TEXT PRIMARY KEY,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL, -- Original token expiry (for cleanup)
    reason TEXT
);

-- Index for fast revocation checks
CREATE INDEX idx_gateway_tokens_revoked_expires ON public.gateway_tokens_revoked(expires_at);

-- Function to check if a token is revoked
CREATE OR REPLACE FUNCTION public.is_token_revoked(token_jti TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.gateway_tokens_revoked
        WHERE jti = token_jti
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to revoke a token
CREATE OR REPLACE FUNCTION public.revoke_gateway_token(
    token_jti TEXT,
    revoked_by_user TEXT DEFAULT NULL,
    reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    token_record RECORD;
BEGIN
    -- Get token details
    SELECT * INTO token_record
    FROM public.gateway_tokens
    WHERE jti = token_jti AND is_active = true;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Update gateway_tokens table
    UPDATE public.gateway_tokens
    SET
        is_active = false,
        revoked_at = NOW(),
        revoked_by = revoked_by_user,
        revocation_reason = reason
    WHERE jti = token_jti;

    -- Add to revocation list
    INSERT INTO public.gateway_tokens_revoked (jti, expires_at, reason)
    VALUES (token_jti, token_record.expires_at, reason)
    ON CONFLICT (jti) DO NOTHING;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up expired revoked tokens (run periodically)
CREATE OR REPLACE FUNCTION public.cleanup_expired_revocations()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.gateway_tokens_revoked
    WHERE expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update last_used_at timestamp
CREATE OR REPLACE FUNCTION public.update_token_usage(token_jti TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE public.gateway_tokens
    SET last_used_at = NOW()
    WHERE jti = token_jti AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Row Level Security (RLS)
ALTER TABLE public.gateway_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_tokens_revoked ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can manage tokens (admins only)
CREATE POLICY "Service role can manage gateway tokens"
    ON public.gateway_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage revoked tokens"
    ON public.gateway_tokens_revoked
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON public.gateway_tokens TO service_role;
GRANT SELECT, INSERT ON public.gateway_tokens_revoked TO service_role;
GRANT EXECUTE ON FUNCTION public.is_token_revoked TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_gateway_token TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_revocations TO service_role;
GRANT EXECUTE ON FUNCTION public.update_token_usage TO service_role;

-- Add helpful comments
COMMENT ON TABLE public.gateway_tokens IS 'Audit log of all issued API gateway JWT tokens across projects';
COMMENT ON TABLE public.gateway_tokens_revoked IS 'Blocklist of revoked JWTs (cleaned up after token expiry)';
COMMENT ON COLUMN public.gateway_tokens.jti IS 'JWT ID claim - unique identifier for revocation';
COMMENT ON COLUMN public.gateway_tokens.project IS 'Project identifier (e.g., captionacc)';
COMMENT ON COLUMN public.gateway_tokens.service IS 'Service identifier (e.g., prefect, api, modal)';
COMMENT ON COLUMN public.gateway_tokens.token_hash IS 'SHA256 hash of the issued JWT for lookup';
