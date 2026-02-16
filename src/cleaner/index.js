import logger from '../logger/logger.js';

import naukriparser from './parsers/naukriparser.js';


/**
 * Dispatches raw input to a site-specific parser and returns the parser's result.
 *
 * @param {any} data - Raw data to be parsed/cleaned by the site-specific parser.
 * @param {string} site - Site identifier that selects the parser; supported values: "naukri", "workday", "foundit", "hirist".
 * @returns {any} The parsed/cleaned result produced by the selected parser (may be falsy if the parser returned no result).
 * @throws {Error} If the provided `site` is unsupported or if the selected parser throws an error.
 */
export async function Cleanerfunction(data, site) {
  logger.info(`Cleanerfunction called for site: ${site}`);

  try {
    let result;

    switch (site?.toLowerCase()) {
      case 'naukri':
        logger.debug('➡️ Using Naukri parser');
        result =  naukriparser(data);
        break;

     

      default:
        logger.error(`❌ Unknown site: ${site}`);
        throw new Error(`Parser not implemented for site: ${site}`);
    }

    if (!result) {
      logger.warn('⚠️ Parser returned empty result');
    }

    // logger.debug('Cleanerfunction result:', result);
    return result;
  } catch (err) {
    logger.error('❌ Error in Cleanerfunction:', err);
    throw err;
  }
}