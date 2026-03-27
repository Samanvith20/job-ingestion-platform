

import Sentry from '../../sentry.js';



import { fetchJobs } from './functions/fetchJobs.js';
import instahyreLogger from './instahyrelogger.js';

export async function instahyreScraper() {
  

  try {
    const { totalJobs, duplicateJobs } = await fetchJobs();

    instahyreLogger.info(
      `✅ Instahyre Scraper completed. Total Jobs: ${totalJobs}, Duplicates: ${duplicateJobs}`
    );
  } catch (error) {
    Sentry.captureException(error);
    instahyreLogger.error(`❌ Error: ${error.message}`);
  }
}
//instahyreScraper()