/**
 * Jest global setup for integration tests.
 *
 * Sets environment variables BEFORE any module is loaded, which prevents
 * the auth middleware from calling process.exit(1) on a missing JWT_SECRET.
 */

// A random-looking string that is NOT one of the "known dev secrets" the
// auth module refuses.  It only needs to sign/verify test JWTs within a
// single test run.
process.env.JWT_SECRET = 'integration-test-secret-not-a-known-placeholder-9f2a3b4c';

// Point at the local throwaway Postgres.  These defaults match the Docker
// command: `docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_USER = process.env.DB_USER || 'postgres';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
process.env.DB_NAME = 'cloistr_tasks_test';
