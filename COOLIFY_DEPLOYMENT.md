# 🚀 Guía de Despliegue en Coolify - Tax Control API

> ⚠️ **ACTUALIZACIÓN (2026-06-20): almacenamiento de archivos migrado a la base de datos.**
> Los archivos de documentos (de cualquier formato) ahora se guardan como bytes en la
> tabla `document_files` (LONGBLOB) dentro de MariaDB, NO en disco. Esto los hace
> persistentes ante cualquier redespliegue del contenedor, **sin depender de un volumen**.
> - La subida sigue siendo por `multipart` (`POST /api/upload`) para no saturar el proxy.
> - `GET /api/files/:id` y `GET /api/download/:id` sirven desde la BD (fallback a disco
>   para archivos legacy que aún estén presentes).
> - Al arrancar, `migrateDiskFilesToDb()` respalda automáticamente en la BD cualquier
>   archivo que todavía exista en disco.
> - El volumen persistente para `/app/uploads` ya **no es obligatorio** (solo ayuda a
>   rescatar archivos legacy si el contenedor se reinicia antes de la primera migración).
> La sección histórica de abajo se conserva como referencia del diseño anterior.

## 📋 Resumen del Problema Resuelto

**Problema:** Los documentos cargados no se desplegaban correctamente en Coolify.

**Causa Raíz:** Los archivos se guardaban como Base64 en la base de datos, causando:
- Archivos Base64 muy grandes (hasta 50MB+)
- Límites de tamaño de payload JSON (50MB)
- Problemas de performance en MariaDB
- Timeouts en conexiones

**Solución:** Sistema de carga de archivos separado con multer.

---

## ✅ Cambios Implementados

### API (TaxControl-Api)

1. **Nuevo Endpoint POST /api/upload**
   - Acepta archivos vía `multipart/form-data`
   - Almacena archivos en directorio `uploads/`
   - Devuelve URL relativa `/api/files/{filename}`

2. **Servidor de Archivos Estáticos**
   - Ruta: `/api/files`
   - Directorio: `${UPLOAD_DIR}` (configurable)

3. **Cambios en Límites**
   - JSON: 50MB → 10MB
   - Archivos: hasta 50MB vía multipart

### Frontend (TaxControl)

1. **Carga de Archivos Mejorada**
   - Usa `POST /api/upload` para cargar archivos
   - Mantiene análisis de IA con Data URLs (temporal)
   - Almacena referencias en lugar de Base64

---

## 🔧 Configuración en Coolify

### 1️⃣ Variables de Entorno Necesarias

```env
# Base de datos
DB_HOST=mariadb
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_contraseña
DB_NAME=tax_control

# Almacenamiento de archivos
UPLOAD_DIR=/app/uploads

# Email (si está configurado)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu_email@gmail.com
SMTP_PASSWORD=tu_app_password
SMTP_FROM=noreply@taxcontrol.com
```

### 2️⃣ Volumen Persistente (IMPORTANTE ⭐)

**En Coolify, agregar volumen:**

```
Source: /app/uploads
Destination: /var/lib/docker/volumes/taxcontrol-uploads/_data
```

O en docker-compose:

```yaml
services:
  taxcontrol-api:
    volumes:
      - /app/uploads:/app/uploads
      # O usar volumen nombrado:
      - taxcontrol-uploads:/app/uploads

volumes:
  taxcontrol-uploads:
    driver: local
```

### 3️⃣ CORS Configuration

Ya viene configurado en `index.js`:
- `http://taxcontrolapp.192.168.60.109.sslip.io`
- `https://taxcontrolapp.192.168.60.109.sslip.io`
- `http://localhost:3000`
- `http://localhost:5173`

**Si usas otro dominio, agregar a `index.js` línea ~15:**

```javascript
app.use(cors({
  origin: [
    'http://taxcontrolapp.192.168.60.109.sslip.io',
    'https://taxcontrolapp.192.168.60.109.sslip.io',
    'https://tu-dominio.com',  // ← Agregar aquí
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));
```

---

## 📦 Dependencias Agregadas

```json
{
  "multer": "^1.4.5-lts.1"
}
```

**Instalar en Coolify:**
- El `package.json` ya contiene la dependencia
- Coolify ejecutará automáticamente `npm install`

---

## 🧪 Prueba de Funcionamiento

### 1. Verificar Endpoint de Carga

```bash
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer tu_token" \
  -F "file=@documento.pdf"

# Respuesta esperada:
{
  "success": true,
  "fileUrl": "/api/files/1234567890-abc123-documento.pdf",
  "fileName": "documento.pdf",
  "size": 102400
}
```

### 2. Verificar Servidor de Archivos

```bash
# Descargar archivo
curl http://localhost:3000/api/files/1234567890-abc123-documento.pdf \
  -o documento.pdf

# Si funciona, debería descargar el archivo
```

### 3. Verificar en Base de Datos

```sql
-- Ver documento cargado
SELECT id, title, file_url, file_name FROM documents LIMIT 1;

-- Debería mostrar:
-- file_url: /api/files/1234567890-abc123-documento.pdf
-- (No Base64)
```

