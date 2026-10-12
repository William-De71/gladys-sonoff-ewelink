// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered before connect();
// the work lives in src/ (manager, actions, scenes, widgets).
//
// Environment provided by the Gladys supervisor (read by the SDK):
//   GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// Optional: LOG_LEVEL (debug | info | warn | error), DATA_DIR (default /data).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createIntegration } from './src/integration.js';

const gladys = new GladysIntegration();
const integration = createIntegration(gladys);

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await integration.shutdown();
});

logger.info('Starting the Sonoff / eWeLink integration...');
gladys.connect().catch((error) => {
  logger.error('Initial connection failed', error);
  process.exit(1);
});
