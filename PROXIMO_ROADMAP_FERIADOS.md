# 🗓️ Roadmap: Fases 3, 4 y 5 — Sistema Completo de Feriados

## Estado Actual ✅
- **Fase 1**: Endpoints CRUD para gestionar feriados ✅
- **Fase 2**: Panel administrativo en Admin.tsx ✅
- **2026 Pre-poblado**: Feriados Ecuador 2026 con reglas de traslado aplicadas ✅

---

## 📅 FASE 3: Cálculo Automático de Días Hábiles

### Problema que resuelve
Hoy, cuando un documento se crea con "5 días hábiles", la app solo salta sábados y domingos. Si hay un feriado el miércoles, lo cuenta como día laboral y la fecha resulta incorrecta.

```
Ejemplo actual (INCORRECTO):
- Notificación: lunes 10 noviembre 2026
- Días hábiles requeridos: 5
- Hoy ignora: feriado "Día de Difuntos" = 2 noviembre
- Resultado: 17 noviembre (CORRECTO POR COINCIDENCIA)
- Pero si fuera 10 nov + 3 días hábiles sin el feriado en medio = 13 nov (viernes)
- Con feriado 2 nov debería ser 14 nov (lunes) ❌
```

### Implementación necesaria

**Backend** (`TaxControl-Api/index.js`):
```javascript
// Endpoint existente GET /api/holidays?year=2026 ya devuelve:
[
  { id: 1, date: '2026-02-02', name: 'Año Nuevo (trasladado)', type: 'Ordinary' },
  { id: 2, date: '2026-02-17', name: 'Lunes de Carnaval', type: 'Ordinary' },
  ...
]

// Usar esta data en la BD para calcular fechas
```

**Frontend** (`TaxControl/constants.ts`):
```typescript
// Función actual (INCOMPLETA):
export const calculateDueDate = (
  notificationDate: string,
  daysLimit: number,
  dayType: DayType
): string => {
  // Solo salta weekends
  let date = new Date(notificationDate);
  let count = 0;
  
  // TODO: Incorporar holidays array
  while (count < daysLimit) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) { // No es sábado/domingo
      count++;
    }
  }
  return date.toISOString().split('T')[0];
};

// Versión mejorada:
export const calculateDueDate = (
  notificationDate: string,
  daysLimit: number,
  dayType: DayType,
  holidays?: Array<{ date: string }> // NUEVO PARÁMETRO
): string => {
  let date = new Date(notificationDate);
  let count = 0;
  const holidayDates = new Set(holidays?.map(h => h.date) || []);
  
  while (count < daysLimit) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    const dateStr = date.toISOString().split('T')[0];
    
    // NO contar si es: sábado, domingo O feriado
    if (day !== 0 && day !== 6 && !holidayDates.has(dateStr)) {
      count++;
    }
  }
  return date.toISOString().split('T')[0];
};
```

**Frontend** (`TaxControl/pages/DocumentDetail.tsx`):
```typescript
// Al crear/editar documento:
const [document, setDocument] = useState<Document | null>(null);
const [holidays, setHolidays] = useState<Array<{date: string}>>([]);

useEffect(() => {
  // Cargar feriados cuando se carga el documento
  if (document?.notificationDate) {
    const year = new Date(document.notificationDate).getFullYear();
    loadHolidaysForYear(year);
  }
}, [document?.notificationDate]);

const handleCalculateDueDate = () => {
  const newDueDate = calculateDueDate(
    doc.notificationDate,
    doc.daysLimit,
    doc.dayType,
    holidays // ← PASAR FERIADOS
  );
  setDoc({ ...doc, dueDate: newDueDate });
};
```

### Resultado visible
```
Documento creado 10 noviembre 2026 + 3 días hábiles
- Día 1: 11 nov (miércoles)
- Día 2: 12 nov (jueves)
- (feriado 2 nov fue en el pasado)
- Día 3: 13 nov (viernes) ✅ CORRECTO

Documento creado 30 octubre 2026 + 3 días hábiles
- Día 1: 30 oct (viernes)
- Día 2: 2 nov SALTADO (feriado)
- Día 2: 3 nov (martes) ← Continúa del siguiente día laboral
- Día 3: 5 nov (miércoles)
Resultado: 5 nov ✅ CORRECTO
```

### Cambios de archivo
- ✏️ `TaxControl/constants.ts`: Actualizar firma de `calculateDueDate()`
- ✏️ `TaxControl/pages/DocumentDetail.tsx`: Cargar y pasar holidays
- ✏️ `TaxControl/pages/DocumentList.tsx`: Pasar holidays si recalcula fechas

