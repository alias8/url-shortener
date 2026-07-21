/*
  Hand-written (Prisma's auto-generated SQL can't express table partitioning, so this replaces it):

  - Url.id switches from a random uuid to a bigserial identity. The short_url code is now derived
    from this id (see src/utils/shortCode.ts) instead of an md5 hash slice, which is what actually
    lets this system address 1B+ distinct urls without collisions.
  - Click is recreated as a table partitioned by RANGE (time_stamp) so the fastest-growing table
    (one row per redirect) doesn't become a single unbounded index — old months can be detached
    and archived/dropped instead of deleted row-by-row. A DEFAULT partition guarantees inserts
    never fail even if a given month's partition hasn't been created yet.
  - No production data exists yet for this project, so tables are dropped and recreated rather
    than migrated in place (a uuid text column can't be meaningfully cast to bigint anyway).
*/

-- DropForeignKey
ALTER TABLE "Click" DROP CONSTRAINT "Click_url_id_fkey";

-- Click must be recreated (not ALTERed) to become partitioned
DROP TABLE "Click";

-- AlterTable: Url.id uuid -> bigserial identity
ALTER TABLE "Url" DROP CONSTRAINT "Url_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" BIGSERIAL NOT NULL,
ADD CONSTRAINT "Url_pkey" PRIMARY KEY ("id");

-- CreateTable: Click, partitioned by time_stamp
CREATE TABLE "Click" (
    "id"         BIGSERIAL NOT NULL,
    "url_id"     BIGINT NOT NULL,
    "time_stamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "referrer"   TEXT NOT NULL,

    CONSTRAINT "Click_pkey" PRIMARY KEY ("id", "time_stamp")
) PARTITION BY RANGE ("time_stamp");

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_url_id_fkey" FOREIGN KEY ("url_id") REFERENCES "Url"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Catch-all partition: guarantees inserts never fail even if a specific month's partition
-- hasn't been created yet (e.g. the monthly partition-creation job missed a run).
CREATE TABLE "Click_default" PARTITION OF "Click" DEFAULT;

-- Creates one monthly partition, e.g. create_click_partition_for_month('2026-08-01') creates
-- "Click_2026_08" covering [2026-08-01, 2026-09-01). Intended to be called from a scheduled job
-- (cron/pg_cron) a few days ahead of each month so writes land in a dedicated partition instead
-- of falling through to Click_default. Idempotent — safe to call again for a month that already
-- has a partition.
CREATE OR REPLACE FUNCTION create_click_partition_for_month(month_start date)
RETURNS void AS $$
DECLARE
  partition_name text := 'Click_' || to_char(month_start, 'YYYY_MM');
  month_end date := month_start + interval '1 month';
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF "Click" FOR VALUES FROM (%L) TO (%L)',
    partition_name, month_start, month_end
  );
END;
$$ LANGUAGE plpgsql;

-- Pre-create partitions for the current and next month so a fresh install has real partitions
-- from day one instead of relying solely on Click_default.
SELECT create_click_partition_for_month(date_trunc('month', CURRENT_DATE)::date);
SELECT create_click_partition_for_month((date_trunc('month', CURRENT_DATE) + interval '1 month')::date);
