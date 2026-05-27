import http from 'http';

const API_HOST = process.env.API_HOST || 'localhost';
const API_PORT = process.env.API_PORT || 3001;
const TOKEN = process.env.AUTH_TOKEN || 'test-token';

// Helper para hacer requests HTTP
function makeRequest(path) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        resolve({ duration, status: res.statusCode, error: null });
      });
    });

    req.on('error', (error) => {
      const endTime = Date.now();
      resolve({ duration: endTime - startTime, status: 0, error: error.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ duration: 30000, status: 0, error: 'Timeout' });
    });

    req.end();
  });
}

async function measureEndpoint(path, name, iterations = 5) {
  const times = [];
  const errors = [];

  for (let i = 0; i < iterations; i++) {
    const result = await makeRequest(path);
    if (result.error) {
      errors.push(result.error);
    } else {
      times.push(result.duration);
    }
  }

  const avg = times.length > 0 ? Math.round(times.reduce((a, b) => a + b) / times.length) : 0;
  const min = times.length > 0 ? Math.min(...times) : 0;
  const max = times.length > 0 ? Math.max(...times) : 0;

  return { name, path, avg, min, max, times, errors };
}

async function runTests() {
  console.log('\n');
  console.log('═'.repeat(90));
  console.log('⚡ PRUEBAS DE PERFORMANCE - TaxControl API');
  console.log('═'.repeat(90));
  console.log(`🌐 API: http://${API_HOST}:${API_PORT}`);
  console.log(`📅 Tiempo: ${new Date().toLocaleString('es-ES')}`);
  console.log('');

  const tests = [
    { path: '/api/documents?page=1&limit=20', name: 'GET /api/documents (lista 20)' },
    { path: '/api/documents?page=1&limit=100', name: 'GET /api/documents (lista 100)' },
    { path: '/api/activities?limit=100', name: 'GET /api/activities (lista)' },
    { path: '/api/documents/dashboard', name: 'GET /api/documents/dashboard' },
  ];

  const results = [];

  console.log('🔄 Ejecutando 5 iteraciones por endpoint...\n');

  for (const test of tests) {
    process.stdout.write(`  ${test.name.padEnd(50)} ... `);
    const result = await measureEndpoint(test.path, test.name, 5);
    results.push(result);

    if (result.errors.length > 0) {
      console.log(`❌ ${result.errors[0]}`);
    } else {
      console.log(`✅ ${result.avg}ms`);
    }
  }

  console.log('\n' + '═'.repeat(90));
  console.log('📊 RESULTADOS DETALLADOS');
  console.log('═'.repeat(90));

  results.forEach(r => {
    console.log(`\n${r.name}`);
    console.log(`  Endpoint: ${r.path}`);
    console.log(`  ├─ Promedio: ${r.avg}ms`);
    console.log(`  ├─ Mínimo:   ${r.min}ms`);
    console.log(`  ├─ Máximo:   ${r.max}ms`);
    console.log(`  └─ Tiempos:  [${r.times.join(', ')}] ms`);
    if (r.errors.length > 0) {
      console.log(`  ⚠️ Errores: ${r.errors.join(', ')}`);
    }
  });

  const avgGlobal = Math.round(
    results.reduce((sum, r) => sum + r.avg, 0) / results.length
  );

  console.log('\n' + '═'.repeat(90));
  console.log('🎯 RESUMEN');
  console.log('═'.repeat(90));
  console.log(`⏱️  Tiempo Promedio Global: ${avgGlobal}ms\n`);

  if (avgGlobal < 100) {
    console.log('🚀 EXCELENTE: Response time muy rápido (< 100ms)');
  } else if (avgGlobal < 300) {
    console.log('✅ MUY BUENO: Response time rápido (< 300ms)');
  } else if (avgGlobal < 500) {
    console.log('✅ BUENO: Response time aceptable (< 500ms)');
  } else if (avgGlobal < 1000) {
    console.log('⚠️ INTERMEDIO: Response time puede mejorar (< 1s)');
  } else {
    console.log('❌ LENTO: Response time muy lento (> 1s)');
  }

  console.log('═'.repeat(90) + '\n');
}

runTests().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
