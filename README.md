# Teacher Assistant IVY: asistencia automática

Automatiza el trabajo de asistencia de 4 clases (10 semanas, mínimo 80%) con **Google Sheets + Apps Script**, usando lo que ya existe:
el lector de barras de **Populi** para las clases presenciales y el **reporte de participantes de Zoom** para las virtuales.

## Qué hace solo

| Tarea | Cómo |
|---|---|
| Leer la asistencia | Sueltas la exportación de Populi o el reporte de Zoom en la carpeta de Drive **TA Inbox**. Cada 15 min se procesa sola. |
| Reglas | Minutos 0–15 **Present**, 16–30 **Tardy**, 31+ **Absent**. **3 tardies = 1 absent.** Máximo **2** ausencias (cada una = 10%). |
| Se fue antes (Zoom) | Si salió antes del final (con 5 min de gracia), pasa a **Absent**. En presencial, marca "Left early = Yes" en la hoja. |
| Quien no aparece | Si no está en el reporte de Zoom o en la lista de check-ins de Populi, queda **Absent**. |
| Correo al estudiante | Uno por cada absent o tardy, con la clase, el día y la hora, las ausencias actuales y disponibles, el 80% y las reglas de la excusa médica (nunca al profesor, con nombre y teléfono del doctor u hospital, guardián o acompañante, verificación en 1 semana). **Reply-To: dgomez230@ivy.edu.** |
| Sin ID | Marcas "No ID = Yes". A la **3.ª vez** se avisa a la oficina. |
| Reporte del viernes | Por clase: quién faltó o llegó tarde esa semana, quién está en riesgo o perdiendo el curso y qué excusas médicas siguen pendientes (marca las de más de 7 días). |
| Recordatorios de tareas | Hoja **Assignments**: el correo sale a toda la clase en BCC los días que elijas antes de la entrega (por ejemplo "3,1"). |
| Resumen | La hoja **Summary** muestra a cada estudiante con sus ausencias, tardies, %, ausencias disponibles y estado. |

Los correos salen por defecto como **borradores en Gmail** (`Email mode = DRAFT`) para que los revises.
Cuando confíes en el sistema, cambia a `SEND` y saldrán solos.

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
   - **Students**: ID, nombre, email y clase. También se llena sola con la primera exportación de Populi que lleve `[C1]` en el nombre.
   - **Config**: revisa el email de la oficina, **Term start** y **Send notices from**. No se envían correos por ausencias anteriores a esa fecha.
6. **TA Attendance → Turn on automations**.

Con [clasp](https://github.com/google/clasp) también puedes subir el código con `clasp push`, usando `rootDir: "src"`.

## Uso diario

**Presencial (C1, C2):** tomas la asistencia con el lector en Populi como siempre. Al terminar:
1. Exporta la asistencia de la clase desde Populi en **CSV**.
2. Súbela a **TA Inbox**. Si el sistema no reconoce la clase, pon `[C1]` o `[C2]` en el nombre del archivo.

Si Populi incluye la **hora del escaneo**, el sistema decide Present, Tardy o Absent con la regla de 15 y 30 minutos.

**Zoom (C3, C4):**
- Sigue tomando los screenshots de las 6:15 y 6:31: son la evidencia ante reclamos.
- Al terminar, baja el reporte de participantes (**Zoom → Reports → Usage → Participants → Export**) y súbelo a **TA Inbox**.
- El sistema calcula Present, Tardy, Absent y "left early" con las horas de entrada y salida de cada persona.
- Revisa el **Inbox log**: lista los nombres de Zoom que no reconoció. Corrige esos casos a mano en **Attendance**.

**En la hoja Attendance puedes:**
- Cambiar el Status. La fila queda como `Manual` y ninguna importación la vuelve a tocar.
- Marcar **No ID** o **Left early**.
- Registrar la excusa médica: **Excuse = Received** y la fecha. Cuando la oficina la apruebe, pon **Accepted** y deja de contar.

**Viernes:** el reporte te llega solo a las 8 AM. También puedes enviarlo cuando quieras desde el menú.

## Notas sobre Populi

- Los correos salen de Gmail con Reply-To a tu correo académico.
- Gmail **no puede** marcar la visibilidad de Populi (Academic Admin, Account Admin, Admissions Admin, Staff, Academic Auditor, Admissions).
  Si la universidad exige que queden registrados en Populi, tienes dos opciones:
  - Usar `Email mode = LOG` y copiar el texto desde la hoja **Outbox** a Populi.
  - Poner el correo de la oficina en **BCC on student notices**.
- **Siguiente paso posible:** Populi tiene una API REST (v2). Con una API key de la oficina se podría leer la asistencia directamente, sin exportar CSV.
  Todavía no está implementado porque hace falta la key y confirmar sus endpoints.

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
