// scrapers/instahyre/functions/fetchJobs.js

import {
  INSTAHYRE_BASE_URL,
  PAGE_DELAY_MS,
  PAGE_LIMIT,
  MAX_PAGES,
  LOCATIONS,
} from '../data/constants.js';

import { axiosInstance, delay, randomDelayMs } from '../../../utils/ScraperUtilityfunctions.js';
import { connectDB } from '../../../db/connection.js';
import instahyreLogger from '../instahyrelogger.js';
import Sentry from '../../../sentry.js';

import { preprocessQueue } from '../../../queue/queue.js';
import { RawJob } from '../../../db/rawJobmodel.js';


function isValidJobPage(html) {
  if (!html) return false;

  return html.includes('years') && html.includes('Instahyre') && html.length > 5000;
}
export async function fetchJobDetail(url) {
  try {
    await randomDelayMs(1500, 3500);
    const res = await axiosInstance.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });
    //console.log("HTML response:;",res.data)

    return res.data;
  } catch (err) {
    instahyreLogger.error('Error fetching job details: %s', err.message);

    // 🔥 Optional: retry on 429
    if (err.response?.status === 429) {
      instahyreLogger.warn('⏳ Rate limited on detail, retrying...');
      await delay(3000);
      return fetchJobDetail(url); // retry once
    }

    return null;
  }
}

function extractExperience(html) {
  if (!html) return null;

  let match = html.match(/(\d+)\s*-\s*(\d+)\s*(years|yrs)/i);
  if (match) {
    return { min: +match[1], max: +match[2] };
  }

  match = html.match(/(\d+)\+\s*(years|yrs)/i);
  if (match) {
    return { min: +match[1], max: null };
  }

  match = html.match(/(\d+)\s*(years|yrs)/i);
  if (match) {
    return { min: +match[1], max: +match[1] };
  }

  return null;
}

export async function fetchJobs() {
  await connectDB();

  let totalJobs = 0;
  let duplicateJobs = 0;
  let totalErrors = 0;

  for (const location of LOCATIONS) {
    instahyreLogger.info(`🌍 Scraping location: ${location}`);

    for (let page = 0; page < MAX_PAGES; page++) {
      let newJobsInPage = 0;
      const offset = page * PAGE_LIMIT;

      let response;

      try {
        response = await axiosInstance.get(INSTAHYRE_BASE_URL, {
          params: {
            jobLocations: location,
            offset,
            limit: PAGE_LIMIT,
          },
        });
      } catch (err) {
        Sentry.captureException(err);
        if (err.response?.status === 429) {
          instahyreLogger.warn('⏳ Rate limited, waiting...');
          await delay(3000); // 3 sec
          page--; // retry same page
          continue;
        }
        instahyreLogger.error(`❌ Request failed page ${page + 1}: ${err}`);
        totalErrors++;
        continue;
      }

      const jobs = response?.data?.objects || [];

      instahyreLogger.info(`➡️ ${location} Page ${page + 1}: ${jobs.length} jobs`);

      if (jobs.length === 0) {
        instahyreLogger.info(`🛑 No jobs → stopping ${location}`);
        break;
      }

      //-----------------------------------------
      // 💾 Process jobs
      //-----------------------------------------
      const externalIds = jobs.map((j) => j.id).filter(Boolean);

      const existingJobs = await RawJob.find(
        { externalId: { $in: externalIds } },
        { externalId: 1 }
      );

      const existingSet = new Set(existingJobs.map((j) => j.externalId));

      for (const job of jobs) {
        const externalId = job?.id;
        if (!externalId) continue;
        try {
          if (existingSet.has(externalId)) {
            duplicateJobs++;
            continue;
          }

          let html = await fetchJobDetail(job.public_url);
          if (!isValidJobPage(html)) {
            instahyreLogger.warn('⚠️ Invalid HTML, retrying...');
            await delay(2000);
            html = await fetchJobDetail(job.public_url);
          }
          let experience = extractExperience(html);

          if (!experience) {
            await delay(2000);
            html = await fetchJobDetail(job.public_url);
            experience = extractExperience(html);
          }

          if (!experience) {
            instahyreLogger.warn(`❌ Skipping job ${externalId} due to lack of experience info`);
            continue;
          }

          const doc = await RawJob.create({
            rawData: {
              ...job,

              // 🔥 ADD ENRICHED DATA HERE
              experience,
            },
            externalId,
            source: 'instahyre',
            status: 'queued',
            fetchedAt: new Date(),
          });
          newJobsInPage++;

          totalJobs++;
          instahyreLogger.info(`✅ New job saved: ${externalId}`);

          await preprocessQueue.add('raw-job', { id: doc._id });
        } catch (err) {
          if (err.code === 11000) {
            duplicateJobs++;

            continue;
          }

          totalErrors++;
          instahyreLogger.error(`❌ DB error: ${err.message}`);
        }
      }
      if (newJobsInPage === 0 && page > 5) {
        break;
      }
      await delay(PAGE_DELAY_MS);
    }
  }

  return { totalJobs, duplicateJobs, totalErrors };
}
