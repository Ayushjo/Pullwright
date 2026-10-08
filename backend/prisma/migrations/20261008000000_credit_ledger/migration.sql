-- Credits ledger (packs, Pro monthly grant, trial, per-task debits) and GitHub account age for the trial.
ALTER TABLE "users" ADD COLUMN "github_created_at" TIMESTAMPTZ(6);

CREATE TYPE "CreditKind" AS ENUM ('grant', 'purchase', 'trial', 'debit', 'refund', 'adjust');

CREATE TABLE "credit_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "CreditKind" NOT NULL,
    "amount_micros" BIGINT NOT NULL,
    "external_ref" TEXT,
    "task_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_ledger_external_ref_key" ON "credit_ledger"("external_ref");
CREATE UNIQUE INDEX "credit_ledger_task_id_key" ON "credit_ledger"("task_id");
CREATE INDEX "credit_ledger_user_id_created_at_idx" ON "credit_ledger"("user_id", "created_at");

ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
