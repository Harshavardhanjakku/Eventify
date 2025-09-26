// JavaScript file to get all tables with their columns and constraints
// Run this in Node.js with pg (PostgreSQL client)

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'eventifydb',
  password: 'CanvasHarsha123',
  port: 5432,
});

async function getAllTablesSchema() {
  const client = await pool.connect();
  
  try {
    // Get all tables
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    
    const tablesResult = await client.query(tablesQuery);
    const tables = tablesResult.rows;
    
    console.log('DATABASE SCHEMA REPORT');
    console.log('=====================\n');
    
    for (const table of tables) {
      const tableName = table.table_name;
      console.log(`Table: ${tableName}`);
      console.log('_'.repeat(tableName.length + 7));
      
      // Get columns for this table
      const columnsQuery = `
        SELECT 
          c.column_name,
          c.data_type,
          c.character_maximum_length,
          c.is_nullable,
          c.column_default,
          CASE 
            WHEN pk.column_name IS NOT NULL THEN 'PRIMARY KEY'
            WHEN fk.column_name IS NOT NULL THEN 'FOREIGN KEY -> ' || fk.foreign_table_name || '(' || fk.foreign_column_name || ')'
            WHEN ck.constraint_name IS NOT NULL THEN 'CHECK: ' || ck.check_clause
            WHEN uq.column_name IS NOT NULL THEN 'UNIQUE'
            ELSE ''
          END as constraints
        FROM 
          information_schema.columns c
          LEFT JOIN (
            SELECT 
              ku.table_name,
              ku.column_name,
              tc.constraint_name
            FROM 
              information_schema.table_constraints tc
              JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
            WHERE 
              tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_name = $1
          ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
          LEFT JOIN (
            SELECT 
              ku.table_name,
              ku.column_name,
              ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name
            FROM 
              information_schema.table_constraints tc
              JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
              JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
            WHERE 
              tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_name = $1
          ) fk ON c.table_name = fk.table_name AND c.column_name = fk.column_name
          LEFT JOIN (
            SELECT 
              tc.table_name,
              ku.column_name,
              tc.constraint_name,
              cc.check_clause
            FROM 
              information_schema.table_constraints tc
              JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
              JOIN information_schema.check_constraints cc ON tc.constraint_name = cc.constraint_name
            WHERE 
              tc.constraint_type = 'CHECK'
              AND tc.table_name = $1
          ) ck ON c.table_name = ck.table_name AND c.column_name = ck.column_name
          LEFT JOIN (
            SELECT 
              ku.table_name,
              ku.column_name
            FROM 
              information_schema.table_constraints tc
              JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
            WHERE 
              tc.constraint_type = 'UNIQUE'
              AND tc.table_name = $1
            ) uq ON c.table_name = uq.table_name AND c.column_name = uq.column_name
        WHERE 
          c.table_name = $1
        ORDER BY 
          c.ordinal_position;
      `;
      
      const columnsResult = await client.query(columnsQuery, [tableName]);
      const columns = columnsResult.rows;
      
      columns.forEach(col => {
        let typeInfo = col.data_type;
        if (col.character_maximum_length) {
          typeInfo += `(${col.character_maximum_length})`;
        }
        
        let nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        let constraint = col.constraints ? ` | ${col.constraints}` : '';
        let defaultVal = col.column_default ? ` | DEFAULT ${col.column_default}` : '';
        
        console.log(`  ${col.column_name}: ${typeInfo} | ${nullable}${constraint}${defaultVal}`);
      });
      
      console.log('\n');
    }
    
  } catch (error) {
    console.error('Error fetching schema:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the function
getAllTablesSchema().catch(console.error);
