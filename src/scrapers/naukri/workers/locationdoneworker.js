import { Worker } from "bullmq";
import { connection } from '../../../queue/connection.js';
import naukriLogger from '../naukrilogger.js';
new Worker(
  'naukri-location-done',
  async (job) => {
   naukriLogger.info(`🏁 Location completed: ${job.data.location}`);
    return job.data;
  },
  { connection }
);
