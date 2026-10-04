/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // gen_random_uuid() for UUID primary keys (see docs/DECISIONS.md — not sequential ints, so
  // IDs handed to the AI/API aren't enumerable).
  pgm.createExtension('pgcrypto', { ifNotExists: true });
  // Required for the GiST exclusion constraint used on reservations to prevent double-booking
  // (equality comparison on uuid inside an EXCLUDE USING gist clause).
  pgm.createExtension('btree_gist', { ifNotExists: true });

  // Keeps `updated_at` correct on every table without relying on application code to remember
  // to set it on every UPDATE path.
  pgm.createFunction(
    'set_updated_at',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    `
  );
};

exports.down = (pgm) => {
  pgm.dropFunction('set_updated_at', []);
  pgm.dropExtension('btree_gist');
  pgm.dropExtension('pgcrypto');
};
