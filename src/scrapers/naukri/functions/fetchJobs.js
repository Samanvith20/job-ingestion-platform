import Sentry from '../../../sentry.js';
import { naukriQueue } from '../../../queue/queue.js';
import { HEADERS } from '../data/constants.js';

/**
 * Waits for the naukriQueue to process jobs for a given location by queuing the first page and polling the queue until it is empty or a timeout is reached.
 *
 * @param {string} location - Location string used to build the search URL (will be URL-encoded).
 * @param {number} paginationLimit - Maximum number of pages to process for this location (passed through to the queued job).
 * @param {number} resultsPerPage - Number of results requested per page (used in the constructed search URL).
 * @param {string} baseSearchUrl - Base URL for the search endpoint to which query parameters are appended.
 * @returns {undefined} undefined when the queue for the location has drained or the wait timed out.
 */
export async function fetchJobs(location, paginationLimit, resultsPerPage, baseSearchUrl) {
  return new Promise((resolve) => {
    // Queue page 1
    try {
      const url =
        `${baseSearchUrl}?noOfResults=${resultsPerPage}` +
        `&urlType=search_by_location&searchType=adv` +
        `&location=${encodeURIComponent(location)}` +
        `&sort=f&jobAge=1&pageNo=1&src=directSearch&latLong=`;

      naukriQueue.add('fetch', {
        url,
        headers: { ...HEADERS },
        location,
        page: 1,
        paginationLimit,
      });
    } catch (err) {
      Sentry.captureException(err);
      console.error(`❌ Failed to queue page 1 for ${location}: ${err.message}`);
      resolve();
      return;
    }

    console.log(`🚀 Queued Page 1 for ${location}`);

    const maxWaitTime = 30 * 60 * 1000; // 30 minutes
    const startTime = Date.now();
    // WAIT until queue is empty for this location
    const interval = setInterval(async () => {
      try {
        const waiting = await naukriQueue.getWaitingCount();
        const active = await naukriQueue.getActiveCount();
        const delayed = await naukriQueue.getDelayedCount();

        // Timeout check
        if (Date.now() - startTime > maxWaitTime) {
          clearInterval(interval);
          console.warn(`⏳ Queue timeout reached for location: ${location}`);
          resolve();
          return;
        }

        if (waiting === 0 && active === 0 && delayed === 0) {
          clearInterval(interval);
          resolve();
        }
      } catch (err) {
        clearInterval(interval);
        Sentry.captureException(err);
        console.error(`❌ Failed to read queue stats for ${location}: ${err.message}`);
        resolve();
      }
    }, 5000);
  });
}
