// backend/database/init.js
// Database initialization and migration system

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection configuration
const createPool = (dbName = 'postgres') => {
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: dbName,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
};

// Check if database exists
async function databaseExists(dbName) {
  const pool = createPool('postgres'); // Connect to default postgres db
  try {
    const result = await pool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking database existence:', error);
    return false;
  } finally {
    await pool.end();
  }
}

// Create database if it doesn't exist
async function createDatabase(dbName) {
  const pool = createPool('postgres');
  try {
    await pool.query(`CREATE DATABASE "${dbName}"`);
    console.log(`✅ Database '${dbName}' created successfully`);
  } catch (error) {
    if (error.code === '42P04') { // Database already exists
      console.log(`ℹ️  Database '${dbName}' already exists`);
    } else {
      throw error;
    }
  } finally {
    await pool.end();
  }
}

// Check if tables exist
async function tablesExist(pool) {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('task_lists', 'task_templates', 'tasks')
    `);
    return result.rows.length === 3;
  } catch (error) {
    console.error('Error checking tables:', error);
    return false;
  }
}

// Execute SQL file
async function executeSQLFile(pool, filePath) {
  try {
    const sql = fs.readFileSync(filePath, 'utf8');
    await pool.query(sql);
    console.log(`✅ Executed: ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`❌ Error executing ${filePath}:`, error);
    throw error;
  }
}

// Run migrations
async function runMigrations(pool) {
  try {
    // Create migrations table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      console.log('ℹ️  No migrations directory found, skipping migrations');
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      // Check if migration already executed
      const result = await pool.query(
        'SELECT 1 FROM migrations WHERE filename = $1',
        [file]
      );

      if (result.rows.length === 0) {
        console.log(`🔄 Running migration: ${file}`);
        await executeSQLFile(pool, path.join(migrationsDir, file));
        
        // Record migration as executed
        await pool.query(
          'INSERT INTO migrations (filename) VALUES ($1)',
          [file]
        );
        console.log(`✅ Migration completed: ${file}`);
      } else {
        console.log(`⏭️  Migration already executed: ${file}`);
      }
    }
  } catch (error) {
    console.error('❌ Error running migrations:', error);
    throw error;
  }
}

// Insert sample data if tables are empty
async function insertSampleData(pool) {
  try {
    // Check if we already have data
    const result = await pool.query('SELECT COUNT(*) FROM task_lists');
    const count = parseInt(result.rows[0].count);

    if (count > 0) {
      console.log('ℹ️  Sample data already exists, skipping');
      return;
    }

    console.log('🌱 Inserting sample data...');

    // Insert sample task lists
    const listsResult = await pool.query(`
      INSERT INTO task_lists (name, description, icon, color, sort_order) VALUES
      ('Morning Routine', 'Start the day right', '🌅', '#f59e0b', 1),
      ('Work Tasks', 'Daily work responsibilities', '💼', '#3b82f6', 2),
      ('Evening Routine', 'End of day wrap-up', '🌙', '#8b5cf6', 3)
      RETURNING id, name
    `);

    const morningId = listsResult.rows.find(r => r.name === 'Morning Routine').id;
    const workId = listsResult.rows.find(r => r.name === 'Work Tasks').id;
    const eveningId = listsResult.rows.find(r => r.name === 'Evening Routine').id;

    // Insert sample task templates
    await pool.query(`
      INSERT INTO task_templates (list_id, name, description, time_slot, estimated_minutes, sort_order) VALUES
      -- Morning Routine
      ($1, 'Check email', 'Review overnight emails and prioritize', '8:30', 15, 1),
      ($1, 'Check teams', 'Review Teams messages and notifications', '8:45', 10, 2),
      ($1, 'Check web scraping', 'Verify scraping jobs completed successfully', '9:00', 10, 3),
      ($1, 'Review overnight alerts', 'Check monitoring dashboards for any issues', '9:05', 15, 4),
      ($1, 'Plan daily priorities', 'Set top 3 goals for the day', '9:15', 10, 5),
      
      -- Work Tasks
      ($2, 'Review monitoring dashboards', 'Check system health across all services', 'morning', 20, 1),
      ($2, 'Check Kubernetes cluster health', 'Verify all pods and services are running', 'morning', 15, 2),
      ($2, 'Verify cert-manager renewals', 'Ensure SSL certificates are valid', 'morning', 10, 3),
      ($2, 'Review ArgoCD deployments', 'Check deployment status and sync health', 'morning', 15, 4),
      ($2, 'Check CI/CD pipeline status', 'Review build and deployment pipelines', 'afternoon', 10, 5),
      ($2, 'Update project documentation', 'Keep docs current with recent changes', 'afternoon', 30, 6),
      ($2, 'Review security alerts', 'Check for any security notifications', 'afternoon', 15, 7),
      
      -- Evening Routine
      ($3, 'Archive completed work', 'Clean up workspace and organize files', 'evening', 15, 1),
      ($3, 'Plan tomorrow priorities', 'Set agenda for next day', 'evening', 10, 2),
      ($3, 'Final system health check', 'Ensure all systems stable for overnight', 'evening', 20, 3),
      ($3, 'Backup verification', 'Confirm all backups completed successfully', 'evening', 10, 4),
      ($3, 'Clear desktop/downloads', 'Organize local workspace', 'evening', 5, 5)
    `, [morningId, workId, eveningId]);

    console.log('✅ Sample data inserted successfully');

  } catch (error) {
    console.error('❌ Error inserting sample data:', error);
    throw error;
  }
}

// Main initialization function
async function initializeDatabase() {
  const dbName = process.env.DB_NAME || 'taskmanager';
  
  console.log('🚀 Starting database initialization...');
  console.log(`📊 Target database: ${dbName}`);

  try {
    // Step 1: Check if database exists, create if not
    const exists = await databaseExists(dbName);
    if (!exists) {
      console.log(`📦 Creating database: ${dbName}`);
      await createDatabase(dbName);
    } else {
      console.log(`✅ Database '${dbName}' already exists`);
    }

    // Step 2: Connect to the target database
    const pool = createPool(dbName);

    // Step 3: Check if tables exist
    const hastables = await tablesExist(pool);
    
    if (!hastables) {
      console.log('📋 Creating initial schema...');
      // Execute the initial schema
      await executeSQLFile(pool, path.join(__dirname, 'migrations', '001_initial_schema.sql'));
    } else {
      console.log('✅ Tables already exist');
    }

    // Step 4: Run any pending migrations
    console.log('🔄 Checking for migrations...');
    await runMigrations(pool);

    // Step 5: Insert sample data if needed
    await insertSampleData(pool);

    // Step 6: Verify setup
    const verification = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM task_lists) as lists_count,
        (SELECT COUNT(*) FROM task_templates) as templates_count,
        (SELECT COUNT(*) FROM tasks) as tasks_count
    `);

    console.log('📊 Database setup complete!');
    console.log(`   • Task lists: ${verification.rows[0].lists_count}`);
    console.log(`   • Task templates: ${verification.rows[0].templates_count}`);
    console.log(`   • Daily tasks: ${verification.rows[0].tasks_count}`);

    await pool.end();
    return true;

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Export for use in server.js
module.exports = {
  initializeDatabase,
  createPool: () => createPool(process.env.DB_NAME || 'taskmanager')
};

// Run initialization if this file is executed directly
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      console.log('🎉 Database initialization completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Database initialization failed:', error);
      process.exit(1);
    });
}