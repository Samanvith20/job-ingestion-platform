
import { locationDoneEvents, } from '../../../queue/events.js';
import { HEADERS } from '../data/constants.js';
import naukriLogger from '../naukrilogger.js';
import { locationDoneQueue, naukriQueue } from '../../../queue/queue.js';

// export async function fetchJobs(location, paginationLimit, resultsPerPage, baseSearchUrl) {

//   const url =
//     `${baseSearchUrl}?noOfResults=${resultsPerPage}` +
//     `&urlType=search_by_location&searchType=adv` +
//     `&location=${encodeURIComponent(location)}` +
//     `&sort=f&jobAge=1&pageNo=1&src=directSearch&latLong=`;
// // enqueue first page
//   await naukriQueue.add('fetch', {
//     url,
//     location,
//     headers: HEADERS,
//     page: 1,
//     paginationLimit,
//   });
//   // 🔥 wait for location-done
//   await new Promise((resolve) => {
//     const handler = async ({ jobId }) => {
//       const job = await locationDoneQueue.getJob(jobId);
//       if (job?.data?.location === location) {
//         locationDoneEvents.off('completed', handler);
//         resolve();
//       }
//     };

//     locationDoneEvents.on('completed', handler);
//   });

//   naukriLogger.info(`✅ Finished processing ${location}`);
// }


export async function fetchJobs(location, paginationLimit, resultsPerPage, baseSearchUrl) {
  const url =
    `${baseSearchUrl}?noOfResults=${resultsPerPage}` +
    `&urlType=search_by_location&searchType=adv` +
    `&location=${encodeURIComponent(location)}` +
    `&sort=f&jobAge=1&pageNo=1&src=directSearch&latLong=`;

  await locationDoneEvents.waitUntilReady();

  const waitForLocationDone = new Promise((resolve) => {
    const handler = (event) => { 
      
      console.log('LOCATION DONE EVENT:', event);

      if (event.returnvalue?.location !== location) return;

      locationDoneEvents.off('completed', handler);
      resolve();
    };

    locationDoneEvents.on('completed', handler);
  });

  await naukriQueue.add('fetch', {
    url,
    location,
    headers: HEADERS,
    page: 1,
    paginationLimit,
  });

  await waitForLocationDone;

  naukriLogger.info(`✅ Finished processing ${location}`);
}



