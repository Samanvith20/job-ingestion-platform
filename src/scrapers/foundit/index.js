// scrapers/foundit/founditScraper.js
import Sentry from '../../sentry.js';
import { setScraperContext } from '../../utils/sentryContext.js';
import { SOURCE } from './data/constants.js';
import founditlogger from './founditlogger.js';
import { fetchJobs } from './functions/fetchJobs.js';



/**
 * Orchestrates the Foundit scraping workflow and reports the outcome.
 *
 * Calls the scraper to collect jobs and logs a summary containing the total
 * and duplicate job counts on success, or logs an error message on failure.
 */
export async function founditScraper() {
  //console.log('\n🚀 Running Foundit Scraper (Main)...');
  setScraperContext(SOURCE);


  try {
    const { totalJobs, duplicateJobs } = await fetchJobs();

    founditlogger.info(
      `✅ Foundit Scraper completed successfully. Total Jobs: ${totalJobs}, Duplicate Jobs: ${duplicateJobs}`
    );
  } catch (error) {
    Sentry.captureException(error)
    founditlogger.error(`❌ Error running Foundit Scraper: ${error.message}`);
  }
}


//founditScraper()