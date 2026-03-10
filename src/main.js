import cron from 'node-cron';
import { founditScraper } from './scrapers/foundit/index.js';
import { internshalajobsScraper } from './scrapers/internshala/index.js';
import { naukriScraper } from './scrapers/naukri/index.js';

import { runIngestion } from './utils/neo4jingest.js';
import { runPostProcessing } from './utils/postprocessing.js';
import logger from './logger/logger.js';
async function main() {
  logger.info('main is running successfully');

  // run at night 12 clock midnight everyday
  cron.schedule('0 0 * * *', async () => {
    logger.info('\n🚀 Running Scrapers...');
    logger.info(`   Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    try {
      await founditScraper();
      await internshalajobsScraper();
      await naukriScraper();
      logger.info('✅ Scrapers completed successfully\n');
    } catch (err) {
      logger.error('❌ Error running scrapers:', err.message);
    }
  },
  {
    timezone: 'Asia/Kolkata',
    
  }
);
  

  // push to neo4j every day at 6 clock in morning
  cron.schedule(
    '0 6 * * *',
    async () => {
      logger.info('\n🚀 [INGESTION] Running Neo4j ingestion...');
      logger.info(`   Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      try {
        await runIngestion();
        logger.info('✅ [INGESTION] Completed successfully\n');
      } catch (err) {
    logger.error('❌ [INGESTION] Failed:', err.message);
      }
    },
    {
      timezone: 'Asia/Kolkata',
    }
  );

  cron.schedule(
    '0 8 * * *',
    async () => {
      logger.info('\n🔧 [POST-PROCESS] Creating enhanced relationships...');
      logger.info(`   Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

      try {
        await runPostProcessing();

        logger.info('✅ [POST-PROCESS] Completed successfully\n');
      } catch (err) {
        logger.error('❌ [POST-PROCESS] Failed:', err.message);
      }
    },
    {
      timezone: 'Asia/Kolkata',
    }
  );
}
main();
