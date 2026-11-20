# Invitaciones de cumpleaños · eleonor.escobedo.com.mx

- **Invitación:** `https://eleonor.escobedo.com.mx` (cada invitado recibe su link `/?i=código`).
- **Panel:** `https://eleonor.escobedo.com.mx/panel`. Se entra con el mismo usuario y contraseña del panel de rentas.

## Cómo está armado (reutiliza lo del panel de rentas)

| Pieza | Dónde |
|---|---|
| Páginas | Este repositorio, publicado con GitHub Pages (archivo `CNAME`). |
| Base de datos | El mismo proyecto de Supabase del panel. Tablas `panel.fiestas`, `panel.fiesta_*` (`supabase/0001_fiestas.sql`, y después `supabase/0003_regalos.sql` para las ideas de regalo). |
| Acceso al panel | El mismo personal del panel (`panel.es_personal()`). |
| WhatsApp | El mismo número y los mismos secretos de Vault que los recordatorios de rentas. Plantillas en `whatsapp/`. |
| Recordatorio del día | Tarea `fiestas_whatsapp` (pg_cron) cada 15 minutos. Manda el recordatorio el día de la fiesta, a partir de la hora configurada (por omisión 10:30), a quienes confirmaron que sí van y dejaron celular. |

Los invitados no pueden leer ninguna tabla: solo usan `panel.fiesta_publica` (ver la fiesta y su propia respuesta) y `panel.fiesta_confirmar` (guardar su respuesta).

## DNS (una vez, en cPanel → Zone Editor de escobedo.com.mx)

| Tipo | Nombre | Apunta a |
|---|---|---|
| CNAME | `eleonor` | `erickescobedo.github.io` |

## Cada año
En el panel, **Fiesta y temática** → cambia los datos, la foto y la temática → **Crear fiesta nueva con estos datos**.
