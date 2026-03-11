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
import { chromium } from 'playwright';

// ─── Shared state ─────────────────────────────────────────────────────────────
let naukriCookies = '';
let cachedNkParam = null;
let cachedBrowserCookies = '';

// ─── Homepage cookies ──────────────────────────────────────────────────────────
async function fetchHomepageCookies() {
  try {
    const res = await axiosInstance.get('https://www.naukri.com/', {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
      },
      validateStatus: () => true,
    });
    const cookies = res.headers['set-cookie'] || [];
    if (cookies.length > 0) {
      naukriCookies = cookies.map((c) => c.split(';')[0]).join('; ');
      naukriLogger.info(`✅ Fetched homepage cookies: ${cookies.length} set`);
    } else {
      naukriLogger.warn('⚠️ No cookies returned from homepage');
    }
  } catch (err) {
    Sentry.captureException(err);
    naukriLogger.error('⚠️ fetchHomepageCookies failed:', err.message);
  }
}

// ─── Browser fetch — only triggered on 406 ────────────────────────────────────
async function fetchNkParamFromBrowser(location) {
  naukriLogger.info(`🚀 Browser launching to refresh nkparam [${location}]`);

  const browser = await chromium.launch({
    headless: false, // xvfb-run handles display on GCP
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
  });

  const page = await context.newPage();
  let capturedNkParam = null;

  page.on('request', (request) => {
    if (request.url().includes('jobapi/v3/search')) {
      const nkparam = request.headers()['nkparam'];
      if (nkparam) {
        capturedNkParam = nkparam;
        naukriLogger.info('✅ nkparam captured');
      }
    }
  });

  try {
    await page.goto('https://www.naukri.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    await page.goto(`https://www.naukri.com/${location.toLowerCase()}-jobs`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await page.waitForRequest(
      (req) => req.url().includes('jobapi/v3/search'),
      { timeout: 20000 }
    ).catch(() => naukriLogger.warn('⚠️ jobapi request not seen in 20s'));

    await page.waitForTimeout(1000);

    const cookies = await context.cookies();
    cachedBrowserCookies = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    naukriLogger.info(`🍪 Browser cookies captured: ${cookies.length}`);

  } finally {
    await browser.close();
  }

  if (!capturedNkParam) {
    throw new Error(`nkparam not captured for location: ${location}`);
  }

  cachedNkParam = capturedNkParam;
  naukriLogger.info('✅ nkparam cached successfully');

  return { nkparam: capturedNkParam, cookies: cachedBrowserCookies };
}

