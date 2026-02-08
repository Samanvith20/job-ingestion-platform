import { Worker } from 'bullmq';
import { connection } from '../../../queue/connection.js';

import { RawJobs } from '../../../db/rawJobModel.js';
import { ApiRequestLog } from '../../../db/apiRequestLogModel.js';
import { connectDB } from '../../../db/connection.js';
import naukriLogger from '../naukrilogger.js';
import { axiosInstance, delay, randomDelayMs } from '../../../utils/ScraperUtilitiyfuctions.js';

import { NAUKRI_WORKER, PAGE_DELAY_MS } from '../data/constants.js';
import logger from '../../../logger/logger.js';
import { setScraperContext } from '../../../utils/sentryContext.js';
import Sentry from '../../../sentry.js';

import { naukriQueue, preprocessQueue } from '../../../queue/queue.js';

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

      const start = Date.now();

      try {
        logger.info(`➡️ Calling Page ${page} for ${location}`);
        logger.info(`➡️ URL: ${url}`);

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
          responseType: 'arraybuffer',
          validateStatus: () => true,
        });

        logger.info(`⚡ Status: ${response.status}`);

        await ApiRequestLog.create({
          url,
          location,
          method: 'GET',
          statusCode: response.status,
          bytesReceived: response.data?.byteLength || 0,
          durationMs: Date.now() - start,
          timestamp: new Date(),
        });

        // =============== ❌ HANDLE 403 BEFORE JSON PARSE ============
        if (response.status === 403) {
          metrics.failedRequests++;

          // refresh cookies once after first 2 retries to attempt session recovery
          if (_403Retries === 2) {
            logger.info('🔁 Refreshing homepage cookies due to repeated 403s');
            await fetchHomepageCookies();
          }

          if (_403Retries < 4) {
            logger.info(`⛔ 403 on page ${page} — retry ${_403Retries + 1}/4`);

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
          logger.info(`⏭️ 403 retries exhausted for page ${page}. Moving to page ${page + 1}`);

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

            logger.info(`➡️ Queued next page ${nextPage}`);
          } else {
            naukriLogger.info(`📊 ${location} metrics: ${JSON.stringify(metrics)}`);
          }

          return; // DO NOT THROW
        }

        const text = Buffer.from(response.data).toString();

        if (text.includes('captcha') || text.includes('cf-challenge')) {
          if (captchaRetries < 4) {
            await delay(2000);
            return naukriQueue.add('fetch', { ...job.data, captchaRetries: captchaRetries + 1 });
          } else {
            logger.warn(`❌ CAPTCHA retries exceeded for page ${page}`);
            // move to next page
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
            } else {
              naukriLogger.info(`📊 ${location} metrics: ${JSON.stringify(metrics)}`);
            }
            return;
          }
        }

        // ===================== PARSE JSON SAFELY ======================
        let json;

        try {
          json = JSON.parse(Buffer.from(response.data, 'utf8').toString());
        } catch (e) {
          logger.warn(`❌ JSON parse failed for page ${page}. Skipping to next page.`);

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

        const jobs = json.jobDetails || [];

        if (jobs.length === 0) {
          naukriLogger.info(`📊 ${location} metrics: ${JSON.stringify(metrics)}`);
          return;
        }

        for (const jobItem of jobs) {
          try {
            const doc = await RawJobs.create({
              rawData: jobItem,
              source: 'naukri',
              externalId: jobItem.jobId,
              status: 'queued',
            });
            metrics.insertedJobs++;
            await preprocessQueue.add('raw-job', { id: doc._id });
          } catch (err) {
            Sentry.captureException(err);
            if (err.code === 11000) metrics.duplicateJobs++;
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

          logger.info(`➡️ Queued next page ${nextPage}`);
        } else {
          naukriLogger.info(`📊 ${location} metrics: ${JSON.stringify(metrics)}`);
        }
      } catch (err) {
        metrics.failedRequests++;
        Sentry.captureException(err);

        await ApiRequestLog.create({
          url,
          location,
          method: 'GET',
          statusCode: err.response?.status || 0,
          durationMs: Date.now() - start,
          errorMessage: err.message,
          timestamp: new Date(),
        });

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
