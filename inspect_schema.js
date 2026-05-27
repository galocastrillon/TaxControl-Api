import mysql from 'mysql2/promise';

async function inspectSchema() {
  let connection;

  try {
    console.log('🔄 Conectando a la base de datos...');

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
    console.log('✅ Conexión exitosa\n');

    // ===== ACTIVITIES TABLE =====
    console.log('=' .repeat(80));
    console.log('📋 TABLA: activities');
    console.log('=' .repeat(80));

    const [activitiesColumns] = await connection.execute('DESCRIBE activities');
    console.log('\n🔍 Estructura de la tabla activities:');
    console.log(JSON.stringify(activitiesColumns, null, 2));

    const [activitiesIndexes] = await connection.execute('SHOW INDEX FROM activities');
    console.log('\n📑 Índices en activities:');
    activitiesIndexes.forEach(idx => {
      console.log(`  - ${idx.Key_name}: ${idx.Column_name}`);
    });

    // ===== DOCUMENTS TABLE =====
    console.log('\n' + '=' .repeat(80));
    console.log('📋 TABLA: documents');
    console.log('=' .repeat(80));

    const [documentsColumns] = await connection.execute('DESCRIBE documents');
    console.log('\n🔍 Estructura de la tabla documents:');
    console.log(JSON.stringify(documentsColumns, null, 2));

    const [documentsIndexes] = await connection.execute('SHOW INDEX FROM documents');
    console.log('\n📑 Índices en documents:');
    documentsIndexes.forEach(idx => {
      console.log(`  - ${idx.Key_name}: ${idx.Column_name}`);
    });

    // ===== ACTIVITIES TABLE =====
    console.log('\n' + '=' .repeat(80));
    console.log('📋 TABLA: activities (detalle)');
    console.log('=' .repeat(80));

    // Show CREATE TABLE statement
    const [createActivityStmt] = await connection.execute('SHOW CREATE TABLE activities');
    console.log('\n📝 CREATE TABLE activities:');
    console.log(createActivityStmt[0]['Create Table']);

    console.log('\n✨ ¡Inspección completada!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

inspectSchema();
