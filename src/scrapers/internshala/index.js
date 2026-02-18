

import { INTERNSHALA_INTERNSHIPS_URL, INTERNSHALA_JOBS_URL, REDIS_LAST_INTERNSHIP_DATE_KEY, REDIS_LAST_JOB_DATE_KEY, sourceName } from './data/constants.js';
import { fetchJobs } from './functions/fetchJobs.js';
import internshalalogger from './internshalalogger.js';

export async function internshalajobsScraper() {
  try {
    const jobs = await fetchJobs({
      url: INTERNSHALA_JOBS_URL,
      source: sourceName,
      redisKey: REDIS_LAST_JOB_DATE_KEY,
      type:"jobs"
    });
    internshalalogger.info(
      `🏁 Internshala jobsScraper Finished Successfully. Total Jobs Fetched: ${jobs}`
    );
    
  } catch (err) {
   internshalalogger.error(`❌ Failed to scrape "Internshala": ${err.message}`);
  }
}


// export async function internshalainternshipsScraper() {
//   try {
//    const internships = await fetchJobs({
//         url: INTERNSHALA_INTERNSHIPS_URL,
//         source: sourceName,
//         type:"internships",
//         redisKey: REDIS_LAST_INTERNSHIP_DATE_KEY
//     })
//     internshalalogger.info(
//       `🏁 Internshala internshipsScraper Finished Successfully. Total Internships Fetched: ${internships}`
//     );
    
//   } catch (err) {
//    internshalalogger.error(`❌ Failed to scrape "Internshala": ${err.message}`);
//   }
// }

// internshalainternshipsScraper();