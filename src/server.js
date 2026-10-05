const app = require('./app');
const env = require('./config/env');
const { logger } = require('./config/logger');

app.listen(env.PORT, () => {
  logger.info(`restaurant-ai-agent listening on port ${env.PORT} (${env.NODE_ENV})`);
});
