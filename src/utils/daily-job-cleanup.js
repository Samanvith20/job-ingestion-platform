/**
 * daily-job-cleanup.cron.js
 *
 * Deletes:
 * 1. Raw jobs where status = "completed"
 * 2. Jobs where is_ingested = true AND is_published = true
 *
 * Run manually:
 *   node daily-job-cleanup.cron.js
 *
 * Recommended: Add to cron to run daily
 */

import { connectDB } from "../db/connection.js";
import { Job } from "../db/jobmodel.js";
import { RawJob } from "../db/rawJobmodel.js";
import logger from "../logger/logger.js";

export async function runCleanup() {
  try {
    logger.info("🔄 Starting daily job cleanup...");
    await connectDB();

    // 1️⃣ Delete completed raw jobs
    const rawDeleteResult = await RawJob.deleteMany({
      status: "completed",
    });

    logger.info(`🗑 Deleted ${rawDeleteResult.deletedCount} completed raw jobs`);

    // 2️⃣ Delete fully processed jobs
    const jobDeleteResult = await Job.deleteMany({
      is_ingested: true,
    });

    logger.info(`🗑 Deleted ${jobDeleteResult.deletedCount} processed jobs`);

    logger.info("✅ Daily cleanup completed successfully");
    
    process.exit(0);
  } catch (error) {
    logger.error("❌ Daily cleanup failed:", error);
    process.exit(1);
  }
}


//runCleanup()