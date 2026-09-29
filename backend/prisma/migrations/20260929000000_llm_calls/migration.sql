-- One row per model call; source of truth for spend (Redis keeps the hot counters).
CREATE TABLE IF NOT EXISTS "llm_calls" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" TEXT NOT NULL,
  "user_id" UUID,
  "key_owner" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "input_tokens" INTEGER NOT NULL,
  "cached_input_tokens" INTEGER NOT NULL,
  "output_tokens" INTEGER NOT NULL,
  "cost_usd" DECIMAL(14,8) NOT NULL,
  "duration_ms" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "llm_calls_task_id_idx" ON "llm_calls"("task_id");
CREATE INDEX IF NOT EXISTS "llm_calls_key_owner_created_at_idx" ON "llm_calls"("key_owner", "created_at");