// ─── Worker ────────────────────────────────────────────────────────────────────
export async function naukriWorker() {
  setScraperContext(NAUKRI_WORKER);
  await connectDB();
  naukriLogger.info('Connected to MongoDB & worker started 🚀');

  function getTodayKey(location) {
    return `${location}-${new Date().toISOString().slice(0, 10)}`;
  }

  const metricsByLocation = new Map();

  function getMetrics(location) {
    const key = getTodayKey(location);
    if (!metricsByLocation.has(key)) {
      metricsByLocation.set(key, {
        date: new Date().toISOString().slice(0, 10),
        location,
        totalRequests: 0,
        failedRequests: 0,
        insertedJobs: 0,
        duplicateJobs: 0,
      });
    }
    return metricsByLocation.get(key);
  }

  await fetchHomepageCookies();
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
        _406Retries = 0,
        captchaRetries = 0,
      } = job.data;

      const metrics = getMetrics(location);
      metrics.totalRequests++;

      try {
        naukriLogger.info(`➡️ URL: ${url}`);

        const rDelay = randomDelayMs(1500, 3000);
        await delay(Math.max(PAGE_DELAY_MS || 0, rDelay));

        if (Date.now() - lastCookieRefresh > 6 * 60 * 1000) {
          await fetchHomepageCookies();
          lastCookieRefresh = Date.now();
        }

        // Use browser cookies if we have them (post-406 refresh), else homepage cookies
        const activeCookies = cachedBrowserCookies || naukriCookies;
        const requestConfig = {
          headers: {
            ...headers,
            ...(cachedNkParam && { nkparam: cachedNkParam }),
            Cookie: activeCookies,
          },
          validateStatus: () => true,
        };

        const response = await axiosInstance.get(url, requestConfig);
        naukriLogger.info(`⚡ Status: ${response.status}`);

        // ── 406: nkparam invalid → refresh via browser ────────────────────────
        if (response.status === 406) {
          metrics.failedRequests++;

          if (_406Retries < 3) {
            naukriLogger.warn(`⚠️ 406 on page ${page} — refreshing nkparam (retry ${_406Retries + 1}/3)`);

            await fetchNkParamFromBrowser(location); // updates cachedNkParam + cachedBrowserCookies

            await naukriQueue.add('fetch', {
              ...job.data,
              _406Retries: _406Retries + 1,
            });
            return;
          }

          naukriLogger.warn(`⏭️ 406 retries exhausted for page ${page}, skipping`);
          const nextPage = page + 1;
          if (nextPage <= paginationLimit) {
            await naukriQueue.add('fetch', {
              url: url.replace(`pageNo=${page}`, `pageNo=${nextPage}`),
              headers, location, page: nextPage, paginationLimit,
            });
          } else {
            naukriLogger.info(`📊 ${location} metrics: ${JSON.stringify(metrics)}`);
            await locationDoneQueue.add('done', { location });
          }
          return;
        }

        // ── 403: session blocked → refresh homepage cookies ───────────────────
        if (response.status === 403) {
          metrics.failedRequests++;

          if (_403Retries === 2) {
            await fetchHomepageCookies();
            lastCookieRefresh = Date.now();
          }

          if (_403Retries < 4) {
            naukriLogger.warn(`⛔ 403 on page ${page} — retry ${_403Retries + 1}/4`);
            const backoffMs = 1000 * Math.pow(2, _403Retries);
            await delay(backoffMs + randomDelayMs(500, 1500));

            await naukriQueue.add('fetch', {
              url, headers, location, page, paginationLimit,
              _403Retries: _403Retries + 1,
            });
            return;
          }

          naukriLogger.warn(`⏭️ 403 retries exhausted for page ${page}, skipping`);
          const nextPage = page + 1;
          if (nextPage <= paginationLimit) {
            await naukriQueue.add('fetch', {
              url: url.replace(`pageNo=${page}`, `pageNo=${nextPage}`),
              headers, location, page: nextPage, paginationLimit,
            });
          } else {
            naukriLogger.info(`📊 ${location} metrics: ${JSON.stringify(metrics)}`);
            await locationDoneQueue.add('done', { location });
          }
          return;
        }

        // ── CAPTCHA / non-JSON response ────────────────────────────────────────
        const data = response.data;
        if (typeof data === 'string') {
          if (data.includes('captcha') || data.includes('cf-challenge')) {
            if (captchaRetries < 4) {
              await delay(2000);
              await naukriQueue.add('fetch', { ...job.data, captchaRetries: captchaRetries + 1 });
              return;
            }
            naukriLogger.warn(`❌ CAPTCHA retries exceeded for page ${page}`);
          } else {
            naukriLogger.error(`❌ Expected JSON but got string on page ${page}`);
          }

          const nextPage = page + 1;
          if (nextPage <= paginationLimit) {
            await naukriQueue.add('fetch', {
              url: url.replace(`pageNo=${page}`, `pageNo=${nextPage}`),
              headers, location, page: nextPage, paginationLimit,
            });
          }
          return;
        }

        // ── Process jobs ───────────────────────────────────────────────────────
        const jobs = data.jobDetails || [];

        if (jobs.length === 0) {
          naukriLogger.warn(`⚠️ No jobs on page ${page} for ${location}`);
          naukriLogger.info(`📊 ${location} metrics: ${JSON.stringify(metrics)}`);
          await locationDoneQueue.add('done', { location });
          return;
        }

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
              continue;
            }
            Sentry.captureException(err);
            naukriLogger.error(`❌ Failed to insert job on page ${page}:`, err.message);
          }
        }

        // ── Next page ──────────────────────────────────────────────────────────
        const nextPage = page + 1;
        if (nextPage <= paginationLimit) {
          await naukriQueue.add('fetch', {
            url: url.replace(`pageNo=${page}`, `pageNo=${nextPage}`),
            headers, location, page: nextPage, paginationLimit,
          });
          naukriLogger.info(`➡️ Queued page ${nextPage}`);
        } else {
          naukriLogger.info(`📊 ${location} metrics: ${JSON.stringify(metrics)}`);
          await locationDoneQueue.add('done', { location });
        }

      } catch (err) {
        metrics.failedRequests++;
        Sentry.captureException(err);
        throw err;
      }
    },
    {
      connection,
      concurrency: 1,
      limiter: { max: 1, duration: 2000 },
    }
  );
}

naukriWorker().catch((err) => {
  console.error('❌ Failed to start naukri worker:', err);
  process.exit(1);
});