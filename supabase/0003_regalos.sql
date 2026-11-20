-- Ideas de regalo: texto libre, tallas, lista con links y botón "Yo lo llevo" para que no se repitan.
-- Idempotente: se puede volver a correr.

alter table panel.fiestas add column if not exists regalos_texto text not null default '' check (length(regalos_texto) <= 400);
alter table panel.fiestas add column if not exists talla_ropa    text not null default '' check (length(talla_ropa) <= 40);
alter table panel.fiestas add column if not exists talla_zapato  text not null default '' check (length(talla_zapato) <= 40);

create table if not exists panel.fiesta_regalos (
  id            uuid primary key default gen_random_uuid(),
  fiesta_id     uuid not null references panel.fiestas(id) on delete cascade,
  nombre        text not null check (length(nombre) between 1 and 80),
  link          text not null default '' check (link = '' or (link ~* '^https://' and length(link) <= 600)),
  orden         int not null default 0,
  apartado_por  uuid references panel.fiesta_invitados(id) on delete set null,
  apartado_en   timestamptz,
  creado_en     timestamptz not null default now()
);
create index if not exists fiesta_regalos_fiesta on panel.fiesta_regalos (fiesta_id, orden, creado_en);

alter table panel.fiesta_regalos enable row level security;
drop policy if exists personal on panel.fiesta_regalos;
create policy personal on panel.fiesta_regalos for all to authenticated using (panel.es_personal()) with check (panel.es_personal());
grant select, insert, update, delete on panel.fiesta_regalos to authenticated;

-- Lista pública de regalos: sin decir quién apartó, solo si está apartado y si fue esta familia.
create or replace function panel.fiesta_regalos_lista(p_fiesta uuid, p_invitado uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'nombre', g.nombre, 'link', g.link,
    'apartado', g.apartado_por is not null, 'mio', p_invitado is not null and g.apartado_por = p_invitado)
    order by g.orden, g.creado_en), '[]'::jsonb)
  from panel.fiesta_regalos g where g.fiesta_id = p_fiesta
$$;
revoke all on function panel.fiesta_regalos_lista(uuid, uuid) from public, anon, authenticated;

-- Datos de la fiesta actual (ahora con regalos). OJO: 0004_envio.sql la reemplaza; córrelo después.
create or replace function panel.fiesta_publica(p_codigo text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f panel.fiestas; inv panel.fiesta_invitados; r panel.fiesta_rsvps; res jsonb;
begin
  select x.* into f from panel.fiestas x join panel.fiesta_actual a on a.fiesta_id = x.id;
  if f.id is null then return null; end if;
  if coalesce(p_codigo, '') <> '' then
    select * into inv from panel.fiesta_invitados where codigo = lower(p_codigo) and fiesta_id = f.id;
  end if;
  res := jsonb_build_object('nombre', f.nombre, 'edad', f.edad, 'fecha', f.fecha, 'ini', to_char(f.ini, 'HH24:MI'), 'fin', to_char(f.fin, 'HH24:MI'),
    'lugar', f.lugar, 'maps', f.maps, 'tel', f.tel, 'tema', f.tema, 'kicker', f.kicker, 'foto', f.foto,
    'regalos_texto', f.regalos_texto, 'talla_ropa', f.talla_ropa, 'talla_zapato', f.talla_zapato,
    'regalos', panel.fiesta_regalos_lista(f.id, inv.id));
  if inv.id is not null then
    res := res || jsonb_build_object('invitado', inv.nombre);
    select * into r from panel.fiesta_rsvps where invitado_id = inv.id;
    if r.id is not null then
      res := res || jsonb_build_object('respuesta', jsonb_build_object('nombre', r.nombre, 'asiste', r.asiste, 'adultos', r.adultos,
        'ninos', r.ninos, 'alergias', r.alergias, 'mensaje', r.mensaje));
    end if;
  end if;
  return res;
end $$;

-- "Yo lo llevo" / "Ya no lo llevo". Solo familias con su link. Devuelve la lista actualizada.
create or replace function panel.fiesta_apartar_regalo(p_codigo text, p_regalo uuid, p_apartar boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare f uuid; inv panel.fiesta_invitados; n int;
begin
  select fiesta_id into f from panel.fiesta_actual;
  select * into inv from panel.fiesta_invitados where codigo = lower(coalesce(p_codigo, '')) and fiesta_id = f;
  if inv.id is null then raise exception 'Invitación no encontrada'; end if;
  if p_apartar then
    if (select count(*) from panel.fiesta_regalos where fiesta_id = f and apartado_por = inv.id) >= 5 then
      raise exception 'Máximo 5 regalos por familia';
    end if;
    update panel.fiesta_regalos set apartado_por = inv.id, apartado_en = now()
      where id = p_regalo and fiesta_id = f and apartado_por is null;
    get diagnostics n = row_count;
    if n = 0 and not exists (select 1 from panel.fiesta_regalos where id = p_regalo and apartado_por = inv.id) then
      raise exception 'Ya lo lleva alguien';
    end if;
  else
    update panel.fiesta_regalos set apartado_por = null, apartado_en = null
      where id = p_regalo and fiesta_id = f and apartado_por = inv.id;
  end if;
  return panel.fiesta_regalos_lista(f, inv.id);
end $$;
revoke all on function panel.fiesta_apartar_regalo(text, uuid, boolean) from public;
grant execute on function panel.fiesta_apartar_regalo(text, uuid, boolean) to anon, authenticated;
