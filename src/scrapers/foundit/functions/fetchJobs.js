import {
  FOUND_IT_BASE_URL,
  MAX_PAGE_NUMBER,
  PAGE_DELAY_MS,
  PAGE_LIMIT,
} from '../data/constants.js';
import { axiosInstance, delay } from '../../../utils/ScraperUtilityfunctions.js';

import { connectDB } from '../../../db/connection.js';
import founditlogger from '../founditlogger.js';
import Sentry from '../../../sentry.js';

import { preprocessQueue } from '../../../queue/queue.js';
import { RawJob } from '../../../db/rawJobmodel.js';

/**
 * Fetches paginated jobs from the FoundIt API, saves each job as a RawJobs document, and enqueues it for preprocessing.
 *
 * Fetching stops early when a page returns zero jobs. Pages that fail after multiple retries are skipped without stopping the overall run.
 *
 * @returns {{ totalJobs: number, duplicateJobs: number, totalErrors: number }} An object with counts: `totalJobs` is the number of newly queued jobs, `duplicateJobs` is the number of insertions skipped due to duplicate keys, and `totalErrors` is the number of request or database errors encountered.
 */
export async function fetchJobs() {
  await connectDB();

  let totalJobs = 0;
  let duplicateJobs = 0;
  let totalErrors = 0;

  const MAX_RETRIES = 3;

  for (let page = 0; page < MAX_PAGE_NUMBER; page++) {
    const start = page * PAGE_LIMIT;
    let response = null;
  

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await axiosInstance.get(FOUND_IT_BASE_URL, {
          params: {
            start,
            limit: PAGE_LIMIT,
            jobFreshness: 1,
          },
          validateStatus: () => true,
        });
        const statusCode = response.status;
        // Treat non-2xx (and specific throttling codes) as retryable errors
        if (statusCode < 200 || statusCode >= 300) {
          founditlogger.warn(
            `⚠️ HTTP ${statusCode} on page ${page + 1} (attempt ${attempt}/${MAX_RETRIES})`
          );
          totalErrors++;
          if (attempt < MAX_RETRIES) {
            await delay(1500);
            continue; // next retry
          }
          // Max retries reached,
          response = null;
          break;
        }
        break; // SUCCESS → leave retry loop
      } catch (err) {
        Sentry.captureException(err);
        founditlogger.error(
          `❌ Request error on page ${page + 1} (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`
        );
        totalErrors++;
        // Retry only if more attempts left
        if (attempt < MAX_RETRIES) {
          await delay(PAGE_DELAY_MS);
        }
      }
    }


    //------------------------------------------------
    // ❗ If all retries failed → skip page, continue
    //------------------------------------------------
    if (!response) {
      founditlogger.error(
        `🚨 Page ${page + 1} failed after ${MAX_RETRIES} attempts → Skipping this page`
      );
      continue; // NEVER STOP SCRAPER
    }

    //-----------------------------------------
    // 🟢 Process page (ONLY if response exists)
    //-----------------------------------------
    let jobs;
    try {
      const json = response.data;
      jobs = json?.data || [];
    } catch (err) {
      Sentry.captureException(err);
      founditlogger.warn(`❌ JSON parse failed on page ${page + 1}, skipping page.`);
      continue;
    }

    founditlogger.info(`➡️ Page ${page + 1}: Found ${jobs.length} jobs`);

    if (jobs.length === 0) {
      founditlogger.info('🛑 No more jobs returned → Stopping pagination.');
      break;
    }

    //-----------------------------------------
    // 💾 Save each job individually
    //-----------------------------------------
    for (const job of jobs) {
      try {
        const externalId = job?.jobId || job?.jobID;
        if (!externalId) {
          founditlogger.warn('⚠️ Job missing externalId → Skipping');
          continue;
        }
        const doc = await RawJob.create({
          rawData: job,
          externalId: externalId,
          source: 'foundit',
          status: 'queued',
        });

        await preprocessQueue.add('raw-job', { id: doc._id });

        totalJobs++;
      } catch (err) {
        Sentry.captureException(err);
        if (err.code === 11000) {
          duplicateJobs++;
          // founditlogger.warn('⚠️ Duplicate job → Skipping');
        } else {
          totalErrors++;
          founditlogger.error(`❌ DB Insert Error: ${err.message}`);
        }
      }
    }

    await delay(PAGE_DELAY_MS);
  }

  //----------------------------------------------------
  // 🟢 Final result returned to cron or main handler
  //----------------------------------------------------
  return { totalJobs, duplicateJobs, totalErrors };
}
