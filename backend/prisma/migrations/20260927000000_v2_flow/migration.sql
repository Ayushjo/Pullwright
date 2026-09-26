-- Pullwright v2: Jules-style task lifecycle
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'preparing';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'awaiting_approval';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'needs_input';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'validating';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'ready';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'needs_review';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'publishing';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'published';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "plan" JSONB,
  ADD COLUMN IF NOT EXISTS "summary" TEXT,
  ADD COLUMN IF NOT EXISTS "verdict" JSONB,
  ADD COLUMN IF NOT EXISTS "diff_stats" JSONB,
  ADD COLUMN IF NOT EXISTS "options" JSONB,
  ADD COLUMN IF NOT EXISTS "cost_usd" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "is_public" BOOLEAN NOT NULL DEFAULT false;
