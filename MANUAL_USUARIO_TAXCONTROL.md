# 📚 Manual de Usuario - TaxControl

**Una herramienta simple y segura para gestionar tus obligaciones tributarias**

---

## 📖 Tabla de Contenidos

1. [Bienvenida](#bienvenida)
2. [Inicio de Sesión](#inicio-de-sesión)
3. [Panel Principal (Dashboard)](#panel-principal-dashboard)
4. [Gestión de Documentos](#gestión-de-documentos)
5. [Crear y Editar Actividades](#crear-y-editar-actividades)
6. [Registrar Contestaciones](#registrar-contestaciones)
7. [Gestión de Feriados](#gestión-de-feriados)
8. [Centro de Alertas](#centro-de-alertas)
9. [Tu Perfil](#tu-perfil)
10. [Preguntas Frecuentes](#preguntas-frecuentes)

---

## 🎯 Bienvenida

¡Hola! Bienvenido a **TaxControl**, tu asistente para gestionar documentos tributarios de forma simple y organizada.

Esta herramienta te ayuda a:
- 📁 **Guardar y organizar** todos tus documentos tributarios
- ✅ **Crear tareas** para no olvidar lo que tienes que hacer
- 💬 **Registrar contestaciones** con autoridades
- 🚨 **Recibir alertas** sobre fechas importantes
- 📊 **Ver un resumen** de todo lo que tienes pendiente

No requiere conocimientos técnicos. ¡Es muy fácil de usar!

---

## 🔐 Inicio de Sesión

### Primer Acceso

1. **Abre TaxControl** en tu navegador
2. **Ingresa tu correo electrónico** en el campo "Email"
3. **Ingresa tu contraseña**
4. **Haz clic** en "Iniciar Sesión"

### ¿Olvidaste tu contraseña?

Si olvidaste tu contraseña:
1. Haz clic en "¿Olvidaste tu contraseña?" (si está disponible)
2. O contacta a tu administrador para que te ayude a recuperarla

### Cerrar Sesión

- En cualquier momento, busca tu **nombre o avatar** en la esquina superior derecha
- Haz clic en **"Cerrar Sesión"**

---

## 📊 Panel Principal (Dashboard)

El **Dashboard** es tu punto de entrada a TaxControl. Aquí verás un resumen de todo lo importante.

### ¿Qué ves en el Dashboard?

```
┌─────────────────────────────────────────┐
│  NÚMEROS IMPORTANTES (Estadísticas)      │
├─────────────────────────────────────────┤
│  • Total de Documentos                  │
│  • Documentos En Progreso                │
│  • Plazos Próximos (en los próximos días)│
│  • Plazos Vencidos ⚠️                    │
└─────────────────────────────────────────┘
```

### Secciones del Dashboard

#### 1️⃣ **Números Clave**
Arriba del todo, verás 4 tarjetas con números:
- **Total Documentos**: Cuántos documentos tienes registrados
- **En Progreso**: Documentos que aún necesitan acciones
- **Próximos 7 días**: Documentos que vencen en una semana
- **Vencidos**: ⚠️ Documentos cuya fecha ya pasó (¡atención!)

#### 2️⃣ **Gráfico de Estado**
Un gráfico de pastel que muestra el porcentaje de documentos por estado:
- 🟢 Completado
- 🟡 En Progreso
- 🔴 Vencido

⚡ **¡Novedad!** El gráfico ahora **se actualiza automáticamente** cuando aplicas filtros (por empresa o autoridad). Si filtras por "SRI", verás solo documentos de esa autoridad en el gráfico.

#### 3️⃣ **Alertas**
Tres secciones de alertas:
- **🔴 Atención Requerida**: Documentos vencidos (¡urgente!)
- **🟠 Próximos Vencimientos**: Que vencen en 7 días (muy pronto)
- **🟡 Planificación**: Que vencen en 15 días (ten en cuenta)

#### 4️⃣ **Últimos Documentos**
Una tabla con los documentos que más recientemente agregaste o modificaste.

### Filtros

En el Dashboard puedes **filtrar por**:
- **Empresa**: Si trabajas con varias empresas, selecciona una
- **Autoridad**: Para ver solo documentos de una autoridad específica

---

## 📁 Gestión de Documentos

### 📋 Ver Todos los Documentos

Para ver la lista completa de todos tus documentos:

1. Haz clic en **"Documentos"** en el menú lateral izquierdo
2. Verás todos tus documentos **organizados por año y mes**

### 📂 Organización por Año y Mes

Los documentos se muestran así:
```
📅 2026
   ├─ Mayo ▼
   │  ├─ Documento 1
   │  ├─ Documento 2
   │  └─ Documento 3
   ├─ Abril ▲ (contraído)
   └─ Marzo ▲ (contraído)
```

**Para expandir o contraer:**
- Haz clic en **"▼"** (abrir) o **"▲"** (cerrar) al lado del mes/año
- Verás la lista de documentos de ese período

### 🔍 Buscar un Documento

En la parte superior del listado de documentos:
1. Escribe el **nombre, autoridad o número** que buscas
2. La búsqueda es en **tiempo real** (mientras escribes, se filtra)
3. Los resultados aparecen inmediatamente

### 📄 Ver Detalles de un Documento

Cuando hagas clic en un documento, verás:
- **Información General**: Empresa, autoridad, departamento
- **Fechas Importantes**: Notificación, vencimiento, días límite
- **Resúmenes**: El contenido del documento en español y chino
- **Actividades**: Tareas asociadas a este documento
- **Contestaciones**: Respuestas registradas
- **Log de Auditoría**: Quién creó, editó y cuándo

---

## ➕ Agregar un Nuevo Documento

### Paso a Paso para Cargar un Documento

#### Paso 1: Ir a la sección de carga
1. En el menú izquierdo, haz clic en **"Nuevos Documentos"** (o el botón "➕ Agregar")
2. Se abrirá un formulario

#### Paso 2: Seleccionar el archivo
1. Haz clic en **"Seleccionar archivo"** o **"Arrastra aquí"**
2. Elige **cualquier tipo de archivo** (PDF, imágenes, Word, Excel, etc.)
3. El sistema analizará automáticamente el documento usando IA 🤖
4. **Espera a que termine el análisis** (unos segundos)

⚡ **¡Novedad!** La IA ahora detecta automáticamente:
   - **La empresa** (si el documento menciona ECSA, EXSA, HCSA, PCSA o MMSA)
   - **La autoridad** (y la normaliza automáticamente)
   - Puedes dejarlas como están si la IA las detectó correctamente

#### Paso 3: Completar la información básica

| Campo | ¿Qué es? | Ejemplo |
|-------|---------|---------|
| **Empresa/Compañía** | ¿A cuál empresa pertenece? | 🤖 Auto-detectado: ECSA, EXSA, HCSA, PCSA o MMSA |
| **Título del Documento** | Nombre corto y descriptivo | "Notificación de Impuesto a la Renta" |
| **Autoridad** | ¿Quién emitió el documento? | 🤖 Auto-detectado y normalizado: "Servicio de Rentas Internas (SRI)" |
| **Departamento** | Área de la autoridad (opcional) | "Tributación", "Catastros" |

**💡 Nota sobre Autoridades:** El sistema normaliza automáticamente los nombres de autoridades. Por ejemplo, si el documento dice "SRI", "Servicio de Rentas Internas" o cualquier variación, quedará registrado como "Servicio de Rentas Internas (SRI)" para mantener consistencia en la base de datos.

#### Paso 4: Información de plazos

| Campo | ¿Qué es? | Ejemplo |
|-------|---------|---------|
| **Fecha de Notificación** | ¿Cuándo recibiste el documento? | 20/05/2026 |
| **Número de Trámite** | Número único del documento | 123456-789 |
| **Número de Documento** | Resolución, acta, etc. | RES-2026-0001 |
| **Plazo en Días** | ¿Cuántos días tienes para responder? | 30 |
| **Tipo de Plazo** | ¿Contando qué días? | Días hábiles o Días calendario |

#### Paso 5: Resúmenes del documento

El sistema ya habrá extraído información automáticamente, pero puedes editarla:

- **Resumen en Español**: ¿De qué trata el documento? (escribe en tu idioma)
- **Resumen en Chino**: La misma información pero en chino (si aplica)

#### Paso 6: Relacionar con documento anterior

Si este documento es continuación de otro:
1. Haz clic en **"Relacionar con documento anterior"**
2. Selecciona el documento anterior

#### Paso 7: Guardar

Haz clic en **"Guardar Documento"**

✅ ¡Documento cargado exitosamente!

### 📝 Editar un Documento Existente

1. Abre el documento que quieres editar
2. Busca el botón **"Editar"** o **"Actualizar"**
3. Modifica los campos que necesites
4. Haz clic en **"Guardar Cambios"**

### 🗑️ Eliminar un Documento

⚠️ **Cuidado**: Esta acción no se puede deshacer

1. Abre el documento que quieres eliminar
2. Busca el botón **"Eliminar"** (generalmente en rojo)
3. Confirma que deseas eliminarlo
4. El documento se eliminará permanentemente

### 📊 Exportar Documentos a Excel

Si necesitas una copia de tus documentos:

1. En la lista de documentos, busca el botón **"Exportar"** o **"Descargar CSV"**
2. Se descargará un archivo Excel con todos tus documentos y sus actividades
3. Puedes abrirlo en Excel, Google Sheets, etc.

---

## ✅ Crear y Editar Actividades

Las **actividades** son tareas que necesitas hacer relacionadas a un documento.

### ¿Qué son las Actividades?

Son recordatorios para ti de lo que tienes que hacer. Por ejemplo:
- "Reunirse con contador para revisar documento"
- "Preparar respuesta para la autoridad"
- "Enviar documentación adicional"

### ➕ Crear una Actividad

#### Paso 1: Abre el documento
1. Busca el documento relacionado
2. Haz clic para ver sus detalles

#### Paso 2: Accede a la sección de actividades
En la misma página, busca la sección **"Actividades a Realizar"**

#### Paso 3: Haz clic en "➕ Agregar Actividad"

Se abrirá un formulario con estos campos:

| Campo | ¿Qué es? | Ejemplo |
|-------|---------|---------|
| **Descripción** | ¿Qué tienes que hacer? | "Revisar documento con el abogado" |
| **Fecha de Vencimiento** | ¿Para cuándo? | 25/05/2026 |
| **Prioridad** | ¿Qué tan urgente es? | 🔴 Alta, 🟡 Media, 🟢 Baja |
| **Responsable** | ¿Quién la va a hacer? | Tu nombre (predeterminado) |

#### Paso 4: Haz clic en "Crear Actividad"

✅ ¡Actividad creada! Verás en el Dashboard y en Alertas.

### ✏️ Editar una Actividad

1. En la sección de actividades, busca la que quieres editar
2. Haz clic en el botón **"Editar"** o el **lápiz** (✏️)
3. Modifica lo que necesites
4. Haz clic en **"Guardar"**

### ✔️ Marcar Actividad como Completada

Cuando termines una actividad:
1. Busca la actividad en la lista
2. Haz clic en la **casilla de verificación** (☐ → ☑️)
3. La actividad desaparecerá del listado de pendientes
4. Se registrará automáticamente la fecha en que la completaste

### 🗑️ Eliminar una Actividad

1. Busca la actividad que quieres eliminar
2. Haz clic en el botón **"Eliminar"** (🗑️ o rojo)
3. Confirma la eliminación
4. La actividad se borrará

### 📌 Mis Actividades Pendientes

En cualquier momento, para ver **todas tus actividades pendientes**:
1. Ve a la sección **"Alertas"** en el menú
2. Busca la sección **"Otras Actividades Pendientes"**
3. Verás todas tus tareas incompletas

---

## 💬 Registrar Contestaciones

Las **contestaciones** son tus respuestas formales a las autoridades.

### ¿Qué es una Contestación?

Son documentos que envías para responder a una notificación o requerimiento de una autoridad. Por ejemplo:
- Una respuesta a una "Orden de Deuda"
- Aclaración sobre impuestos
- Solicitud de prórroga

### ➕ Registrar una Contestación

#### Paso 1: Abre el documento
1. Ve a **"Documentos"**
2. Busca el documento a que responderás
3. Haz clic para ver detalles

#### Paso 2: Ve a la sección de Contestaciones
En la misma página, busca **"Contestaciones"**

#### Paso 3: Haz clic en "➕ Agregar Contestación"

Se abrirá un formulario:

| Campo | ¿Qué es? | Opciones |
|-------|---------|---------|
| **Descripción** | ¿Qué escribes en la contestación? | Tu texto libre |
| **Fecha de Registro** | ¿Cuándo enviaste la respuesta? | Fecha (hoy o antes) |
| **Método de Contacto** | ¿Cómo la enviaste? | • Ventanilla Física<br>• Correo Electrónico<br>• Plataforma Digital |

#### Paso 4: (Opcional) Adjunta un archivo

Si tienes copia del documento:
1. Haz clic en **"Adjuntar Archivo"**
2. Selecciona el PDF o imagen
3. Se adjuntará al registro

#### Paso 5: Haz clic en "Guardar Contestación"

✅ ¡Contestación registrada!

### ✏️ Editar una Contestación

1. En la sección de contestaciones, busca la que quieres editar
2. Haz clic en **"Editar"** (✏️)
3. Modifica lo que necesites
4. Haz clic en **"Guardar Cambios"**

El sistema registrará quién editó y cuándo.

### 🗑️ Eliminar una Contestación

1. Busca la contestación que quieres eliminar
2. Haz clic en el botón **"Eliminar"** (🗑️)
3. Confirma
4. Se borrará permanentemente

### 📎 Ver Archivos Adjuntos

Si una contestación tiene archivos:
1. Busca la contestación
2. Haz clic en **"Ver Archivo"** o **"Descargar"**
3. Se abrirá o descargará el archivo

---

## 🗓️ Gestión de Feriados

Los **feriados** son días en que no hay jornada laboral en Ecuador. TaxControl usa esta información para calcular correctamente las fechas de vencimiento, considerando solo días hábiles.

### ¿Por qué es importante?

Cuando un documento tiene plazo de "30 días hábiles", TaxControl necesita saber cuáles son los feriados para no contar fines de semana ni días festivos. Esto es especialmente importante en Ecuador, donde existen reglas especiales de traslado de feriados.

### ✨ Ley de Traslados de Feriados en Ecuador

Ecuador tiene una ley especial que traslada los feriados cuando caen en ciertos días de la semana:
- **Domingo → Lunes** siguiente
- **Martes → Lunes** anterior
- **Miércoles → Viernes** siguiente
- **Jueves → Viernes** siguiente
- **Lunes y Viernes** → se mantienen

Por ejemplo:
- Si "Navidad" (25 de diciembre) cae un martes, se celebra el **lunes anterior**
- Si cae un domingo, se celebra el **lunes siguiente**

✅ **TaxControl calcula esto automáticamente** para asegurar las fechas correctas.

### 📋 Ver y Gestionar Feriados

#### Para Administradores

Si tienes rol de **Administrador**, puedes gestionar el calendario de feriados:

1. En el menú izquierdo, busca **"Configuración"** o **"Administración"**
2. Selecciona **"Gestión de Feriados"** o **"Calendario de Feriados"**
3. Verás una tabla con:
   - **Fecha Oficial**: El día que es oficialmente feriado
   - **Fecha de Descanso**: El día que se descansa (aplicando la ley de traslados)
   - **Nombre**: "Navidad", "Carnaval", etc.
   - **Tipo**: Ordinario o Extraordinario

#### ➕ Agregar un Feriado Extraordinario

Si el gobierno declara un feriado extraordinario:

1. En la página de Feriados, haz clic en **"➕ Agregar Feriado"**
2. Completa:
   - **Fecha Oficial**: Cuándo es el feriado (ej: 15/06/2026)
   - **Nombre**: "Feriado por contingencia" o lo que sea
   - **Tipo**: Selecciona "Extraordinario"
3. Haz clic en **"Guardar"**

✅ El sistema aplicará automáticamente la ley de traslados y recalculará todas las fechas de vencimiento.

#### ✏️ Editar un Feriado

1. Busca el feriado en la tabla
2. Haz clic en el botón **"Editar"** (✏️)
3. Modifica lo que necesites
4. Haz clic en **"Guardar Cambios"**

El sistema recalculará automáticamente todos los documentos afectados.

#### 🗑️ Eliminar un Feriado

⚠️ **Cuidado**: Eliminar un feriado recalculará todas las fechas de vencimiento

1. Busca el feriado en la tabla
2. Haz clic en **"Eliminar"** (🗑️)
3. Confirma la eliminación

### 📅 Impacto en Cálculos de Vencimiento

**Ejemplo práctico:**

Documento recibido: **15 de mayo de 2026**
Plazo: **30 días hábiles**

Sin los feriados, sería: **14 de junio de 2026**

Pero con feriados de Ecuador:
- 25/05 = Descanso de Pichincha (sábado anterior)
- 01/06 = Descanso de trabajo
- **Resultado**: **16 de junio de 2026** (¡2 días más!)

✅ TaxControl calcula todo esto automáticamente.

### 📊 Calendarios Anuales

El sistema mantiene calendarios para cada año:
- **2024**: Feriados completados
- **2025**: Feriados completados
- **2026**: Feriados actualizados con información oficial
- **Próximos años**: Se actualizarán cuando se declaren los feriados

### 💡 Consejos

- ✅ Revisa los feriados al principio del año
- ✅ Si hay un feriado extraordinario, actualiza el calendario inmediatamente
- ✅ Los vencimientos se recalculan automáticamente al actualizar feriados
- ✅ Siempre verifica la fecha de vencimiento final antes de enviar respuesta

---

## 🚨 Centro de Alertas

El **Centro de Alertas** es tu zona de "atención requerida". Aquí TaxControl te avisa de lo más importante.

### Acceder a Alertas

En el menú izquierdo, haz clic en **"Alertas"**

### Las 3 Secciones de Alertas

#### 🔴 ATENCIÓN REQUERIDA (Crítico)
**¿Qué ves aquí?**
- Documentos cuyos plazos ya vencieron
- Actividades urgentes sin completar
- ⚠️ **ACTÚA YA**: Estos están retrasados

**Acciones disponibles:**
- Haz clic en la actividad para completarla (☑️)
- Haz clic en el documento para ver detalles
- Asigna una nueva fecha si es necesario

#### 🟠 PRÓXIMOS VENCIMIENTOS (7 días)
**¿Qué ves aquí?**
- Documentos que vencen en los próximos 7 días
- Actividades que vencen pronto
- 📅 **PREPÁRATE**: No hay mucho tiempo

**Acciones disponibles:**
- Crea actividades para empezar a responder
- Contacta a tu equipo para coordinar

#### 🟡 PLANIFICACIÓN (15 días)
**¿Qué ves aquí?**
- Documentos que vencen en 8-15 días
- Actividades con plazo más amplio
- 📋 **TEN PRESENTE**: Hay tiempo, pero prepárate

---

## 👤 Tu Perfil

Para acceder a tus configuraciones personales:

### Acceder a tu Perfil

1. En la esquina **superior derecha**, busca tu **nombre o foto**
2. Haz clic en él
3. Selecciona **"Mi Perfil"** o **"Configuración"**

### ¿Qué puedes cambiar?

#### 📝 Información Personal

- **Nombre**: Edítalo si cambió tu nombre
- **Email**: Solo lectura (el administrador lo cambió cuando creó tu cuenta)
- **Avatar/Foto**: Puedes subir tu foto
- **Rol**: Tu nivel de acceso (Admin, Operador, Lector) - lo define el administrador

#### 🔐 Cambiar Contraseña

1. En el perfil, busca **"Cambiar Contraseña"**
2. **Ingresa tu contraseña actual**
3. **Escribe la nueva contraseña** (mínimo 8 caracteres)
4. **Confirma la nueva contraseña** (debe ser igual)
5. Haz clic en **"Actualizar"**

✅ Contraseña cambiad exitosamente

**Consejos de Seguridad:**
- ✔️ Usa contraseñas fuertes (con números, mayúsculas y símbolos)
- ✔️ No compartas tu contraseña
- ✔️ Cambia regularmente tu contraseña

### 🌐 Cambiar Idioma

En algunos casos, puedes cambiar entre:
- 🇪🇸 Español
- 🇨🇳 Chino

---

## 📚 Preguntas Frecuentes

### ❓ Preguntas sobre Documentos

**P: ¿Qué información necesito para cargar un documento?**
R: Necesitas:
- El archivo del documento (PDF o imagen)
- Empresa
- Autoridad que lo emitió
- Fecha de notificación
- Plazo en días
- Eso es lo mínimo. Los otros campos son opcionales.

**P: ¿El sistema entiende automáticamente qué dice el documento?**
R: Sí, usa IA inteligente para leer y analizar automáticamente el documento. Además:
- Detecta automáticamente **qué empresa emitió o recibió** el documento
- Identifica automáticamente la **autoridad** (SRI, IESS, Municipio, etc.)
- Normaliza los nombres de autoridades (si dice "SRI" o "Servicio de Rentas Internas", queda como "Servicio de Rentas Internas (SRI)")

Siempre revisa que la información sea correcta antes de guardar.

**P: ¿Puedo editar un documento después de cargarlo?**
R: Sí, completo. Haz clic en "Editar" y modifica lo que necesites.

**P: ¿Qué pasa si elimino un documento por error?**
R: Desafortunadamente, se borra permanentemente. Sé cuidadoso con la opción Eliminar.

**P: ¿Puedo descargar copias de mis documentos?**
R: Sí, usa la opción "Exportar" para descargar todos tus documentos en Excel.

---

### ❓ Preguntas sobre Actividades

**P: ¿Qué diferencia hay entre una Actividad y una Contestación?**
R: 
- **Actividad**: Tareas que TÚ haces internamente (revisar, preparar, etc.)
- **Contestación**: La respuesta formal que ENVÍAS a la autoridad

**P: ¿Se pierden las actividades completadas?**
R: No, quedan guardadas en el historial pero dejan de mostrarse en el listado de pendientes. Puedes verlas en el log de auditoría del documento.

**P: ¿Puedo crear una actividad sin documento?**
R: No, las actividades siempre están asociadas a un documento específico.

**P: ¿Quién recibe notificación cuando creo una actividad?**
R: Normalmente, el responsable asignado. Tu administrador puede configurar notificaciones por email.

---

### ❓ Preguntas sobre Contestaciones

**P: ¿Debo adjuntar el archivo de la contestación?**
R: No es obligatorio, pero es recomendable tener un registro de lo que enviaste.

**P: ¿Qué métodos de contacto puedo registrar?**
R: Tres opciones:
- 🏢 **Ventanilla Física**: Entrega en persona
- 📧 **Correo Electrónico**: Enviada por email
- 💻 **Plataforma Digital**: Registrado en sistema de la autoridad

**P: ¿Puedo editar una contestación después de registrarla?**
R: Sí, siempre puedes editarla. El sistema guardará quién la editó y cuándo.

**P: ¿Qué tipos de archivo puedo subir?**
R: Ahora soportamos **cualquier tipo de archivo**: PDF, imágenes (JPG, PNG), Word, Excel, documentos de texto, etc. La IA analizará aquellos que pueda interpretar (PDF e imágenes principalmente).

**P: ¿Qué son las "autoridades normalizadas"?**
R: El sistema estandariza los nombres de autoridades para mantener consistencia. Por ejemplo:
- "SRI" → "Servicio de Rentas Internas (SRI)"
- "IESS" → "IESS"
- "Municipio" → "Municipio"

Esto hace que tus reportes y filtros funcionen correctamente, sin problemas por variaciones de nombres.

---

### ❓ Preguntas sobre Feriados

**P: ¿Cómo afectan los feriados a mis fechas de vencimiento?**
R: Los feriados se restan automáticamente de los cálculos. Si tienes plazo de "30 días hábiles" y hay 5 feriados en ese período, TaxControl sumará días adicionales para compensar.

**P: ¿Qué pasa si hay un feriado extraordinario?**
R: Si el gobierno declara un nuevo feriado, un administrador debe agregarlo en "Gestión de Feriados". Una vez agregado, TaxControl recalculará automáticamente todas las fechas de vencimiento afectadas.

**P: ¿Se aplica la ley de traslado de feriados?**
R: Sí, automáticamente. Si un feriado cae en martes, se traslada al lunes anterior. Si cae en miércoles, al viernes siguiente. El sistema lo calcula según la ley ecuatoriana.

**P: ¿Los fines de semana (sábados y domingos) también se restan?**
R: Sí, si tienes plazo de "días hábiles", los fines de semana no se cuentan. Aunque si tienes plazo de "días calendario", todos los días se cuentan incluyendo fines de semana.

---

### ❓ Preguntas sobre Alertas

**P: ¿Por qué veo un documento en varias alertas?**
R: Un documento puede tener múltiples actividades con diferentes fechas de vencimiento, por eso aparece en distintas secciones.

**P: ¿Cómo hago que una alerta desaparezca?**
R: Completa la actividad asociada. Cuando la marques como ✔️, desaparecerá de "Próximos Vencimientos".

**P: ¿Puedo silenciar las alertas?**
R: Esto depende de tu administrador. Contactalo si quieres cambiar la configuración de notificaciones.

---

### ❓ Preguntas sobre Seguridad

**P: ¿Es seguro guardar documentos tributarios aquí?**
R: Sí, TaxControl usa cifrado y está protegido. Solo los usuarios autorizados pueden ver los documentos.

**P: ¿Quién puede ver mi información?**
R: Solo los usuarios con rol de Admin u Operador, según tu empresa. Tu administrador controla los permisos.

**P: ¿Se guarda un historial de quién vio qué?**
R: Sí, todas las acciones (crear, editar, eliminar) quedan registradas en el "Log de Auditoría" con usuario y fecha.

---

### ❓ Preguntas sobre Tecnología

**P: ¿Necesito instalar algo en mi computadora?**
R: No. TaxControl funciona en el navegador (Chrome, Firefox, Safari, Edge). Solo necesitas una conexión a internet.

**P: ¿Puedo acceder desde mi celular?**
R: Sí, funciona en dispositivos móviles aunque la mejor experiencia es desde una computadora.

**P: ¿Qué pasa si se corta mi internet mientras estoy trabajando?**
R: Si guardaste antes de que se corte, tu información está segura. Si no guardaste, los cambios se pierden. Por eso, guarda frecuentemente.

**P: ¿Qué navegadores funcionan mejor?**
R: Chrome, Firefox y Edge funcionan perfectamente. Safari también funciona bien.

---

## 💡 Consejos y Mejores Prácticas

### ✔️ Haz Esto

- ✅ Carga los documentos lo más pronto posible después de recibirlos
- ✅ Confía en la detección automática de empresa y autoridad, pero verifica
- ✅ Completa toda la información del documento (especialmente fechas)
- ✅ Usa las actividades para organizar tus tareas
- ✅ Marca actividades como completadas para mantener el sistema limpio
- ✅ Revisa regularmente el Centro de Alertas
- ✅ Usa filtros en el Dashboard para analizar documentos por empresa o autoridad
- ✅ Mantén el calendario de feriados actualizado (especialmente feriados extraordinarios)
- ✅ Exporte regularmente tus documentos como respaldo
- ✅ Cambia tu contraseña cada 3 meses
- ✅ Puedes subir cualquier tipo de archivo, no solo PDF

### ❌ Evita Esto

- ❌ No cargues documentos vencidos (revisa siempre la fecha)
- ❌ No elimines documentos sin estar seguro (es permanente)
- ❌ No ignores las alertas críticas (🔴)
- ❌ No compartas tu contraseña con nadie
- ❌ No cierres la página sin guardar cambios importantes

---

## 📞 ¿Necesitas Ayuda?

Si tienes problemas o preguntas que no están en este manual:

1. **Contacta a tu Administrador**
   - Suele ser la persona que te invitó a TaxControl
   - Puede ayudarte con acceso, contraseñas, configuración

2. **Revisa el Centro de Alertas**
   - A menudo hay mensajes de error útiles

3. **Intenta recargar la página**
   - A veces, F5 o Ctrl+R resuelve problemas temporales

4. **Cierra sesión y abre de nuevo**
   - A veces ayuda a sincronizar la información

---

## 📝 Glosario de Términos

| Término | Significado |
|---------|------------|
| **Dashboard** | Página principal con resumen de todo |
| **Documento** | Notificación o requerimiento de autoridad |
| **Actividad** | Tarea interna que necesitas hacer |
| **Contestación** | Respuesta formal a la autoridad |
| **Plazo** | Cantidad de días para responder |
| **Log de Auditoría** | Historial de quién hizo qué y cuándo |
| **Exportar** | Descargar información a Excel |
| **Rol** | Tu nivel de acceso (Admin, Operador, Lector) |

---

## 🎓 Resumen Visual

```
FLUJO TÍPICO EN TAXCONTROL:

1. Recibo documento de autoridad
   ↓
2. Cargo documento en TaxControl (Nuevos Documentos)
   ↓
3. Creo actividades para mis tareas (¿Qué debo hacer?)
   ↓
4. Reviso regularmente Centro de Alertas (¿Qué es urgente?)
   ↓
5. Completo mis actividades (✔️ Marcar como hecho)
   ↓
6. Registro mi respuesta (Contestación)
   ↓
7. Documento completado 🎉
```

---

## ✨ Últimos Consejos

- **Empieza por el Dashboard**: Entiende qué se ve allí
- **Carga un documento de prueba**: Para familiarizarte
- **Crea una actividad**: Verás cómo funciona
- **Revisa Alertas regularmente**: Es tu "buzón de atención"
- **No tengas miedo de experimentar**: No puedes romper nada (excepto eliminar, ten cuidado)

---

---

## 📋 Novedades Recientes (Mayo 2026)

### ✨ Nuevas Características

#### 🤖 IA Mejorada para Detección de Empresa
- Ahora la IA detecta automáticamente **de qué empresa se trata** el documento
- Compatible con: ECSA, EXSA, HCSA, PCSA, MMSA
- La empresa se pre-selecciona automáticamente (puedes cambiarla si es necesario)

#### 🏛️ Normalización de Autoridades
- El sistema estandariza automáticamente los nombres de autoridades
- "SRI", "Servicio de Rentas Internas" → se registran como "Servicio de Rentas Internas (SRI)"
- "IESS", "Instituto Ecuatoriano de Seguridad Social" → se registran como "IESS"
- Esto evita duplicados y mejora los filtros y reportes

#### 📁 Soporte para Cualquier Tipo de Archivo
- Ya no está limitado a PDF e imágenes
- Ahora puedes subir: Word, Excel, documentos de texto, etc.
- La IA intentará analizar el contenido según el tipo de archivo

#### 📊 Gráficos del Dashboard Más Inteligentes
- Los gráficos ahora **se actualizan en tiempo real** al aplicar filtros
- Si filtras por "SRI", ves solo documentos de esa autoridad
- Mejor análisis de tu cartera por empresa o autoridad

#### 🗓️ Gestión Completa de Feriados
- Dashboard nuevo para administrar el calendario de feriados
- Aplicación automática de la Ley de Traslados de Feriados Ecuador
- Recalculo automático de fechas de vencimiento
- Soporte para feriados extraordinarios

---

## 🎯 Resumen Visual de Mejoras

| Característica | Antes | Ahora |
|---|---|---|
| **Empresa** | Debías seleccionar manualmente | 🤖 IA detecta automáticamente |
| **Autoridad** | Variaciones (SRI, "Servicio de Rentas") | ✅ Normalizado automáticamente |
| **Archivos** | Solo PDF e imágenes | ✅ Cualquier tipo de archivo |
| **Gráficos** | Estáticos | 📊 Se actualizan con filtros |
| **Feriados** | Información general | 🗓️ Calendario completo + traslados |

---

**Versión 2.0 | Última actualización: Mayo 2026**

¡Gracias por usar TaxControl! Esperamos que estas nuevas características te ayuden aún más a organizar tus obligaciones tributarias. 🎯

Si tienes sugerencias o necesitas reportar un problema, contacta a tu administrador.

---

*Este manual está diseñado para usuarios finales no técnicos. Si tienes preguntas técnicas, contacta al equipo de soporte.*
