import fetch from 'node-fetch';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const TOKEN = process.env.AUTH_TOKEN || 'test-token';

// Helper para hacer requests
async function measureRequest(endpoint, method = 'GET', retries = 3) {
  const times = [];
  const errors = [];

  for (let i = 0; i < retries; i++) {
    try {
      const startTime = Date.now();
      const response = await fetch(`${API_URL}${endpoint}`, {
        method,
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const endTime = Date.now();
      const duration = endTime - startTime;
      times.push(duration);

      if (!response.ok) {
        errors.push(`Status: ${response.status}`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  const avg = times.length > 0 ? Math.round(times.reduce((a, b) => a + b) / times.length) : 0;
  const min = times.length > 0 ? Math.min(...times) : 0;
  const max = times.length > 0 ? Math.max(...times) : 0;

  return { avg, min, max, times, errors };
}

// Test endpoints
const endpoints = [
  { name: 'GET /api/documents (Lista)', endpoint: '/api/documents?page=1&limit=20', method: 'GET' },
  { name: 'GET /api/documents (Todo)', endpoint: '/api/documents?page=1&limit=500', method: 'GET' },
  { name: 'GET /api/activities (Lista)', endpoint: '/api/activities?limit=100', method: 'GET' },
  { name: 'GET /api/documents/dashboard', endpoint: '/api/documents/dashboard', method: 'GET' },
];

async function runPerformanceTests() {
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('⚡ PRUEBAS DE PERFORMANCE - TaxControl API');
  console.log('═'.repeat(80));
  console.log(`API URL: ${API_URL}`);
  console.log(`Tiempo: ${new Date().toLocaleString('es-ES')}`);
  console.log('');

  const results = [];

  for (const test of endpoints) {
    process.stdout.write(`Testing: ${test.name.padEnd(40)} ... `);
    const result = await measureRequest(test.endpoint, test.method, 5);
    results.push({ ...test, result });

    if (result.errors.length > 0) {
      console.log(`❌ Error: ${result.errors[0]}`);
    } else {
      console.log(`✅ ${result.avg}ms (min: ${result.min}ms, max: ${result.max}ms)`);
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('📊 RESUMEN DE RESULTADOS');
  console.log('═'.repeat(80));

  console.log('\n┌─ Tiempos Promedio por Endpoint ─────────────────────────────────┐');
  results.forEach(r => {
    const bar = '█'.repeat(Math.round(r.result.avg / 10)).padEnd(50);
    console.log(`│ ${r.name.padEnd(40)} ${r.result.avg.toString().padStart(6)}ms │`);
    console.log(`│ ${bar} │`);
  });
  console.log('└─────────────────────────────────────────────────────────────────┘');

  console.log('\n┌─ Estadísticas Detalladas ───────────────────────────────────────┐');
  results.forEach(r => {
    console.log(`\n${r.name}:`);
    console.log(`  Promedio: ${r.result.avg}ms`);
    console.log(`  Mínimo:   ${r.result.min}ms`);
    console.log(`  Máximo:   ${r.result.max}ms`);
    console.log(`  Tiempos:  [${r.result.times.join(', ')}] ms`);
    if (r.result.errors.length > 0) {
      console.log(`  ⚠️ Errores: ${r.result.errors.join(', ')}`);
    }
  });
  console.log('└─────────────────────────────────────────────────────────────────┘');

  const avgTotal = Math.round(
    results.reduce((sum, r) => sum + r.result.avg, 0) / results.length
  );

  console.log('\n' + '═'.repeat(80));
  console.log(`⏱️  Tiempo Promedio Global: ${avgTotal}ms`);

  if (avgTotal < 100) {
    console.log('🚀 EXCELENTE: Response time muy rápido (< 100ms)');
  } else if (avgTotal < 500) {
    console.log('✅ BUENO: Response time aceptable (< 500ms)');
  } else if (avgTotal < 1000) {
    console.log('⚠️ INTERMEDIO: Response time puede mejorar (< 1s)');
  } else {
    console.log('❌ LENTO: Response time muy lento (> 1s)');
  }

  console.log('═'.repeat(80));
  console.log('\n✨ Pruebas completadas\n');
}

runPerformanceTests().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
