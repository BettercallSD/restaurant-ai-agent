const { pool } = require('../db/pool');

async function record(
  { restaurantId, actorType, actorId, action, resourceType, resourceId, metadata },
  executor = pool
) {
  await executor.query(
    `INSERT INTO audit_logs (restaurant_id, actor_type, actor_id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      restaurantId ?? null,
      actorType,
      actorId ?? null,
      action,
      resourceType ?? null,
      resourceId ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
}

module.exports = { record };
