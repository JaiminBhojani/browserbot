import 'dotenv/config';
import { startGateway } from './gateway/server.js';
import { createChildLogger } from './infra/logger.js';

const log = createChildLogger('main');

async function main() {
  try {
    await startGateway();
  } catch (err) {
    log.fatal({ err }, 'Failed to start BrowseBot');
    process.exit(1);
  }
}

main();
