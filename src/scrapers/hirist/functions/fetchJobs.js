import { LOCATIONS } from '../data/locations.js';
import { BASE_URL, PAGE_DELAY_MS, PAGE_SIZE } from '../data/constants.js';
import { axiosInstance, delay } from '../../../utils/ScraperUtilityfunctions.js';

import { RawJob } from '../../../db/rawJobmodel.js';
import hiristLogger from '../hiristlogger.js';
import { connectDB } from '../../../db/connection.js';


import Sentry from '../../../sentry.js';


import { preprocessQueue } from '../../../queue/queue.js';

/**
 * Extracts job description and employment type from an HTML page that includes JSON-LD JobPosting data.
 * @param {string} html - HTML source of the job detail page.
 * @returns {{description: string, job_type: string}} An object with `description` (job description text) and `job_type` (employmentType); both are empty strings if no JobPosting data is found.
 */


/**
 * Fetches all job listings matching the given search keyword from Hirist, enriches each with extracted description and employment type, stores them as queued RawJobs, and enqueues preprocessing tasks.
 * @param {string} keyword - Search term used to query Hirist job listings.
 * @returns {Array<Object>} An array of raw job objects retrieved and augmented with `description` and `job_type`.
 */

export async function fetchAllJobs(keyword) {
  await connectDB();

  let page = 0;
  let hasMore = true;

  const metrics = {
    insertedJobs: 0,
    duplicateJobs: 0,
    totalErrors: 0,
  };

  const locParam = LOCATIONS.join(',');
  const MAX_RETRIES = 3;

  while (hasMore) {
    const url = `${BASE_URL}?query=${encodeURIComponent(keyword)}&page=${page}&loc=${locParam}&size=${PAGE_SIZE}&posting=1`;

    let res, json, jobs;

    // 🔄 Retry logic
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        res = await axiosInstance.get(url, {
          validateStatus: () => true,
        });
       
      
        json = res.data;
        hiristLogger.info(`Fetched page ${page} for "${keyword}" (status: ${res.status})`);
        jobs = json?.jobs || json?.data || json?.results || [];
        hiristLogger.debug("Jobs length: %d", jobs.length);
        break;
      } catch (err) {
        hiristLogger.error(
          `❌ API failed (attempt ${attempt}) keyword "${keyword}" page ${page}: ${err.message}`
        );

        if (attempt < MAX_RETRIES) {
          await delay(PAGE_DELAY_MS);
        } else {
          Sentry.captureException(err);
          metrics.totalErrors++;
        }
      }
    }

    if (!res) {
      page++;
      continue;
    }

    if (!jobs || jobs.length === 0) break;

    //-----------------------------------------
    // 🔥 BATCH DUPLICATE CHECK (IMPORTANT)
    //-----------------------------------------
    const externalIds = jobs.map(j => j.id).filter(Boolean);

    const existingJobs = await RawJob.find(
      { externalId: { $in: externalIds } },
      { externalId: 1 }
    );

    const existingSet = new Set(existingJobs.map(j => j.externalId));

    let newJobsInPage = 0;

    //-----------------------------------------
    // 💾 Process jobs
    //-----------------------------------------
    for (const jobItem of jobs) {
      try {
        const externalId = jobItem?.id;
        if (!externalId) continue;

        // ✅ Skip duplicates EARLY
        if (existingSet.has(externalId)) {
          metrics.duplicateJobs++;
          continue;
        }

        const doc = await RawJob.create({
          rawData: jobItem,
          source: 'hirist',
          externalId,
          status: 'queued',
          fetchedAt: new Date(),
        });

        metrics.insertedJobs++;
        newJobsInPage++;

        await preprocessQueue.add('raw-job', { id: doc._id });

        // ✅ Small delay (avoid rate limit)
        await delay(200);

      } catch (err) {
        if (err.code === 11000) {
          metrics.duplicateJobs++;
          continue;
        }

        metrics.totalErrors++;
        hiristLogger.error(`❌ Failed job ${jobItem.id}: ${err.message}`);
      }
    }

    //-----------------------------------------
    // 🧠 SMART STOPPING
    //-----------------------------------------
    if (newJobsInPage === 0 && page > 5) {
      hiristLogger.info(`🛑 No new jobs after page ${page}, stopping`);
      break;
    }

    hasMore = json?.hasMore ?? false;
    page++;

    await delay(PAGE_DELAY_MS);
  }

  //-----------------------------------------
  // 📊 FINAL LOG
  //-----------------------------------------
  hiristLogger.info(
    `✔ Keyword "${keyword}" completed — Inserted: ${metrics.insertedJobs}, Duplicates: ${metrics.duplicateJobs}, Errors: ${metrics.totalErrors}`
  );

  return metrics;
}