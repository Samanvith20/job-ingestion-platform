import { Worker } from 'bullmq';
import { connection } from '../../../queue/connection.js';

import { connectDB } from '../../../db/connection.js';
import naukriLogger from '../naukrilogger.js';
import { axiosInstance, delay, randomDelayMs } from '../../../utils/ScraperUtilityfunctions.js';

import { NAUKRI_WORKER, PAGE_DELAY_MS } from '../data/constants.js';

import { setScraperContext } from '../../../utils/sentryContext.js';
import Sentry from '../../../sentry.js';

import { locationDoneQueue, naukriQueue, preprocessQueue } from '../../../queue/queue.js';
import { RawJob } from '../../../db/rawJobmodel.js';

/** 
 * Initialize the database connection, fetch initial Naukri homepage cookies, and start the BullMQ worker that processes Naukri HTTP fetch jobs.
 *
 * The worker performs HTTP requests for configured pages, maintains per-location daily metrics, handles 403 and CAPTCHA retry/backoff logic, parses job listings from responses, persists raw job records, enqueues preprocessing tasks, and advances pagination up to the provided limit while logging API request details.
 */
export async function naukriWorker() {
  setScraperContext(NAUKRI_WORKER);
  await connectDB();
  naukriLogger.info('Connected to MongoDB & worker started 🚀');

  let naukriCookies = '';

  async function fetchHomepageCookies() {
    try {
      const homeResponse = await axiosInstance.get('https://www.naukri.com/', {
        validateStatus: () => true,
      });
      const cookies = homeResponse.headers['set-cookie'] || [];
      if (cookies.length > 0) {
        naukriCookies = cookies.join('; ');
        naukriLogger.info(`✅ Fetched Naukri homepage cookies: ${cookies.length} cookies set`);
      } else {
        naukriLogger.warn('⚠️ No cookies returned from Naukri homepage');
      }
    } catch (err) {
      Sentry.captureException(err);
      naukriLogger.error('⚠️ Failed to fetch Naukri homepage cookies:', err.message);
    }
  }

  function getTodayKey(location) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${location}-${today}`;
  }

  await fetchHomepageCookies();
  const metricsByLocation = new Map();

  function getMetrics(location) {
    const key = getTodayKey(location);

    if (!metricsByLocation.has(key)) {
      metricsByLocation.set(key, {
        date: key.split('-').slice(-3).join('-'), // 2025-12-06
        location,
        totalRequests: 0,
        failedRequests: 0,
        insertedJobs: 0,
        duplicateJobs: 0,
      });
    }

    return metricsByLocation.get(key);
  }

  let lastCookieRefresh = Date.now();

  new Worker(
    'naukri-http-requests',
    async (job) => {
      const {
        url,
        headers,
        location,
        page,
        paginationLimit,
        _403Retries = 0,
        captchaRetries = 0,
      } = job.data;

      const metrics = getMetrics(location);
      metrics.totalRequests++;
  
      try {
        naukriLogger.info(`➡️ Calling Page ${page} for ${location}`);
        naukriLogger.info(`➡️ URL: ${url}`);

        const rDelay = randomDelayMs(1500, 3000);
        await delay(Math.max(PAGE_DELAY_MS || 0, rDelay));

        if (Date.now() - lastCookieRefresh > 6 * 60 * 1000) {
          await fetchHomepageCookies();
          lastCookieRefresh = Date.now();
        }

        const response = await axiosInstance.get(url, {
          headers: {
            ...headers,
            ...(naukriCookies && { Cookie: naukriCookies }),
          },
          validateStatus: () => true,
        });

        naukriLogger.info(`⚡ Status: ${response.status}`);

        // =============== ❌ HANDLE 403 BEFORE JSON PARSE ============
        if (response.status === 403) {
          metrics.failedRequests++;

          // refresh cookies once after first 2 retries to attempt session recovery
          if (_403Retries === 2) {
            naukriLogger.info('🔁 Refreshing homepage cookies due to repeated 403s');
            await fetchHomepageCookies();
          }

          if (_403Retries < 4) {
            naukriLogger.info(`⛔ 403 on page ${page} — retry ${_403Retries + 1}/4`);

            // exponential backoff before re-adding the same page
            const backoffMs = 1000 * Math.pow(2, _403Retries); // 1s,2s,4s,8s
            await delay(backoffMs + randomDelayMs(500, 1500));

            await naukriQueue.add('fetch', {
              url,
              headers,
              location,
              page,
              paginationLimit,
              _403Retries: _403Retries + 1,
            });

            return;
          }

          // MAX RETRIES REACHED → move to next page
          naukriLogger.info(`⏭️ 403 retries exhausted for page ${page}. Moving to page ${page + 1}`);

          const nextPage = page + 1;

          if (nextPage <= paginationLimit) {
            const nextUrl = url.replace(`pageNo=${page}`, `pageNo=${nextPage}`);

            await naukriQueue.add('fetch', {
              url: nextUrl,
              headers,
              location,
              page: nextPage,
              paginationLimit,
            });

            naukriLogger.info(`➡️ Queued next page ${nextPage}`);
          } else {
            naukriLogger.info(`📊 ${location} metrics: ${JSON.stringify(metrics)}`);
           await locationDoneQueue.add('done', { location });
            return
          }

          return; // DO NOT THROW
        }

        const data = response.data;
        if (typeof data === 'string') {
          if (data.includes('captcha') || data.includes('cf-challenge')) {
            if (captchaRetries < 4) {
              await delay(2000);
              return naukriQueue.add('fetch', { ...job.data, captchaRetries: captchaRetries + 1 });
            }

            naukriLogger.warn(`❌ CAPTCHA retries exceeded for page ${page}`);

            const nextPage = page + 1;
            if (nextPage <= paginationLimit) {
              const nextUrl = url.replace(`pageNo=${page}`, `pageNo=${nextPage}`);
              await naukriQueue.add('fetch', {
                url: nextUrl,
                headers,
                location,
                page: nextPage,
                paginationLimit,
              });
            }

            return;
          }

          naukriLogger.error(`❌ Expected JSON but got string. Skipping page ${page}`);
          return;
        }

        // ✅ THIS IS THE REAL JSON
        const jobs = data.jobDetails || [];

       

        if (jobs.length === 0) {
          naukriLogger.warn(`⚠️ No jobs in response for page ${page}`);
          naukriLogger.info(`📊 ${location} metrics: ${JSON.stringify(metrics)}`);
 await locationDoneQueue.add('done', { location });
  
          return;
        }
        //console.log(`✅ Fetched ${jobs.length} jobs from page ${page} for ${location}`);

        for (const jobItem of jobs) {
          try {
            const doc = await RawJob.create({
              rawData: jobItem,
              source: 'naukri',
              externalId: jobItem.jobId,
              status: 'queued',
            });

            metrics.insertedJobs++;
            await preprocessQueue.add('raw-job', { id: doc._id });
          } catch (err) {
            if (err.code === 11000) {
              metrics.duplicateJobs++;
              continue; // ✅ skip duplicate, keep looping
            }

            Sentry.captureException(err);
            naukriLogger.error(`❌ Failed to insert job from page ${page}:`, err.message);
            continue; // ✅ never return
          }
        }

        // NEXT PAGE
        const nextPage = page + 1;

        if (nextPage <= paginationLimit) {
          const nextUrl = url.replace(`pageNo=${page}`, `pageNo=${nextPage}`);

          await naukriQueue.add('fetch', {
            url: nextUrl,
            headers,
            location,
            page: nextPage,
            paginationLimit,
          });

          naukriLogger.info(`➡️ Queued next page ${nextPage}`);
        } else {
          naukriLogger.info(`📊 ${location} metrics: ${JSON.stringify(metrics)}`);
          await locationDoneQueue.add('done', { location });
          return;
        }
      } catch (err) {
        metrics.failedRequests++;
        Sentry.captureException(err);

        throw err; // BullMQ normal retry for non-403
      }
    },
    {
      connection,
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 2000,
      },
    }
  );
}

naukriWorker().catch((err) => {
  console.error('❌ Failed to start naukri worker:', err);
  process.exit(1);
});
