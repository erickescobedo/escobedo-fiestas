-- Invitaciones de cumpleaños (eleonor.escobedo.com.mx).
-- Vive en el mismo proyecto de Supabase que el panel de rentas, en tablas propias con prefijo fiesta_.
-- Entra el mismo personal del panel (panel.es_personal()). Los invitados solo usan dos funciones públicas.
-- WhatsApp: mismo número y mismos secretos de Vault que los recordatorios de rentas.

create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists panel.fiestas (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null check (length(nombre) between 1 and 40),
  edad               int  not null default 1 check (edad between 1 and 99),
  fecha              date not null,
  ini                time not null,
  fin                time not null,
  lugar              text not null check (length(lugar) between 1 and 80),
  maps               text not null default '',
  tel                text not null default '',
  tema               text not null default 'dibujitos',
  kicker             text not null default '',
  foto               text not null default '' check (length(foto) <= 900000),
  recordatorio       boolean not null default true,
  recordatorio_hora  time not null default '10:30',
  creado_en          timestamptz not null default now()
);

create table if not exists panel.fiesta_actual (
  id        boolean primary key default true check (id),
  fiesta_id uuid references panel.fiestas(id) on delete set null
);
insert into panel.fiesta_actual (id) values (true) on conflict do nothing;

create table if not exists panel.fiesta_invitados (
  id        uuid primary key default gen_random_uuid(),
  fiesta_id uuid not null references panel.fiestas(id) on delete cascade,
  codigo    text not null unique default encode(extensions.gen_random_bytes(5), 'hex'),
  nombre    text not null check (length(nombre) between 1 and 80),
  telefono  text not null,
  creado_en timestamptz not null default now(),
  unique (fiesta_id, telefono)
);

