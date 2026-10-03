-- Park/resume (P3): a task waiting for model quota or a key.
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'parked' AFTER 'needs_review';
