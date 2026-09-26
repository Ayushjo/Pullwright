-- Billing is provider-agnostic (Dodo Payments today), plus bring-your-own-key.
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'dodo',
  ADD COLUMN IF NOT EXISTS "provider_customer_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_subscription_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_status" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_provider_subscription_id_key" ON "subscriptions"("provider_subscription_id");

ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "provider_product_id" TEXT;

ALTER TABLE "payment_events" RENAME COLUMN "stripe_event_id" TO "event_id";
ALTER INDEX IF EXISTS "payment_events_stripe_event_id_key" RENAME TO "payment_events_event_id_key";
ALTER TABLE "payment_events" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'dodo';

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "encrypted_key" TEXT NOT NULL,
  "last4" TEXT NOT NULL,
  "model" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_used_at" TIMESTAMPTZ(6),
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_user_id_provider_key" ON "api_keys"("user_id", "provider");

INSERT INTO "plans" ("id", "tier", "name", "monthly_price_usd", "included_tasks", "included_spend_usd", "limits")
VALUES
  (gen_random_uuid(), 'free', 'Free', 0, 10, 0, '{"requiresOwnKey": true, "concurrency": 1}'),
  (gen_random_uuid(), 'pro', 'Pro', 12, 100, 3, '{"requiresOwnKey": false, "concurrency": 2, "autoApprove": true}')
ON CONFLICT ("tier") DO NOTHING;