create table if not exists panel.fiesta_rsvps (
  id             uuid primary key default gen_random_uuid(),
  fiesta_id      uuid not null references panel.fiestas(id) on delete cascade,
  invitado_id    uuid unique references panel.fiesta_invitados(id) on delete set null,
  nombre         text not null check (length(nombre) between 1 and 80),
  asiste         boolean not null,
  adultos        int not null default 0 check (adultos between 0 and 20),
  ninos          int not null default 0 check (ninos between 0 and 20),
  alergias       text not null default '' check (length(alergias) <= 200),
  mensaje        text not null default '' check (length(mensaje) <= 500),
  telefono       text,
  origen         text not null default 'web' check (origen in ('web','manual')),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists panel.fiesta_mensajes (
  id          uuid primary key default gen_random_uuid(),
  fiesta_id   uuid not null references panel.fiestas(id) on delete cascade,
  invitado_id uuid references panel.fiesta_invitados(id) on delete cascade,
  rsvp_id     uuid references panel.fiesta_rsvps(id) on delete cascade,
  tipo        text not null check (tipo in ('invitacion','recordatorio')),
  telefono    text not null,
  request_id  bigint,
  estado      text not null default 'enviando' check (estado in ('enviando','enviado','error')),
  mensaje_id  text,
  error       text,
  creado_en   timestamptz not null default now()
);
create unique index if not exists fiesta_mensajes_un_recordatorio on panel.fiesta_mensajes (rsvp_id) where tipo = 'recordatorio';
create index if not exists fiesta_mensajes_invitado on panel.fiesta_mensajes (invitado_id, creado_en desc);

-- Solo el personal del panel ve y edita estas tablas.
do $$ declare t text; begin
  foreach t in array array['fiestas','fiesta_actual','fiesta_invitados','fiesta_rsvps','fiesta_mensajes'] loop
    execute format('alter table panel.%I enable row level security', t);
    execute format('drop policy if exists personal on panel.%I', t);
    execute format('create policy personal on panel.%I for all to authenticated using (panel.es_personal()) with check (panel.es_personal())', t);
    execute format('grant select, insert, update, delete on panel.%I to authenticated', t);
  end loop;
end $$;

-- "5:00 a 7:00 pm"
create or replace function panel.fiesta_horario(a time, b time) returns text
language sql immutable set search_path = '' as $$
  select case when (a < '12:00') = (b < '12:00')
    then to_char(a, 'FMHH12:MI') || ' a ' || to_char(b, 'FMHH12:MI') || case when b < '12:00' then ' am' else ' pm' end
    else to_char(a, 'FMHH12:MI') || ' am a ' || to_char(b, 'FMHH12:MI') || ' pm' end
$$;

-- ───────────── Funciones públicas (invitados) ─────────────

-- Datos de la fiesta actual. Con código: el nombre del invitado y su respuesta anterior.
-- OJO: 0003_regalos.sql la reemplaza con la versión que incluye regalos; si corres este archivo otra vez, corre 0003 después.
create or replace function panel.fiesta_publica(p_codigo text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f panel.fiestas; inv panel.fiesta_invitados; r panel.fiesta_rsvps; res jsonb;
begin
  select x.* into f from panel.fiestas x join panel.fiesta_actual a on a.fiesta_id = x.id;
  if f.id is null then return null; end if;
  res := jsonb_build_object('nombre', f.nombre, 'edad', f.edad, 'fecha', f.fecha, 'ini', to_char(f.ini, 'HH24:MI'), 'fin', to_char(f.fin, 'HH24:MI'),
    'lugar', f.lugar, 'maps', f.maps, 'tel', f.tel, 'tema', f.tema, 'kicker', f.kicker, 'foto', f.foto);
  if coalesce(p_codigo, '') <> '' then
    select * into inv from panel.fiesta_invitados where codigo = lower(p_codigo) and fiesta_id = f.id;
    if inv.id is not null then
      res := res || jsonb_build_object('invitado', inv.nombre);
      select * into r from panel.fiesta_rsvps where invitado_id = inv.id;
      if r.id is not null then
        res := res || jsonb_build_object('respuesta', jsonb_build_object('nombre', r.nombre, 'asiste', r.asiste, 'adultos', r.adultos,
          'ninos', r.ninos, 'alergias', r.alergias, 'mensaje', r.mensaje));
      end if;
    end if;
  end if;
  return res;
end $$;

-- Guarda la confirmación. Con código, la respuesta se actualiza (no se duplica).
create or replace function panel.fiesta_confirmar(p_codigo text, p_nombre text, p_asiste boolean, p_adultos int, p_ninos int,
  p_alergias text, p_mensaje text, p_telefono text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare f uuid; inv panel.fiesta_invitados; tel text; n text := trim(coalesce(p_nombre, ''));
begin
  select fiesta_id into f from panel.fiesta_actual;
  if f is null then raise exception 'No hay fiesta activa'; end if;
  if p_asiste is null then raise exception 'Falta la respuesta'; end if;
  if (select count(*) from panel.fiesta_rsvps where fiesta_id = f) >= 600 then raise exception 'Límite de confirmaciones'; end if;
  -- Solo familias dadas de alta en el panel (link con código). El nombre y el celular vienen del alta.
  select * into inv from panel.fiesta_invitados where codigo = lower(coalesce(p_codigo, '')) and fiesta_id = f;
  if inv.id is null then raise exception 'Invitación no encontrada'; end if;
  n := inv.nombre;
  tel := inv.telefono;
  if inv.id is not null then
    insert into panel.fiesta_rsvps (fiesta_id, invitado_id, nombre, asiste, adultos, ninos, alergias, mensaje, telefono)
    values (f, inv.id, n, p_asiste, case when p_asiste then least(greatest(coalesce(p_adultos,0),0),20) else 0 end,
            case when p_asiste then least(greatest(coalesce(p_ninos,0),0),20) else 0 end,
            left(trim(coalesce(p_alergias,'')), 200), left(trim(coalesce(p_mensaje,'')), 500), tel)
    on conflict (invitado_id) do update set nombre = excluded.nombre, asiste = excluded.asiste, adultos = excluded.adultos,
      ninos = excluded.ninos, alergias = excluded.alergias, mensaje = excluded.mensaje, telefono = excluded.telefono, actualizado_en = now();
  else
    insert into panel.fiesta_rsvps (fiesta_id, nombre, asiste, adultos, ninos, alergias, mensaje, telefono)
    values (f, n, p_asiste, case when p_asiste then least(greatest(coalesce(p_adultos,0),0),20) else 0 end,
            case when p_asiste then least(greatest(coalesce(p_ninos,0),0),20) else 0 end,
            left(trim(coalesce(p_alergias,'')), 200), left(trim(coalesce(p_mensaje,'')), 500), tel);
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function panel.fiesta_publica(text) from public;
revoke all on function panel.fiesta_confirmar(text, text, boolean, int, int, text, text, text) from public;
grant execute on function panel.fiesta_publica(text) to anon, authenticated;
grant execute on function panel.fiesta_confirmar(text, text, boolean, int, int, text, text, text) to anon, authenticated;

-- ───────────── WhatsApp ─────────────

-- Manda la plantilla por la API de WhatsApp y registra el envío. Uso interno.
create or replace function panel.fiesta_wa(p_fiesta uuid, p_invitado uuid, p_rsvp uuid, p_tipo text, p_tel text, p_cuerpo jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tok text; pid text; req bigint; mid uuid;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'whatsapp_token';
  select decrypted_secret into pid from vault.decrypted_secrets where name = 'whatsapp_phone_id';
  if tok is null or pid is null then raise exception 'WhatsApp no está configurado'; end if;
  select net.http_post(url := 'https://graph.facebook.com/v23.0/' || pid || '/messages', body := p_cuerpo,
    headers := jsonb_build_object('Authorization', 'Bearer ' || tok, 'Content-Type', 'application/json')) into req;
  insert into panel.fiesta_mensajes (fiesta_id, invitado_id, rsvp_id, tipo, telefono, request_id)
  values (p_fiesta, p_invitado, p_rsvp, p_tipo, p_tel, req) returning id into mid;
  return mid;
end $$;
revoke all on function panel.fiesta_wa(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- Botón "Enviar invitación" del panel.
create or replace function panel.fiesta_enviar_invitacion(p_invitado uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i panel.fiesta_invitados; f panel.fiestas;
begin
  if not panel.es_personal() then raise exception 'Sin permiso'; end if;
  select * into i from panel.fiesta_invitados where id = p_invitado;
  if i.id is null then raise exception 'Invitado no encontrado'; end if;
  select * into f from panel.fiestas where id = i.fiesta_id;
  return panel.fiesta_wa(f.id, i.id, null, 'invitacion', i.telefono, jsonb_build_object(
    'messaging_product', 'whatsapp', 'to', i.telefono, 'type', 'template',
    'template', jsonb_build_object('name', 'invitacion_cumple', 'language', jsonb_build_object('code', 'es_MX'),
      'components', jsonb_build_array(
        jsonb_build_object('type', 'body', 'parameters', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', trim(i.nombre)),
          jsonb_build_object('type', 'text', 'text', f.nombre),
          jsonb_build_object('type', 'text', 'text', f.edad || case when f.edad = 1 then ' año' else ' años' end),
          jsonb_build_object('type', 'text', 'text', (select upper(left(x, 1)) || substr(x, 2) from (select panel.fecha_larga(f.fecha::timestamp at time zone 'America/Monterrey') as x) y)),
          jsonb_build_object('type', 'text', 'text', panel.fiesta_horario(f.ini, f.fin)),
          jsonb_build_object('type', 'text', 'text', f.lugar))),
        jsonb_build_object('type', 'button', 'sub_type', 'url', 'index', '0', 'parameters', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', i.codigo)))
      ))));
end $$;
revoke all on function panel.fiesta_enviar_invitacion(uuid) from public, anon;
grant execute on function panel.fiesta_enviar_invitacion(uuid) to authenticated;

-- Recordatorio el día de la fiesta, a la hora elegida (por omisión 10:30), a quienes confirmaron que sí van.
create or replace function panel.fiesta_enviar_recordatorios() returns int
language plpgsql security definer set search_path = '' as $$
declare l timestamp := now() at time zone 'America/Monterrey'; r record; n int := 0;
begin
  for r in
    select x.id as rsvp_id, x.invitado_id, x.telefono, x.nombre, f.id as fiesta_id, f.nombre as festejado, f.ini, f.lugar,
           coalesce(i.codigo, 'general') as codigo
      from panel.fiesta_rsvps x
      join panel.fiestas f on f.id = x.fiesta_id
      left join panel.fiesta_invitados i on i.id = x.invitado_id
     where x.asiste and x.telefono is not null and f.recordatorio
       and f.fecha = l::date and l::time >= f.recordatorio_hora and l::time < least(f.ini, '20:00'::time)
       and not exists (select 1 from panel.fiesta_mensajes m where m.rsvp_id = x.id and m.tipo = 'recordatorio')
  loop
    perform panel.fiesta_wa(r.fiesta_id, r.invitado_id, r.rsvp_id, 'recordatorio', r.telefono, jsonb_build_object(
      'messaging_product', 'whatsapp', 'to', r.telefono, 'type', 'template',
      'template', jsonb_build_object('name', 'recordatorio_cumple', 'language', jsonb_build_object('code', 'es_MX'),
        'components', jsonb_build_array(
          jsonb_build_object('type', 'body', 'parameters', jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', trim(r.nombre)),
            jsonb_build_object('type', 'text', 'text', r.festejado),
            jsonb_build_object('type', 'text', 'text', to_char(r.ini, 'FMHH12:MI') || case when r.ini < '12:00' then ' am' else ' pm' end),
            jsonb_build_object('type', 'text', 'text', r.lugar))),
          jsonb_build_object('type', 'button', 'sub_type', 'url', 'index', '0', 'parameters', jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', r.codigo)))
        ))));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Lee las respuestas de Meta y marca enviado o error.
create or replace function panel.fiesta_revisar_mensajes() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update panel.fiesta_mensajes m
     set estado = case when h.status_code between 200 and 299 then 'enviado' else 'error' end,
         mensaje_id = h.content::jsonb #>> '{messages,0,id}',
         error = case when h.status_code between 200 and 299 then null
                      else coalesce(h.content::jsonb #>> '{error,error_data,details}', h.content::jsonb #>> '{error,message}', h.error_msg, 'Sin respuesta') end
    from net._http_response h
   where m.estado = 'enviando' and h.id = m.request_id;
  update panel.fiesta_mensajes set estado = 'error', error = 'Sin respuesta de WhatsApp'
   where estado = 'enviando' and creado_en < now() - interval '1 hour';
end $$;
revoke all on function panel.fiesta_enviar_recordatorios() from public, anon, authenticated;
revoke all on function panel.fiesta_revisar_mensajes() from public, anon;
grant execute on function panel.fiesta_revisar_mensajes() to authenticated;

select cron.unschedule('fiestas_whatsapp') where exists (select 1 from cron.job where jobname = 'fiestas_whatsapp');
select cron.schedule('fiestas_whatsapp', '*/15 * * * *',
  'select panel.fiesta_revisar_mensajes(); select panel.fiesta_enviar_recordatorios();');
