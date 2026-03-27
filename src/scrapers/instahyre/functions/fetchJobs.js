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



export async function fetchJobDetail(url) {
  try {
    randomDelayMs(1500, 3500);
    const res = await axiosInstance.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });
    //console.log("HTML response:;",res.data)

    return res.data;
  } catch (err) {

         console.error("err ", err.message);

    // 🔥 Optional: retry on 429
    if (err.response?.status === 429) {
      console.log("⏳ Rate limited on detail, retrying...");
      await delay(3000);
      return fetchJobDetail(url); // retry once
    }

    return null;

  }
}
function extractExperience(html) {
  
  if (!html) return null;
 

  const metaMatch = html.match(/(\d+)\s*-\s*(\d+)\s*years/i);
 // console.log("metamatch in experience ::",metaMatch)

  if (!metaMatch) return null;

  return {
    min: parseInt(metaMatch[1]),
    max: parseInt(metaMatch[2]),
  };
}

export async function fetchJobs() {
  await connectDB();

  const totalJobs = 0;
  let duplicateJobs = 0;
  let totalErrors = 0;

  const DUPLICATE_STREAK_LIMIT = 40;

  for (const location of LOCATIONS) {
    instahyreLogger.info(`🌍 Scraping location: ${location}`);

    let consecutiveDuplicates = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
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
      
      for (const job of jobs) {
  try {
    const externalId = job?.id;
    if (!externalId) continue;

    // 🔥 Fetch detail (ONLY for top pages)
    let experience = null;

  


      const html = await fetchJobDetail(job.public_url);
       
      experience = extractExperience(html);
      
   
    

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

    await preprocessQueue.add('raw-job', { id: doc._id });

  } catch (err) {
 if (err.code === 11000) {
            duplicateJobs++;
            consecutiveDuplicates++;

            // 🔥 MAIN STOP LOGIC
            if (consecutiveDuplicates >= DUPLICATE_STREAK_LIMIT) {
              instahyreLogger.info(
                `🛑 Duplicate streak hit → stopping ${location} at page ${page + 1}`
              );
              break;
            }

            continue;
          }

          totalErrors++;
          instahyreLogger.error(`❌ DB error: ${err.message}`);
  }
}

      // 🔥 break outer loop if duplicates triggered
      if (consecutiveDuplicates >= DUPLICATE_STREAK_LIMIT) break;

      await delay(PAGE_DELAY_MS);
    }
  }

  return { totalJobs, duplicateJobs, totalErrors };
}
