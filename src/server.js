const app = require('./app');
const env = require('./config/env');

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console -- startup banner, not a request-path log
  console.log(`restaurant-ai-agent listening on port ${env.PORT} (${env.NODE_ENV})`);
});
