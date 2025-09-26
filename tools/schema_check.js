const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Use the same DB creds you provided
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'eventifydb',
  password: 'CanvasHarsha123',
  port: 5432,
});

async function fetchLiveSchema(client) {
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE' 
    ORDER BY table_name;
  `);
  const result = {};
  for (const { table_name } of tablesRes.rows) {
    const colsRes = await client.query(`
      SELECT 
        c.column_name,
        c.data_type,
        c.character_maximum_length,
        c.is_nullable,
        c.column_default
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = $1
      ORDER BY c.ordinal_position
    `, [table_name]);
    result[table_name] = colsRes.rows.map(r => ({
      column: r.column_name,
      type: r.character_maximum_length ? `${r.data_type}(${r.character_maximum_length})` : r.data_type,
      nullable: r.is_nullable === 'YES',
      default: r.column_default || null,
    }));
  }
  return result;
}

function parseSchemaSql(sql) {
  // Very lightweight parser: extract CREATE TABLE blocks and column lines
  const tables = {};
  const tableBlocks = sql.split(/CREATE TABLE IF NOT EXISTS|CREATE TABLE/).slice(1);
  for (const block of tableBlocks) {
    try {
      const nameMatch = block.match(/\s+([\w\.]+)\s*\(/);
      if (!nameMatch) continue;
      let tableName = nameMatch[1].trim();
      if (tableName.includes('.')) tableName = tableName.split('.')[1];
      const colsPart = block.split(')')[0];
      const lines = colsPart.split('\n').slice(1).map(l => l.trim()).filter(Boolean);
      const cols = [];
      for (const line of lines) {
        // stop at constraints-only lines
        if (/^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|CHECK|REFERENCES|\);)/i.test(line)) continue;
        const m = line.match(/^(\w+)\s+([\w\s\(\)]+)(?:,|$)/);
        if (m) {
          cols.push({ column: m[1], type: m[2].trim() });
        }
      }
      if (cols.length) tables[tableName] = cols;
    } catch {}
  }
  return tables;
}

function compareSchemas(live, declared) {
  const diffs = [];
  const liveTables = Object.keys(live);
  const declTables = Object.keys(declared);
  for (const t of liveTables) {
    if (!declTables.includes(t)) {
      diffs.push({ type: 'missing_in_sql', table: t, detail: 'Table exists in DB but not in server/sql/schema.sql' });
      continue;
    }
    const liveCols = new Map(live[t].map(c => [c.column, c]));
    const declCols = new Map(declared[t].map(c => [c.column, c]));
    for (const [col, ldef] of liveCols) {
      if (!declCols.has(col)) {
        diffs.push({ type: 'missing_column_in_sql', table: t, column: col });
      }
    }
    for (const [col] of declCols) {
      if (!liveCols.has(col)) {
        diffs.push({ type: 'missing_column_in_db', table: t, column: col });
      }
    }
  }
  for (const t of declTables) {
    if (!liveTables.includes(t)) {
      diffs.push({ type: 'missing_in_db', table: t, detail: 'Table declared in schema.sql but not in DB' });
    }
  }
  return diffs;
}

async function main() {
  const client = await pool.connect();
  try {
    const live = await fetchLiveSchema(client);
    const schemaSqlPath = path.join(__dirname, '..', 'server', 'sql', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
    const declared = parseSchemaSql(schemaSql);

    // write snapshots
    const outDir1 = path.join(__dirname, '..', 'server');
    const outDir2 = path.join(__dirname, '..', 'docs');
    if (!fs.existsSync(outDir2)) fs.mkdirSync(outDir2);
    fs.writeFileSync(path.join(outDir1, 'schema.snapshot.json'), JSON.stringify(live, null, 2));
    let md = '# Live Database Schema (public)\n\n';
    for (const [table, cols] of Object.entries(live)) {
      md += `## ${table}\n\n`;
      for (const c of cols) {
        md += `- ${c.column}: ${c.type}${c.nullable ? ' | NULL' : ' | NOT NULL'}${c.default ? ' | DEFAULT ' + c.default : ''}\n`;
      }
      md += '\n';
    }
    fs.writeFileSync(path.join(outDir2, 'schema.md'), md);

    const diffs = compareSchemas(live, declared);
    if (diffs.length === 0) {
      console.log('✅ Live DB schema matches server/sql/schema.sql (no drift detected).');
    } else {
      console.log('⚠️ Schema drift detected:');
      for (const d of diffs) console.log('-', d);
      const reportPath = path.join(outDir2, 'schema-drift.json');
      fs.writeFileSync(reportPath, JSON.stringify(diffs, null, 2));
      console.log('Drift report written to', reportPath);
    }
  } catch (e) {
    console.error('Schema check failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();


