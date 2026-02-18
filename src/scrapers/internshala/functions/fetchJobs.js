import axios from 'axios';
import internshalalogger from '../internshalalogger.js';
import redis from '../../../config/redis.js';
import { connectDB } from '../../../db/connection.js';
import { preprocessQueue } from '../../../queue/queue.js';
import { parsePostedDate } from '../../../utils/ScraperUtilityfunctions.js';
import { RawJob } from '../../../db/rawJobmodel.js';


export async function fetchJobs({ url, source, redisKey }) {
  await connectDB();

  // Use redis.get to fetch last scraped date
  const lastScrapedAtRaw = await redis.get(redisKey);
  const lastScrapedAt = lastScrapedAtRaw ? new Date(lastScrapedAtRaw) : new Date('2000-01-01');

  internshalalogger.info(`📌 [${source}] Last scraped at: ${lastScrapedAt.toISOString()}`);

  try {
   
    const response = await axios.get(url, {
      responseType: 'json',
      headers: { Accept: 'application/json' },
    });

    const jobsList = response.data?.common || [];
    

    const dateFiltered = jobsList
      .filter((job) => job.date && parsePostedDate(job.date) >= lastScrapedAt)
      .sort((a, b) => parsePostedDate(a.date) - parsePostedDate(b.date));

    if (!dateFiltered.length) {
      internshalalogger.info(`[${source}] ℹ️ No new jobs`);
      return 0;
    }

    let maxProcessedDate = lastScrapedAt;

    for (const rawJob of dateFiltered) {
      try {
          const externalId = rawJob.id;
          if (!externalId) {
            internshalalogger.warn('⚠️ Missing externalId → Skipping');
            continue;
          }
          // Determine source based on type
          
          const doc = await RawJob.create({
            rawData: rawJob,
            externalId: externalId,
            source: source,
            status: 'queued',
          });
          await preprocessQueue.add('raw-job', { id: doc._id });
          // Track newest job date
          const jobDate = parsePostedDate(rawJob.date);
          if (jobDate > maxProcessedDate) {
            maxProcessedDate = jobDate;
          }
        } catch (error) {
          if (error.code === 11000) {
            internshalalogger.warn(`⚠️ Duplicate job with externalId ${rawJob.id} → Skipping`);
          } else {
            internshalalogger.error(`❌ Failed to process job ${rawJob.id}: ${error.message}`);
          }
        }
    }

    // Use redis.set to update last scraped date
    await redis.set(redisKey, maxProcessedDate.toISOString());

    internshalalogger.info(
      `🎉 [${source}] Queued ${dateFiltered.length} jobs | Last date → ${maxProcessedDate.toISOString()}`
    );

    return dateFiltered.length;
  } catch (err) {
    internshalalogger.error(`[${source}] ❌ Failed: ${err.message}`);
    throw err;
  }
}
