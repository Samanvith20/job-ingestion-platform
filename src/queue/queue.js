
import { Queue } from "bullmq";
import { connection } from "./connection.js";
import logger from "../logger/logger.js";


// Helper to create queues with default options
function createQueue(name, options = {}) {
  const queue = new Queue(name, {
    connection,
    defaultJobOptions: { 
      removeOnComplete: true,
      removeOnFail: false,
      ...options, // merge any queue-specific options
    },
  });
   queue.on("error", (err) => {
    logger.error(`[QUEUE ERROR] ${name}: ${err.message}`, err);
  });
  return queue;
}

// Define all your queues here(create queue instance and co)
export const naukriQueue = createQueue("naukri-http-requests", { attempts: 2, backoff: { type: "exponential", delay: 2000 } });
export const scraperQueue = createQueue("scraperQueue", { attempts: 2, backoff: { type: "exponential", delay: 1000 } });
export const preprocessQueue = createQueue('raw-job-queue', {attempts: 2, backoff: { type: "exponential", delay: 3000 } });
export const aiBatchQueue = createQueue('ai-batch-create-queue', {attempts: 2, backoff: { type: "exponential", delay: 3000 } });
export const aiBatchResultQueue= createQueue('ai-batch-result-queue', {attempts: 2, backoff: { type: "exponential", delay: 3000 } });
export const locationDoneQueue = createQueue('naukri-location-done');