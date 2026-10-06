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

1. Crea una hoja de cálculo nueva en Google Sheets, idealmente con tu cuenta **@ivy.edu**, para que los correos salgan de ahí.
2. Ve a **Extensiones → Apps Script**. Borra el contenido de `Código.gs` y crea 4 archivos de script con el contenido de `src/`:
   `Rules`, `Parsers`, `Messages`, `Code` (copia y pega cada `.js`).
   En **Configuración del proyecto**, activa "Mostrar appsscript.json" y pega `src/appsscript.json` (zona horaria de Indiana).
3. Guarda, vuelve a la hoja y recárgala. Aparece el menú **TA Attendance**.
4. **TA Attendance → Set up / repair sheets**. Acepta los permisos (Sheets, Drive, Gmail). Se crean las hojas y la carpeta **TA Inbox** en tu Drive.
5. Llena las hojas:
   - **Classes**: nombre del curso, sección, profesor y, en las de Zoom, el **Zoom meeting ID** (así reconoce el reporte solo).
     Ya vienen las 4: C1 lunes 9–1 (presencial), C2 lunes 1:30–2:30 (presencial), C3 lunes 6–7 pm (Zoom) y C4 jueves 9–10 (Zoom).
   - **Students**: se llena sola. En Populi abre **Roster → Actions → Export this section CSV** de cada clase y sube el archivo a **TA Inbox**.
     El sistema reconoce la clase por el código del curso (HA 103, HA 105…) o por `[C1]` en el nombre del archivo, y guarda el **orden de Populi** (#1, #2, …).
     Si el roster cambia, vuelve a exportarlo: el orden se actualiza y quien ya no aparece queda inactivo.
   - **Config**: revisa el email de la oficina, **Term start** y **Send notices from**. No se envían correos por ausencias anteriores a esa fecha.
6. **TA Attendance → Turn on automations**.

Con [clasp](https://github.com/google/clasp) también puedes subir el código con `clasp push`, usando `rootDir: "src"`.

## Uso diario

**Presencial (C1, C2):** tomas la asistencia con el lector en Populi como siempre. Al terminar:
1. Exporta la asistencia de la clase desde Populi en **CSV**.
2. Súbela a **TA Inbox**. Si el sistema no reconoce la clase, pon `[C1]` o `[C2]` en el nombre del archivo.

Si Populi incluye la **hora del escaneo**, el sistema decide Present, Tardy o Absent con la regla de 15 y 30 minutos.

**Zoom (C3, C4)**. Hay dos caminos:

**Opción A: screenshots y Claude.**
1. Toma los screenshots de la **lista de participantes** a las 6:15, 6:31 y antes de salir. Si no cabe todo, toma varios bajando por la lista.
2. Envíaselos a Claude diciendo la clase y la fecha.
3. Claude lee los nombres y aplica las reglas:
   - En el de 6:15 = Present.
   - Solo en el de 6:31 = Tardy.
   - En ninguno = Absent.
   - Ya no estaba en el último = Absent (left early).
   - Cuadra el total con el contador de Zoom, menos tú y el profesor.
4. Claude genera `Zoom screenshots AAAA-MM-DD [C3].csv` para **TA Inbox** y te dice qué nombres no pudo reconocer.

**Opción B: reporte de participantes.** Baja el reporte (**Zoom → Reports → Usage → Participants → Export**) y súbelo a **TA Inbox**.
El sistema calcula Present, Tardy, Absent y "left early" con las horas de entrada y salida.

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