### Complejidad: Media
**Tiempo estimado**: 2-3 horas
**Riesgo**: Bajo (la función es pura, fácil de testear)

---

## 🔧 FASE 4: Override Manual por Documento

### Problema que resuelve
El Gobierno puede decretar un feriado extraordinario con 12 horas de anticipación. Los documentos ya creados con fechas calculadas quedan obsoletos. El operario necesita ajustar manualmente sin perder trazabilidad.

### Implementación necesaria

**Base de datos** (`TaxControl-Api/db.sql`):
```sql
-- Agregar columnas a tabla documents
ALTER TABLE documents ADD COLUMN due_date_override DATE NULL COMMENT 'Fecha ajustada manualmente';
ALTER TABLE documents ADD COLUMN override_reason VARCHAR(500) COMMENT 'Razón del ajuste';
ALTER TABLE documents ADD COLUMN override_by VARCHAR(50) REFERENCES users(id);
ALTER TABLE documents ADD COLUMN override_at TIMESTAMP NULL;

-- Índice para reportes
CREATE INDEX idx_doc_override ON documents(due_date_override, override_at);
```

**Backend** (`TaxControl-Api/index.js`):
```javascript
// Nuevo endpoint para ajustar fecha
app.put("/api/documents/:id/due-date-override", requireAuth, async (req, res) => {
  const { newDueDate, reason } = req.body;
  const { id } = req.params;
  
  // Solo Admins y Operarios
  if (!['Admin', 'Operator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  
  try {
    await pool.query(`
      UPDATE documents 
      SET due_date_override = ?, 
          override_reason = ?,
          override_by = ?,
          override_at = NOW()
      WHERE id = ?
    `, [newDueDate, reason, req.user.user_id, id]);
    
    res.json({ ok: true, newDueDate, overriddenBy: req.user.name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para remover override (volver al cálculo automático)
app.delete("/api/documents/:id/due-date-override", requireAuth, async (req, res) => {
  if (!['Admin', 'Operator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  
  try {
    await pool.query(`
      UPDATE documents 
      SET due_date_override = NULL,
          override_reason = NULL,
          override_by = NULL,
          override_at = NULL
      WHERE id = ?
    `, [req.params.id]);
    
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**Frontend** (`TaxControl/pages/DocumentDetail.tsx`):
```typescript
// En la sección de detalles del documento:
<div className="border-l-4 border-orange-400 bg-orange-50 p-4 rounded">
  <div className="flex justify-between items-start">
    <div>
      <p className="font-bold text-gray-900">Fecha de Vencimiento</p>
      <p className="text-xl font-bold text-gray-900">{doc.dueDate}</p>
      
      {doc.due_date_override && (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-orange-600 font-bold">
            📌 AJUSTADA MANUALMENTE
          </p>
          <p className="text-xs text-gray-600">
            <strong>Fecha ajustada:</strong> {doc.due_date_override}
          </p>
          <p className="text-xs text-gray-600">
            <strong>Razón:</strong> {doc.override_reason}
          </p>
          <p className="text-xs text-gray-500">
            Ajustado por {doc.override_by} el {doc.override_at}
          </p>
        </div>
      )}
    </div>
    
    {['Admin', 'Operator'].includes(currentUser.role) && (
      <button 
        onClick={() => openOverrideModal()} 
        className="px-4 py-2 bg-orange-100 text-orange-700 rounded-lg font-bold text-sm"
      >
        ✏️ Ajustar Fecha
      </button>
    )}
  </div>
</div>

// Modal para ajustar:
{showOverrideModal && (
  <Modal title="Ajustar Fecha de Vencimiento">
    <input 
      type="date" 
      value={newOverrideDate} 
      onChange={e => setNewOverrideDate(e.target.value)}
    />
    <textarea
      placeholder="Razón del ajuste (ej: Feriado extraordinario decreto 2026-XX)"
      value={overrideReason}
      onChange={e => setOverrideReason(e.target.value)}
    />
    <button onClick={handleSaveOverride}>Guardar Ajuste</button>
    {doc.due_date_override && (
      <button onClick={handleRemoveOverride} className="text-red-600">
        Eliminar Ajuste (volver a cálculo automático)
      </button>
    )}
  </Modal>
)}
```

### Resultado visible
```
Documento: "Solicitud Tributaria ECSA"
Fecha de Vencimiento: 15 noviembre 2026

[Feriado extraordinario decretado: 15 nov es ahora feriado]

Operario: Click "Ajustar Fecha"
Ingresa:
  - Nueva fecha: 16 noviembre 2026
  - Razón: "Feriado extraordinario Decreto 2026-45 gobierno nacional"

