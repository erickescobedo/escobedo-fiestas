-- Crear la fiesta del siguiente año a partir de una anterior, en un solo paso.
-- Copia los datos que se escriben en el panel y, si se pide, la lista de familias (con links nuevos) y las ideas de regalo (sin apartar).
-- Las tallas no se copian porque cambian cada año. Las fiestas anteriores no se tocan.
-- Idempotente: se puede volver a correr.

create or replace function panel.fiesta_nueva(p_base uuid, p_datos jsonb, p_invitados text default 'ninguno',
  p_regalos boolean default false, p_actual boolean default false)
returns uuid language plpgsql security definer set search_path = panel, public as $$
declare b panel.fiestas; nid uuid;
begin
  if not panel.es_personal() then raise exception 'Sin permiso'; end if;
  if p_invitados not in ('ninguno', 'todos', 'vinieron') then raise exception 'Opción de invitados no válida'; end if;
  if p_base is not null then select * into b from panel.fiestas where id = p_base; end if;

  insert into panel.fiestas (nombre, edad, fecha, ini, fin, lugar, maps, tel, tema, kicker, foto, recordatorio, recordatorio_hora,
                             regalos_texto, envio, mostrar_tallas, tarjetas_correo, tarjetas)
  values (p_datos->>'nombre', coalesce((p_datos->>'edad')::int, 1), (p_datos->>'fecha')::date, (p_datos->>'ini')::time, (p_datos->>'fin')::time,
          p_datos->>'lugar', coalesce(p_datos->>'maps', ''), coalesce(p_datos->>'tel', ''), coalesce(nullif(p_datos->>'tema', ''), 'dibujitos'),
          coalesce(p_datos->>'kicker', ''), coalesce(b.foto, ''), coalesce((p_datos->>'recordatorio')::boolean, true),
          coalesce(nullif(p_datos->>'recordatorio_hora', '')::time, '10:30'),
          coalesce(b.regalos_texto, ''), coalesce(b.envio, ''), coalesce(b.mostrar_tallas, true), coalesce(b.tarjetas_correo, ''), coalesce(b.tarjetas, '[]'::jsonb))
  returning id into nid;

  if b.id is not null and p_invitados <> 'ninguno' then
    -- Familias de la lista (todas, o solo las que dijeron que sí van).
    insert into panel.fiesta_invitados (fiesta_id, nombre, telefono)
    select nid, i.nombre, i.telefono from panel.fiesta_invitados i
    where i.fiesta_id = b.id
      and (p_invitados = 'todos' or exists (select 1 from panel.fiesta_rsvps r where r.invitado_id = i.id and r.asiste))
    on conflict (fiesta_id, telefono) do nothing;
    -- Quienes confirmaron sin link (agregados a mano o con el link general) y dejaron celular.
    insert into panel.fiesta_invitados (fiesta_id, nombre, telefono)
    select distinct on (r.telefono) nid, r.nombre, r.telefono from panel.fiesta_rsvps r
    where r.fiesta_id = b.id and r.invitado_id is null and coalesce(r.telefono, '') <> ''
      and (p_invitados = 'todos' or r.asiste)
    order by r.telefono, r.actualizado_en desc
    on conflict (fiesta_id, telefono) do nothing;
  end if;

  if b.id is not null and p_regalos then
    insert into panel.fiesta_regalos (fiesta_id, nombre, link, orden)
    select nid, g.nombre, g.link, g.orden from panel.fiesta_regalos g where g.fiesta_id = b.id;
  end if;

  if p_actual then update panel.fiesta_actual set fiesta_id = nid where id = true; end if;
  return nid;
end $$;

revoke all on function panel.fiesta_nueva(uuid, jsonb, text, boolean, boolean) from public, anon;
grant execute on function panel.fiesta_nueva(uuid, jsonb, text, boolean, boolean) to authenticated;
