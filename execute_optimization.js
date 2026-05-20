import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function executeOptimization() {
  let connection;

  try {
    console.log('🔄 Conectando a la base de datos...');

    // Create connection pool
    const pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'tax_control',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    connection = await pool.getConnection();
    console.log('✅ Conexión exitosa a la base de datos');

    // Read the SQL file
    const sqlFile = path.join(__dirname, 'optimize_indexes_fixed.sql');
    console.log(`📄 Leyendo archivo SQL: ${sqlFile}`);

    if (!fs.existsSync(sqlFile)) {
      throw new Error(`SQL file not found: ${sqlFile}`);
    }

    const sqlContent = fs.readFileSync(sqlFile, 'utf-8');

    // Split into individual statements (handle comments and empty lines)
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt && !stmt.startsWith('--'));

    console.log(`\n⚡ Ejecutando ${statements.length} comandos SQL...\n`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      try {
        await connection.execute(statement);
        successCount++;
        const preview = statement.substring(0, 80).replace(/\n/g, ' ');
        console.log(`✅ [${i + 1}/${statements.length}] ${preview}${statement.length > 80 ? '...' : ''}`);
      } catch (error) {
        errorCount++;
        const preview = statement.substring(0, 80).replace(/\n/g, ' ');
        console.log(`❌ [${i + 1}/${statements.length}] Error: ${error.message}`);
        console.log(`   Statement: ${preview}${statement.length > 80 ? '...' : ''}`);
      }
    }

    console.log(`\n📊 Resumen:`);
    console.log(`   ✅ Exitosos: ${successCount}`);
    console.log(`   ❌ Con errores: ${errorCount}`);
    console.log(`   Total: ${statements.length}`);

    // Verify indexes were created
    console.log('\n🔍 Verificando índices creados en tabla documents...');
    try {
      const [indexes] = await connection.execute('SHOW INDEX FROM documents');
      console.log(`   Total de índices: ${indexes.length}`);
      console.log('   Índices:');
      const indexNames = [...new Set(indexes.map(idx => idx.Key_name))];
      indexNames.forEach(name => {
        console.log(`     - ${name}`);
      });
    } catch (error) {
      console.log(`   Error al verificar índices: ${error.message}`);
    }

    console.log('\n✨ ¡Optimización completada!');
    process.exit(successCount > 0 ? 0 : 1);

  } catch (error) {
    console.error('❌ Error fatal:', error.message);
    console.error(error);
    process.exit(1);
  }
}

executeOptimization();
