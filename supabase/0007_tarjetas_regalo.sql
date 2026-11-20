-- Tarjetas de regalo (Zara, H&M…): links de compra y el correo al que se envían.
-- El correo y los links solo van a familias con su link (código válido). El correo real se guarda desde el panel, no aquí.
alter table panel.fiestas add column if not exists tarjetas_correo text not null default '' check (length(tarjetas_correo) <= 120);
alter table panel.fiestas add column if not exists tarjetas jsonb not null default '[]'::jsonb check (jsonb_typeof(tarjetas) = 'array' and jsonb_array_length(tarjetas) <= 6);

-- Datos de la fiesta actual (reemplaza la de 0005).
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
        'ninos', r.ninos, 'alergias', r.alergias, 'mensaje', r.mensaje));
    end if;
  end if;
  return res;
end $$;
