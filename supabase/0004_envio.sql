-- Dirección para enviar regalos a casa. Solo la ven las familias con su link personal, nunca la página general.
alter table panel.fiestas add column if not exists envio text not null default '' check (length(envio) <= 400);

-- Datos de la fiesta actual. La dirección de envío solo va a familias con su link (código válido).
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
    res := res || jsonb_build_object('invitado', inv.nombre, 'envio', f.envio);
    select * into r from panel.fiesta_rsvps where invitado_id = inv.id;
    if r.id is not null then
      res := res || jsonb_build_object('respuesta', jsonb_build_object('nombre', r.nombre, 'asiste', r.asiste, 'adultos', r.adultos,
        'ninos', r.ninos, 'alergias', r.alergias, 'mensaje', r.mensaje));
    end if;
  end if;
  return res;
end $$;

-- La dirección real se guarda desde el panel (pestaña Regalos); nunca en este repositorio, que es público.
