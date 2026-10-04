-- Wallet (P4): one key per provider per user, with what the provider told us about it.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "tier" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "data_policy" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "meta" JSONB;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "last_checked_at" TIMESTAMPTZ(6);
