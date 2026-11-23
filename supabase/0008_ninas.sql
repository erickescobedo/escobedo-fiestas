-- Niños y niñas: "ninos" sigue siendo el total de niños(as); "ninas" dice cuántas son niñas (null = respuesta anterior, sin especificar).
alter table panel.fiesta_rsvps add column if not exists ninas int check (ninas between 0 and 20);

-- Confirmación con niñas (la versión de 8 parámetros de 0001 se queda para links abiertos con la versión anterior).
create or replace function panel.fiesta_confirmar(p_codigo text, p_nombre text, p_asiste boolean, p_adultos int, p_ninos int,
  p_alergias text, p_mensaje text, p_telefono text, p_ninas int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare f uuid; inv panel.fiesta_invitados; ni int; na int;
begin
  select fiesta_id into f from panel.fiesta_actual;
  if f is null then raise exception 'No hay fiesta activa'; end if;
  if p_asiste is null then raise exception 'Falta la respuesta'; end if;
  select * into inv from panel.fiesta_invitados where codigo = lower(coalesce(p_codigo, '')) and fiesta_id = f;
  if inv.id is null then raise exception 'Invitación no encontrada'; end if;
  ni := case when p_asiste then least(greatest(coalesce(p_ninos,0),0),20) else 0 end;
  na := case when p_asiste then least(greatest(coalesce(p_ninas,0),0),ni) else 0 end;
  insert into panel.fiesta_rsvps (fiesta_id, invitado_id, nombre, asiste, adultos, ninos, ninas, alergias, mensaje, telefono)
  values (f, inv.id, inv.nombre, p_asiste, case when p_asiste then least(greatest(coalesce(p_adultos,0),0),20) else 0 end, ni, na,
          left(trim(coalesce(p_alergias,'')), 200), left(trim(coalesce(p_mensaje,'')), 500), inv.telefono)
  on conflict (invitado_id) do update set nombre = excluded.nombre, asiste = excluded.asiste, adultos = excluded.adultos,
    ninos = excluded.ninos, ninas = excluded.ninas, alergias = excluded.alergias, mensaje = excluded.mensaje, telefono = excluded.telefono, actualizado_en = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function panel.fiesta_confirmar(text, text, boolean, int, int, text, text, text, int) from public;
grant execute on function panel.fiesta_confirmar(text, text, boolean, int, int, text, text, text, int) to anon, authenticated;

-- Datos de la fiesta actual (reemplaza la de 0007; solo agrega "ninas" a la respuesta).
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
    'regalos_texto', f.regalos_texto, 'talla_ropa', case when f.mostrar_tallas then f.talla_ropa else '' end, 'talla_zapato', case when f.mostrar_tallas then f.talla_zapato else '' end,
    'regalos', panel.fiesta_regalos_lista(f.id, inv.id));
  if inv.id is not null then
    res := res || jsonb_build_object('invitado', inv.nombre, 'envio', f.envio, 'tarjetas_correo', f.tarjetas_correo, 'tarjetas', f.tarjetas);
    select * into r from panel.fiesta_rsvps where invitado_id = inv.id;
    if r.id is not null then
      res := res || jsonb_build_object('respuesta', jsonb_build_object('nombre', r.nombre, 'asiste', r.asiste, 'adultos', r.adultos,
        'ninos', r.ninos, 'ninas', r.ninas, 'alergias', r.alergias, 'mensaje', r.mensaje));
    end if;
  end if;
  return res;
end $$;
