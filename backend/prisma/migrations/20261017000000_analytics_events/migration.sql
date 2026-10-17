-- AlterTable
ALTER TABLE "users" ADD COLUMN     "first_touch" JSONB,
ADD COLUMN     "last_seen_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" BIGSERIAL NOT NULL,
    "ts" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "user_id" UUID,
    "anon_id" UUID,
    "session_id" TEXT,
    "path" TEXT,
    "referrer" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "country" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "props" JSONB,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_events_ts_idx" ON "analytics_events"("ts");

-- CreateIndex
CREATE INDEX "analytics_events_name_ts_idx" ON "analytics_events"("name", "ts");

-- CreateIndex
CREATE INDEX "analytics_events_user_id_ts_idx" ON "analytics_events"("user_id", "ts");

-- CreateIndex
CREATE INDEX "analytics_events_anon_id_ts_idx" ON "analytics_events"("anon_id", "ts");

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