Resultado:
✓ Fecha de Vencimiento: 15 noviembre 2026
  📌 AJUSTADA MANUALMENTE
  Fecha ajustada: 16 noviembre 2026
  Razón: Feriado extraordinario Decreto 2026-45 gobierno nacional
  Ajustado por Juan Pérez el 2026-11-14 10:23 AM
```

### Cambios de archivo
- 📊 `TaxControl-Api/db.sql`: 4 columnas nuevas en documents
- 📝 `TaxControl-Api/index.js`: 2 endpoints (PUT, DELETE)
- 🎨 `TaxControl/pages/DocumentDetail.tsx`: UI para override + modal
- 🔄 `TaxControl/constants.ts`: Funciones saveDocument/updateDocument incluyen override

### Complejidad: Media
**Tiempo estimado**: 2-3 horas
**Riesgo**: Bajo (no afecta datos históricos, solo agrega nuevos campos)

---

## 📊 FASE 5: Reportes y Analytics

### Problema que resuelve
Auditoría regulatoria: "¿Cuántos documentos fueron afectados por feriados extraordinarios?" "¿Quién ajustó qué y cuándo?"

### Implementación necesaria

**Backend** (`TaxControl-Api/index.js`):
```javascript
// Endpoint de reportes
app.get("/api/reports/holidays-impact", requireAuth, async (req, res) => {
  const { startDate, endDate } = req.query;
  // Solo Admins ven reportes
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Sin permisos' });
  
  try {
    const [data] = await pool.query(`
      SELECT 
        d.id, d.title, d.trarnite_number,
        d.due_date,
        d.due_date_override,
        d.override_reason,
        d.override_by,
        d.override_at,
        u.name as override_by_name
      FROM documents d
      LEFT JOIN users u ON d.override_by = u.id
      WHERE d.due_date_override IS NOT NULL
        AND d.override_at BETWEEN ? AND ?
      ORDER BY d.override_at DESC
    `, [startDate, endDate]);
    
    res.json({
      total: data.length,
      documents: data,
      summary: {
        byReason: aggregateByReason(data),
        byUser: aggregateByUser(data),
        timelineChart: generateTimeline(data)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**Frontend** (`TaxControl/pages/Reports.tsx`):
```typescript
// Nueva página de reportes
const Reports: React.FC = () => {
  const [data, setData] = useState([]);
  const [startDate, setStartDate] = useState(/* 30 días atrás */);
  const [endDate, setEndDate] = useState(/* hoy */);
  
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reportes de Feriados</h1>
      
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h2>Documentos con Fechas Ajustadas Manualmente</h2>
        
        <table>
          <thead>
            <tr>
              <th>Documento</th>
              <th>Trámite</th>
              <th>Fecha Original</th>
              <th>Fecha Ajustada</th>
              <th>Razón</th>
              <th>Ajustado por</th>
              <th>Fecha de Ajuste</th>
            </tr>
          </thead>
          <tbody>
            {data.documents.map(doc => (
              <tr key={doc.id}>
                <td>{doc.title}</td>
                <td>{doc.trarnite_number}</td>
                <td>{doc.due_date}</td>
                <td className="font-bold text-orange-600">{doc.due_date_override}</td>
                <td>{doc.override_reason}</td>
                <td>{doc.override_by_name}</td>
                <td>{doc.override_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <div className="mt-6 grid grid-cols-3 gap-4">
          <Card title="Total Ajustados" value={data.total} />
          <Card title="Razones Principales" value={data.summary.byReason} />
          <Card title="Ajustados por Usuario" value={data.summary.byUser} />
        </div>
      </div>
      
      <button className="bg-primary text-white px-6 py-2 rounded-lg">
        📥 Descargar CSV
      </button>
    </div>
  );
};
```

**Rutas** (`TaxControl/App.tsx`):
```typescript
{currentUser.role === UserRole.ADMIN && (
  <>
    <Route path="/admin" element={<Admin />} />
    <Route path="/reports" element={<Reports />} />  {/* NUEVO */}
  </>
)}
```

### Resultado visible
```
Admin dashboard > Reportes

📊 Resumen
├─ 12 documentos con ajustes manuales este mes
├─ 8 por feriados extraordinarios
├─ 3 por corrección de errores de cálculo
└─ 1 por solicitud del usuario

Tabla de documentos ajustados:
┌─────────────────────────────────────────────────────────────┐
│ Documento          │ Original  │ Ajustado  │ Razón          │
├─────────────────────────────────────────────────────────────┤
│ Solicitud ECSA     │ 15 nov    │ 16 nov    │ Decreto 2026-45│
│ Aviso EXSA         │ 20 nov    │ 21 nov    │ Error cálculo  │
│ ...                │ ...       │ ...       │ ...            │
└─────────────────────────────────────────────────────────────┘

[📥 Descargar CSV] [Imprimir]
```

### Cambios de archivo
- 📝 `TaxControl-Api/index.js`: 1-2 endpoints de reportes
- 🎨 `TaxControl/pages/Reports.tsx`: Nueva página (crear)
- 🔀 `TaxControl/App.tsx`: Agregar ruta /reports
- 🔗 `TaxControl/pages/Admin.tsx`: Link a Reports

### Complejidad: Alta
**Tiempo estimado**: 3-4 horas
**Riesgo**: Bajo (es solo lectura, sin impacto en datos)

---

## 📈 Resumen de Esfuerzo

| Fase | Impacto | Esfuerzo | Riesgo | Orden |
|------|---------|----------|--------|-------|
| 3 | 🔴 Alto | 🟡 Medio | 🟢 Bajo | 1️⃣ **Primero** |
| 4 | 🔴 Alto | 🟡 Medio | 🟢 Bajo | 2️⃣ Segundo |
| 5 | 🟡 Medio | 🔴 Alto | 🟢 Bajo | 3️⃣ Tercero |

---

## 🚀 Decisiones de Diseño

### Fase 3 + 4: Cómo interactúan
```
Flujo normal:
1. Usuario crea documento con "5 días hábiles"
2. calculateDueDate() usa feriados de BD → calcula automáticamente
3. Resultado: 15 noviembre 2026

Flujo con feriado sorpresa:
1. Documento existe con fecha 15 noviembre
2. Gobierno decreta feriado extraordinario el 15
3. Operario: Click "Ajustar Fecha" → nueva fecha: 16 noviembre
4. due_date_override = 16 noviembre (override_reason registrado)
5. Sistema muestra 📌 AJUSTADA MANUALMENTE
6. Si en Fase 3 se agrega nuevo feriado a BD, calculateDueDate NO recalcula
   (porque override existe y tiene prioridad)
```

### Prioridad de fecha mostrada
```javascript
// En GET /api/documents/:id
dueDate: doc.due_date_override || doc.due_date  // Override primero
```

### Auditoría completa
```
Cada vez que se ajusta una fecha manualmente:
✓ Quién lo hizo (req.user.id)
✓ Cuándo (override_at timestamp)
✓ Por qué (override_reason texto libre)
✓ Qué fecha (due_date_override)
✓ Cómo revertir (DELETE endpoint)
```

---

## ✅ Checklist por Fase

### Fase 3 ✓ Antes de iniciar
- [ ] Función calculateDueDate() testeable con array de feriados
- [ ] Frontend carga holidays al editar documento
- [ ] Documentos creados en DocumentList mostrar fecha correcta
- [ ] Tests: 5 casos de prueba con diferentes feriados

### Fase 4 ✓ Antes de iniciar
- [ ] Columnas en DB creadas y migradas
- [ ] Endpoints CRUD funcionan
- [ ] Modal de ajuste usa apiFetch() correctamente
- [ ] Visualización de override clara en UI

### Fase 5 ✓ Antes de iniciar
- [ ] Página /reports solo accesible a Admins
- [ ] Reportes cargan datos correctamente
- [ ] Exportación CSV bien formateada
- [ ] Gráficos/resúmenes precisos

---

## 📞 Preguntas Frecuentes

**P: ¿Qué pasa si alguien crea un documento antes de la Fase 3?**
A: Los documentos existentes conservan su fecha. Cuando se editan después de implementar Fase 3, se recalculan con feriados.

**P: ¿Override cancela Fase 3?**
A: Sí. Si existe `due_date_override`, la fecha mostrada es esa (no se recalcula automáticamente).

**P: ¿Se pueden eliminar feriados del admin panel?**
A: Sí. En ese caso, documentos ya creados conservan sus fechas (no se recalculan solos). Solo nuevos documentos usan la nueva configuración.

**P: ¿Histórico de cambios en fecha?**
A: No está en el diseño actual (Fase 5 es solo "modificación actual"). Se puede agregar una tabla `document_overrides_history` en futuras mejoras.

---

## 🔗 Referencias
- Ley Orgánica Reformatoria a la Ley Orgánica del Servicio Público (Ecuador)
- Código del Trabajo Ecuador - Artículos sobre feriados
- db.sql: Tabla holidays pre-poblada 2024-2026
