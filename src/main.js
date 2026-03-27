

import cron from "node-cron";
import { founditScraper } from "./scrapers/foundit/index.js";
//import { internshalajobsScraper } from "./scrapers/internshala/index.js";
import { naukriScraper } from "./scrapers/naukri/index.js";
import { runIngestion } from "./utils/neo4jingest.js";
import { runPostProcessing } from "./utils/postprocessing.js";
import { syncMongoJobsToPostgres } from "./utils/postgressingest.js";
import logger from "./logger/logger.js";
import redis from "./config/redis.js";
import crypto from "crypto";
import { instahyreScraper } from "./scrapers/instahyre/index.js";
import { startHiristScraper } from "./scrapers/hirist/index.js";

async function acquireLock(key, ttl = 60 * 60) {
  const value = crypto.randomUUID();

  const result = await redis.set(key, value, "NX", "EX", ttl);

  return result === "OK" ? value : null;
}

async function releaseLock(key, value) {
  const current = await redis.get(key);

  if (current === value) {
    await redis.del(key);
  }
}

// scraperConfig.js

 const SCRAPER_CONFIG = {
  MORNING: ["foundit", "naukri"],
  AFTERNOON: ["foundit", "naukri"],
  NIGHT: ["foundit", "naukri", "instahyre" ,"hirist"], // 👈 only here
};

export const SCRAPERS = {
  foundit: founditScraper,
  naukri: naukriScraper,
  instahyre: instahyreScraper,
  hirist:startHiristScraper
};

// ── Single pipeline: scrape → ingest → sync → post-process ───────────────────
// All steps run sequentially so each depends on the previous completing.
// Errors in one step are logged but don't crash the process —
// the next cron cycle will retry everything from scratch.
async function runPipeline(cycleLabel) {
  const lockKey = `lock:${cycleLabel}`;
  const lockValue = await acquireLock(lockKey, 7200);

if (!lockValue) {
  logger.warn(`⚠️ Skipping ${cycleLabel} — another instance running`);
  return;
}


  logger.info(`\n${"=".repeat(60)}`);
  logger.info(`🚀 [${cycleLabel}] Pipeline starting...`);
  logger.info(`   Time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
  logger.info("=".repeat(60));

  // ── Step 1: Scrape ──────────────────────────────────────────────────────
  try {
    const scrapersToRun = SCRAPER_CONFIG[cycleLabel] || [];

logger.info(`Running scrapers: ${scrapersToRun.join(", ")}`);

await Promise.all(
  scrapersToRun.map((name) => SCRAPERS[name]())
);
    logger.info(`✅ [${cycleLabel}] Scraping done`);
  } catch (err) {
    logger.error(`❌ [${cycleLabel}] Scraping failed: ${err.message}`);
    // Don't return — ingestion can still process previously uningested jobs
  }

  // ── Step 2: Neo4j ingestion ─────────────────────────────────────────────
  try {
    logger.info(`\n[${cycleLabel}] Step 2/4 — Neo4j ingestion...`);
    await runIngestion();
    logger.info(`✅ [${cycleLabel}] Neo4j ingestion done`);
  } catch (err) {
    logger.error(`❌ [${cycleLabel}] Neo4j ingestion failed: ${err.message}`);
    return; // Post-processing on stale data is pointless, skip rest
  }

  // ── Step 3: Postgres sync ───────────────────────────────────────────────
  try {
    logger.info(`\n[${cycleLabel}] Step 3/4 — Postgres sync...`);
    await syncMongoJobsToPostgres();
    logger.info(`✅ [${cycleLabel}] Postgres sync done`);
  } catch (err) {
    logger.error(`❌ [${cycleLabel}] Postgres sync failed: ${err.message}`);
    // Non-fatal — continue to post-processing
  }

  // ── Step 4: Post-processing ─────────────────────────────────────────────
  try {
    logger.info(`\n[${cycleLabel}] Step 4/4 — Post-processing...`);
    await runPostProcessing();
    logger.info(`✅ [${cycleLabel}] Post-processing done`);
  } catch (err) {
    logger.error(`❌ [${cycleLabel}] Post-processing failed: ${err.message}`);
  }
  finally {
     await releaseLock(lockKey, lockValue);
  }


  logger.info(`\n✅ [${cycleLabel}] Full pipeline completed`);
  logger.info(`   Time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\n`);
}

// ── Schedule: 3x daily ────────────────────────────────────────────────────────
// 06:00 IST — morning cycle      (fresh jobs for the day)
// 13:00 IST — afternoon cycle    (midday postings)
// 21:00 IST — night cycle        (end of day postings + cleanup)
const CRON_OPTIONS = { timezone: "Asia/Kolkata" };

cron.schedule("0 6  * * *", async() => await runPipeline("MORNING"),   CRON_OPTIONS);
cron.schedule("0 13 * * *", async() => await runPipeline("AFTERNOON"), CRON_OPTIONS);
cron.schedule("0 19 * * *", async() => await runPipeline("NIGHT"),     CRON_OPTIONS);

logger.info("✅ Cron scheduler started — pipelines at 06:00, 13:00, 21:00 IST");

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on("SIGTERM", () => {
  logger.info("SIGTERM received — shutting down scheduler");
  process.exit(0);
});
process.on("SIGINT", () => {
  logger.info("SIGINT received — shutting down scheduler");
  process.exit(0);
});
