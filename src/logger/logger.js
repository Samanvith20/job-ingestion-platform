import { BACKEND_NODE_ENV } from '../utils/constants.js';
import devLogger from './dev-logger.js';
import productionLogger from './production-logger.js';

const env = BACKEND_NODE_ENV;
let logger;

switch (env) {
  case 'production':
    logger = productionLogger();
    break;

  default:
    logger = devLogger();
    break;
}

export default logger;