---

## 🐳 Configuración en Docker

### docker-compose.yml (Ejemplo)

```yaml
version: '3.8'

services:
  taxcontrol-api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DB_HOST: mariadb
      DB_USER: root
      DB_PASSWORD: password123
      DB_NAME: tax_control
      UPLOAD_DIR: /app/uploads
    volumes:
      - taxcontrol-uploads:/app/uploads
    depends_on:
      - mariadb
    restart: unless-stopped

  mariadb:
    image: mariadb:latest
    environment:
      MYSQL_ROOT_PASSWORD: password123
      MYSQL_DATABASE: tax_control
    volumes:
      - mariadb-data:/var/lib/mysql
    restart: unless-stopped

volumes:
  taxcontrol-uploads:
    driver: local
  mariadb-data:
    driver: local
```

---

## ⚠️ Troubleshooting

### Problema: "Error uploading file"

**Verificar:**
1. ¿El directorio `/app/uploads` existe en el contenedor?
2. ¿Los permisos del directorio son correctos? (chmod 755)
3. ¿El volumen está montado correctamente en Coolify?

**Solución:**
```bash
# En Coolify, conectarse al contenedor:
docker exec -it taxcontrol-api sh
# Crear directorio manualmente si no existe:
mkdir -p /app/uploads
chmod 755 /app/uploads
```

### Problema: "File not found when downloading"

**Verificar:**
1. ¿El archivo existe en `/app/uploads`?
2. ¿La URL guardada en BD coincide con la ubicación?

**Solución:**
```sql
-- Verificar URL guardada
SELECT file_url FROM documents WHERE id='d123';

-- Debería ser: /api/files/filename.pdf
-- No Base64 gigante
```

### Problema: "CORS error"

**Verificar:**
1. ¿Dominio frontend está en lista blanca?
2. ¿URL correcta en config del frontend?

**Solución:**
- Agregar dominio a CORS en `index.js`
- Verificar `API_URL` en frontend `/config.ts`

---

## 🔄 Migración de Documentos Antiguos (Base64)

Si tienes documentos antiguos guardados como Base64:

```sql
-- Crear tabla temporal para documentos con Base64 antiguo
SELECT COUNT(*) FROM documents WHERE file_url LIKE 'data:%';

-- Estos documentos tienen Base64 y pueden tener problemas
-- Solución: Re-cargar los documentos nuevamente
-- La nueva interfaz solo acepta carga vía /api/upload
```

**Recomendación:**
- Descargar documentos antiguos (como están en Base64 en HTML)
- Re-cargarlos nuevamente con la nueva interfaz
- Esto asegura que estén en el sistema correcto

---

## 🚀 Paso a Paso para Coolify

1. **Actualizar repositorio**
   ```bash
   git pull origin claude/fix-tax-control-deployment-c95io
   ```

2. **Agregar variable de entorno en Coolify**
   - Panel Coolify → Aplicación → Variables
   - Agregar: `UPLOAD_DIR=/app/uploads`

3. **Crear volumen persistente**
   - Panel Coolify → Aplicación → Volumes
   - Agregar: Source: `/app/uploads`
   - Agregar: Destination: `/app/uploads`

4. **Redesplegear**
   - Panel Coolify → Deploy
   - Coolify ejecutará: `npm install` (multer se instalará)
   - API estará lista en pocos minutos

5. **Verificar estado**
   - Ir a frontend
   - Cargar un nuevo documento
   - Verificar que aparezca en la lista
   - Descargar el archivo para confirmar

---

## 📊 Comparación: Antes vs Después

| Aspecto | Antes (Base64) | Después (Multer) |
|---------|----------------|-----------------|
| Tamaño documento en BD | 50MB+ | < 1KB (URL) |
| Performance de carga | Lenta (JSON grande) | Rápida (multipart) |
| Límite de archivo | 4MB PDF | 50MB archivo |
| Almacenamiento | BD (LONGTEXT) | Sistema de archivos |
| Despliegue Coolify | Problemas de timeout | Estable |
| Descarga de archivo | Data URL → HTML | HTTP directo |

---

## ✨ Mejoras Futuras Opcionales

1. **Almacenamiento en S3**
   - Cambiar de filesystem a AWS S3
   - Requiere: `aws-sdk`, variables AWS

2. **Antivirus**
   - Escanear archivos antes de guardar
   - Requiere: `clamav` o servicio antivirus

3. **Compresión de PDFs**
   - Reducir tamaño automáticamente
   - Requiere: `pdfkit` o `ghostscript`

4. **Versionado de archivos**
   - Guardar historial de cambios
   - Requiere: tabla adicional en BD

---

## 📞 Soporte

Si tienes problemas con el despliegue:

1. Verificar logs en Coolify: `docker logs -f taxcontrol-api`
2. Conectar a contenedor: `docker exec -it taxcontrol-api sh`
3. Revisar variables de entorno: `env | grep UPLOAD`
4. Verificar permisos: `ls -la /app/uploads`

---

**Última actualización:** 2026-05-19
**Versión:** 1.0.0
**Estado:** ✅ Listo para producción
