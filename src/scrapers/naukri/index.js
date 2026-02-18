import fs from 'fs';

import { fetchJobs } from './functions/fetchJobs.js';
import logger from '../../logger/logger.js';
import naukriLogger from './naukrilogger.js';
import { setScraperContext } from '../../utils/sentryContext.js';
import { SOURCE } from './data/constants.js';
import Sentry from '../../sentry.js';

/**
 * Orchestrates scraping of job listings from Naukri across configured locations.
 *
 * Reads scraping configuration from ./data/locations.json and, for each configured
 * location, invokes the scraper worker to fetch jobs using the file's pagination
 * settings. Logs start and completion via the Naukri-specific logger; per-location
 * errors are logged and do not stop the overall run.
 */
export async function naukriScraper() {
  // Set Sentry context
  setScraperContext(SOURCE);

  naukriLogger.info('🎉 Naukri Scraper Started');

  const locationsinIndia = JSON.parse(
    fs.readFileSync(new URL('./data/locations.json', import.meta.url), 'utf-8')
  );
  const { locations, paginationLimit, resultsPerPage, baseSearchUrl } = locationsinIndia;

  for (const location of locations) {
    try {
      logger.debug(`📍 Scraping jobs for location: ${location}`);

      await fetchJobs(location, paginationLimit, resultsPerPage, baseSearchUrl);
    } catch (error) {
      Sentry.captureException(error);
      logger.error(`❌ Error scraping ${location}: ${error.message}`);
      continue;
    }
  }

  naukriLogger.info('🎉 Naukri Scraper Completed');
}
//naukriScraper()