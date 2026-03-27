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
  const allJobs = [];
  let hasMore = true;

  const metrics = {
    insertedJobs: 0,
    duplicateJobs: 0,
  };

  const locParam = LOCATIONS.join(',');
  const MAX_RETRIES = 3;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

  while (hasMore) {
    const url = `${BASE_URL}?query=${encodeURIComponent(keyword)}&page=${page}&loc=${locParam}&size=${PAGE_SIZE}&posting=1`;

    let res;
    let json;
    let jobs;
       


    // 🔄 Retry mechanism: try API 3 times if fails
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        res = await axiosInstance.get(url, {
  validateStatus: () => true,
});

 json = res.data;
 jobs = json?.data || [];
        break; // success → exit retry loop
      } catch (err) {
        
      
        hiristLogger.error(
          `❌ API failed (attempt ${attempt}/3) for keyword "${keyword}", page ${page}: ${err.message}`
        );
        if (attempt < MAX_RETRIES) {
          await delay(PAGE_DELAY_MS);
        } else {
          Sentry.captureException(err);
          hiristLogger.error(
            `🚨 API permanently failed after ${MAX_RETRIES} retries. Skipping page ${page}.`
          );

          break;
        }

      }
      
    }
    

    // Skip processing if all retries failed
    if (!res) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        hiristLogger.error('🚨 Too many consecutive failures — stopping scraper');
        break;
      }
      page++;
      continue;
    } else {
      consecutiveFailures = 0;
    }

    


    // console.log("json data:",json);


    // Store jobs
    for (const jobItem of jobs) {
      try {
        
        

        const doc = await RawJob.create({
          rawData: jobItem,
          source: 'hirist',
          externalId: jobItem.id,
          status: 'queued',
        });

        metrics.insertedJobs++;
        await preprocessQueue.add('raw-job', { id: doc._id });
      } catch (err) {
        if (err.code === 11000) {
         // Sentry.captureException(err)
          hiristLogger.error(`❌ Duplicate job ${jobItem.id}`);
          metrics.duplicateJobs++;
        } else {
          hiristLogger.error(`❌ Failed to insert job ${jobItem.id}: ${err.message}`);
        }
      }
    }

    if (jobs.length === 0) {
      break;
    }

    allJobs.push(...jobs);

  hasMore = json?.hasMore ?? false;
    page++;
  }

  // FINAL SUMMARY LOG
  hiristLogger.info(
    `✔ Keyword "${keyword}" completed — Inserted: ${metrics.insertedJobs}, Duplicates: ${metrics.duplicateJobs}`
  );

  return allJobs;
}