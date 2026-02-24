import cron from 'node-cron';
import { founditScraper } from './scrapers/foundit/index.js';
import { internshalajobsScraper } from './scrapers/internshala/index.js';
import { naukriScraper } from './scrapers/naukri/index.js';
import { runCleanup } from './utils/daily-job-cleanup.js';
import { runIngestion } from './utils/neo4jingest.js';
import { runPostProcessing } from './utils/postprocessing.js';
async function main() {
  console.log('main is running successfully');

  // run at night 12 clock midnight everyday
  cron.schedule('0 0 * * *', async () => {
    console.log('\n🔧 [POST-PROCESS] Creating enhanced relationships...');
    console.log(`   Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    await naukriScraper();
    await internshalajobsScraper();
    await founditScraper();
  });
  //before scraper run delete old data from mongo db
  cron.schedule(
    '23 0 * * *',
    async () => {
      console.log('\n🧹 [CLEANUP] Running daily job cleanup...');
      console.log(`   Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      try {
        await runCleanup();
        console.log('✅ [CLEANUP] Completed successfully\n');
      } catch (err) {
        console.error('❌ [CLEANUP] Failed:', err.message);
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
      console.log('\n🚀 [INGESTION] Running Neo4j ingestion...');
      console.log(`   Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      try {
        await runIngestion();
        console.log('✅ [INGESTION] Completed successfully\n');
      } catch (err) {
        console.error('❌ [INGESTION] Failed:', err.message);
      }
    },
    {
      timezone: 'Asia/Kolkata',
    }
  );

  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log('\n🔧 [POST-PROCESS] Creating enhanced relationships...');
      console.log(`   Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

      try {
        await runPostProcessing();

        console.log('✅ [POST-PROCESS] Completed successfully\n');
      } catch (err) {
        console.error('❌ [POST-PROCESS] Failed:', err.message);
      }
    },
    {
      timezone: 'Asia/Kolkata',
    }
  );
}
main();
