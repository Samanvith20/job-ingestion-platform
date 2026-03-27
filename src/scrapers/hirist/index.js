import Sentry from '../../sentry.js';

import { KEYWORDS } from './data/keywords.js';
import { fetchAllJobs } from './functions/fetchJobs.js';
import hiristLogger from './hiristlogger.js';



/**
 * Starts the Hirist scraper to fetch jobs for each configured keyword.
 *
 * Iterates over KEYWORDS and invokes fetchAllJobs for each keyword, logging progress.
 * Per-keyword errors are logged and do not interrupt processing of remaining keywords.
 * Completes after all keywords have been processed.
 */
export async function startHiristScraper() {
  //setScraperContext(SOURCE);

  for (const keyword of KEYWORDS) {
    hiristLogger.info(`\n🔍 Fetching jobs for: "${keyword}"`);

    try {
      await fetchAllJobs(keyword);
    } catch (err) {
      Sentry.captureException(err)
      hiristLogger.error(`❌ Failed to process keyword "${keyword}": ${err.message}`);
    }
  }

  hiristLogger.info(`🏁 Hirist Scraper Finished Successfully`);
}

//startHiristScraper()