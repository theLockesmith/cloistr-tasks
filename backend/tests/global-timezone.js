/**
 * Jest globalSetup: run the whole suite west of UTC.
 *
 * Production runs UTC, which hides any code that mixes the Node process's
 * local zone with Postgres TIMESTAMP-without-zone columns (a login challenge
 * once looked hours expired on an Eastern host). Pinning a western zone makes
 * such bugs fail here, on every machine. Setting TZ inside a test file does
 * not work: Jest gives each file its own copy of process.env.
 */
export default function globalTimezone() {
  process.env.TZ = 'America/New_York';
}
