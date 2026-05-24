const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../data/db/listings.db');
const db = new sqlite3.Database(dbPath);

const migrations = [
  {
    name: 'add_location_column',
    sql: `ALTER TABLE listings ADD COLUMN location TEXT;`
  },
  {
    name: 'add_property_type_column',
    sql: `ALTER TABLE listings ADD COLUMN property_type TEXT;`
  },
  {
    name: 'add_bedrooms_column',
    sql: `ALTER TABLE listings ADD COLUMN bedrooms INTEGER;`
  },
  {
    name: 'add_bathrooms_column',
    sql: `ALTER TABLE listings ADD COLUMN bathrooms INTEGER;`
  },
  {
    name: 'add_area_sqft_column',
    sql: `ALTER TABLE listings ADD COLUMN area_sqft INTEGER;`
  },
  {
    name: 'add_furnished_column',
    sql: `ALTER TABLE listings ADD COLUMN furnished INTEGER;`
  },
  {
    name: 'add_parking_column',
    sql: `ALTER TABLE listings ADD COLUMN parking INTEGER;`
  },
  {
    name: 'add_description_column',
    sql: `ALTER TABLE listings ADD COLUMN description TEXT;`
  },
  {
    name: 'add_confidence_column',
    sql: `ALTER TABLE listings ADD COLUMN extraction_confidence REAL DEFAULT 0.5;`
  },
  {
    name: 'add_sender_column',
    sql: `ALTER TABLE listings ADD COLUMN sender_name TEXT;`
  },
  {
    name: 'add_image_paths_column',
    sql: `ALTER TABLE listings ADD COLUMN image_paths TEXT;`
  },
  {
    name: 'add_updated_at_column',
    sql: `ALTER TABLE listings ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;`
  }
];

function runMigrations() {
  migrations.forEach(migration => {
    db.run(migration.sql, (err) => {
      if (err) {
        console.log(`⚠️  Migration "${migration.name}" skipped (column may already exist)`);
      } else {
        console.log(`✅ Migration "${migration.name}" completed`);
      }
    });
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_location ON listings(location);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price ON listings(price);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_agent_phone ON listings(agent_phone);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_created_at ON listings(created_at DESC);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_property_type ON listings(property_type);`);

  console.log('✅ All indexes created');
}

db.serialize(() => {
  console.log('Starting database migrations...\n');
  runMigrations();

  setTimeout(() => {
    db.close(() => {
      console.log('\n✅ Database migration complete!');
    });
  }, 1000);
});
