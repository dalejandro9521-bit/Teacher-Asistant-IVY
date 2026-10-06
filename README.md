# Teacher Assistant IVY: asistencia automática

Automatiza el trabajo de asistencia de 4 clases (10 semanas, mínimo 80%) con **Google Sheets + Apps Script**, usando lo que ya existe:
el lector de barras de **Populi** para las clases presenciales, y los **screenshots** o el **reporte de participantes de Zoom** para las virtuales.
Los correos a estudiantes se envían **desde Populi**, con las 6 casillas de visibilidad. El sistema los deja escritos y te dice a quién seleccionar.

## Qué hace solo

| Tarea | Cómo |
|---|---|
| Leer la asistencia | Sueltas la exportación de Populi o el reporte de Zoom en la carpeta de Drive **TA Inbox**. Cada 15 min se procesa sola. |
| Reglas | Minutos 0–15 **Present**, 16–30 **Tardy**, 31+ **Absent**. **3 tardies = 1 absent.** Máximo **2** ausencias (cada una = 10%). |
| Se fue antes (Zoom) | Si salió antes del final (con 5 min de gracia), pasa a **Absent**. En presencial, marca "Left early = Yes" en la hoja. |
| Quien no aparece | Si no está en el reporte de Zoom o en la lista de check-ins de Populi, queda **Absent**. |
| Correo al estudiante | Uno por cada absent o tardy, con la clase, el día y la hora, las ausencias actuales y disponibles, el 80% y las reglas de la excusa médica (nunca al profesor, con nombre y teléfono del doctor u hospital, guardián o acompañante, verificación en 1 semana). |
| Follow-ups para Populi | En la hoja **Follow-ups** cada fila es un correo listo: **números del roster** (# en el orden de Populi) y nombres a seleccionar, asunto, mensaje y casillas de visibilidad. Los estudiantes con las mismas cifras comparten **un solo correo** ("Email selected students"). Cuando lo envías, marcas **Done = Yes**. |
| Tabla por semana | Una hoja por clase (**Grid C1** … **Grid C4**): los estudiantes en el **mismo orden fijo de Populi**, una columna por semana (Week 1 · fecha, Week 2 · …) con P, T, A o E en colores, y los totales. Sirve para marcar las casillas de participación de Populi en el mismo orden. |
| Sin ID | Marcas "No ID = Yes". A la **3.ª vez** se avisa a la oficina. |
| Reporte del viernes | Por clase: quién faltó o llegó tarde esa semana, quién está en riesgo o perdiendo el curso y qué excusas médicas siguen pendientes (marca las de más de 7 días). |
| Recordatorios de tareas | Hoja **Assignments**: el día que toca (por ejemplo "3,1" días antes) aparece en Follow-ups para enviarlo con "Email this section". |
| Resumen | La hoja **Summary** muestra a cada estudiante con sus ausencias, tardies, %, ausencias disponibles y estado. |

`Email mode = POPULI` (por defecto) deja los correos en **Follow-ups** para enviarlos desde Populi.
Si algún día se permite enviarlos por Gmail, `DRAFT` crea borradores y `SEND` los envía solos, con Reply-To a tu correo académico.
El reporte del viernes siempre te llega a ti por Gmail.

## Instalación (una vez, ~15 minutos)

1. Crea una hoja de cálculo nueva en Google Sheets con tu cuenta **dgomez230@ivy.edu** (es Google Workspace).
   Si el administrador bloquea Apps Script en esa cuenta, usa tu Gmail personal: funciona igual.
2. Ve a **Extensiones → Apps Script**. Borra el contenido de `Código.gs` y crea 4 archivos de script con el contenido de `src/`:
   `Rules`, `Parsers`, `Messages`, `Code` (copia y pega cada `.js`).
   En **Configuración del proyecto**, activa "Mostrar appsscript.json" y pega `src/appsscript.json`.
   Eso pone la hora de Virginia (Este) y activa el servicio **Drive**, que es el que hace el OCR de los screenshots.
3. Guarda, vuelve a la hoja y recárgala. Aparece el menú **TA Attendance**.
4. **TA Attendance → Set up / repair sheets**. Acepta los permisos (Sheets, Drive, Gmail). Se crean las hojas y la carpeta **TA Inbox** en tu Drive.
5. Llena las hojas:
   - **Classes**: nombre del curso, sección, profesor y, en las de Zoom, el **Zoom meeting ID** (así reconoce el reporte solo).
     Ya vienen las 4:

     | ID | Curso | Horario | Modalidad |
     |---|---|---|---|
     | C1 | HA 103 History of World Religions | lunes 9:00–1:00 | Room 300 |
     | C2 | OT 215 Minor Prophets | lunes 1:30–5:30 | Room 304 |
     | C3 | HA 105 Introduction to Ethics | lunes 6–10 pm | Zoom |
     | C4 | SB 100 Introduction to Business | jueves 9:00–1:00 | Zoom |

     La semana 1 empieza el 5 de octubre de 2026.
   - **Students**: se llena sola. En Populi abre **Roster → Actions → Export this section CSV** de cada clase y sube el archivo a **TA Inbox**.
     El sistema reconoce la clase por el código del curso (HA 103, HA 105…) o por `[C1]` en el nombre del archivo, y guarda el **orden de Populi** (#1, #2, …).
     Si el roster cambia, vuelve a exportarlo: el orden se actualiza y quien ya no aparece queda inactivo.
   - **Config**: revisa el email de la oficina, **Term start** y **Send notices from**. No se envían correos por ausencias anteriores a esa fecha.
6. **TA Attendance → Turn on automations**.

Con [clasp](https://github.com/google/clasp) también puedes subir el código con `clasp push`, usando `rootDir: "src"`.

## Uso diario

**Presencial (C1 HA 103, C2 OT 215):** tomas la asistencia con el lector en Populi como siempre. Al terminar:
1. Exporta la asistencia de la clase desde Populi en **CSV**.
2. Súbela a **TA Inbox**. Si el sistema no reconoce la clase, pon `[C1]` o `[C2]` en el nombre del archivo.

Si Populi incluye la **hora del escaneo**, el sistema decide Present, Tardy o Absent con la regla de 15 y 30 minutos.

**Zoom (C3 HA 105, C4 SB 100). Los screenshots se leen solos, sin IA y sin costo:**

1. Usa la misma estructura de carpetas que ya tienes, pero dentro de **TA Inbox** en Google Drive:
   ```
   TA Inbox/
     1. HA 105 - Week 01 - 10.05.26/     ← el nombre lleva el código del curso y la fecha (mes.día.año)
       1. Present/   screenshots de las 6:15
       2. Tardy/     screenshots de las 6:31
       3. Absent/    screenshots antes de salir (para saber quién se fue)
   ```
2. Screenshots en la **vista de galería**, como ya los tomas:
   - **Cierra el chat antes del screenshot.** Los estudiantes escriben ahí su nombre y quedaría como si siguieran conectados.
   - Pon la galería en **49 por pantalla** (Zoom → Settings → Video → "Display up to 49 participants per screen in Gallery View").
     Así son 2 páginas en lugar de 3.
   - Toma un screenshot por página y ponlos todos en la carpeta del momento que corresponde.
3. Cada 15 minutos el sistema lee el texto de las imágenes con el **OCR de Google Drive** (gratis) y aplica tus reglas:

   | Aparece en… | Resultado | Nota en la hoja |
   |---|---|---|
   | Present y en el último | Present | |
   | Present, no en Tardy, sí en el último | Present | se cayó la conexión a los 31 min, confirmado al final |
   | Tardy y en el último | Tardy | |
   | Present y/o Tardy, pero no en el último | Absent | se desconectó antes de la revisión de la hora |
   | Solo en el último | Absent | se conectó después del minuto 30 |
   | En ninguno | Absent | nunca se conectó |

   En Populi (online) solo existe presente o ausente: marca la casilla para P y T y déjala vacía para A.
   La hoja **Grid** está en el mismo orden que Populi.
4. En el **Inbox log** ves el resultado y los nombres de Zoom que no reconoció.
   Si alguien se pone otro nombre en Zoom (por ejemplo "iPhone de Ana"), escríbelo una vez en **Students → Zoom names** de ese estudiante y desde ahí lo reconoce siempre.
   En **Config → Ignore in screenshots** pon tu nombre y el del profesor.

Para no tener que arrastrar archivos, instala **Google Drive para escritorio** y cambia dónde guarda la Mac los screenshots
(**Cmd+Shift+5 → Opciones → Otra ubicación**) a la carpeta de la semana en TA Inbox.

Si el profesor puede bajar el **reporte de participantes** de Zoom (Reports → Usage → Participants → Export) y te lo pasa, súbelo a TA Inbox.
Ese reporte trae la hora exacta de entrada y salida de cada persona.

En los dos casos, la hoja **Grid** de la clase queda en el orden de Populi para que marques las casillas de **Attendance → participation** de arriba abajo.
Los screenshots siguen siendo tu evidencia ante reclamos.

**En la hoja Attendance puedes:**
- Cambiar el Status. La fila queda como `Manual` y ninguna importación la vuelve a tocar.
- Marcar **No ID** o **Left early**.
- Registrar la excusa médica: **Excuse = Received** y la fecha. Cuando la oficina la apruebe, pon **Accepted** y deja de contar.

**Viernes:** el reporte te llega solo a las 8 AM. También puedes enviarlo cuando quieras desde el menú.

## Enviar un follow-up desde Populi

1. Abre **Follow-ups** y toma una fila con **Done** vacío.
2. En Populi, abre la clase → **Roster** → marca los estudiantes de la columna **Roster #** (están en el mismo orden) → **Actions → Email selected students**.
   Si es un recordatorio de tarea, usa **Email this section**.
3. Copia **Subject** y **Message**. Revisa que el **Reply-To** sea dgomez230@ivy.edu.
4. En **Visibility** marca: Academic Admin, Account Admin, Admissions Admin, Staff, Academic Auditor y Admissions.
5. Envía y pon **Done = Yes**.

No usamos la API de Populi: todo funciona con exportaciones CSV y screenshots.

## Desarrollo

```
npm test        # reglas, lectores de Populi y Zoom, correos y el flujo completo sobre Sheets, Drive y Gmail simulados
```

| Archivo | Qué hay |
|---|---|
| `src/Rules.js` | Reglas: 15/30 min, 3 tardies = 1 absent, máximo 2, nombres, fechas, recordatorios. |
| `src/Parsers.js` | CSV, exportación de Populi (formato largo o ancho), reporte de Zoom, detección de la clase. |
| `src/Messages.js` | Textos de los correos (estudiante, oficina, recordatorio, reporte semanal). |
| `src/Code.js` | Apps Script: hojas, carpeta de Drive, Gmail, triggers y menú. |
| `tests/` | `gas-mock.js` simula Apps Script; `rules.test.js` y `flow.test.js`. |

No subas exportaciones con datos de estudiantes al repositorio (`.gitignore` ya bloquea `*.csv` y `*.xlsx`).
