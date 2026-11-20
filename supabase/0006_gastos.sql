-- Control de gastos de la fiesta: cada gasto (salón, entradas extra, pastel…) con sus pagos y el recibo de cada pago.
-- Solo el personal del panel. Idempotente: se puede volver a correr.

create table if not exists panel.fiesta_gastos (
  id            uuid primary key default gen_random_uuid(),
  fiesta_id     uuid not null references panel.fiestas(id) on delete cascade,
  concepto      text not null check (length(concepto) between 1 and 100),
  proveedor     text not null default '' check (length(proveedor) <= 100),
  total         numeric(12,2) not null default 0 check (total >= 0),
  fecha_limite  date,
  notas         text not null default '' check (length(notas) <= 500),
  creado_en     timestamptz not null default now()
);
create index if not exists fiesta_gastos_fiesta on panel.fiesta_gastos (fiesta_id, creado_en);

create table if not exists panel.fiesta_pagos (
  id             uuid primary key default gen_random_uuid(),
  gasto_id       uuid not null references panel.fiesta_gastos(id) on delete cascade,
  fiesta_id      uuid not null references panel.fiestas(id) on delete cascade,
  monto          numeric(12,2) not null check (monto > 0),
  fecha          date not null default (now() at time zone 'America/Monterrey')::date,
  metodo         text not null default '' check (length(metodo) <= 40),
  nota           text not null default '' check (length(nota) <= 200),
  recibo         text not null default '' check (length(recibo) <= 300),
  recibo_nombre  text not null default '' check (length(recibo_nombre) <= 200),
  creado_en      timestamptz not null default now()
);
create index if not exists fiesta_pagos_gasto on panel.fiesta_pagos (gasto_id, fecha);

do $$ declare t text; begin
  foreach t in array array['fiesta_gastos','fiesta_pagos'] loop
    execute format('alter table panel.%I enable row level security', t);
    execute format('drop policy if exists personal on panel.%I', t);
    execute format('create policy personal on panel.%I for all to authenticated using (panel.es_personal()) with check (panel.es_personal())', t);
    execute format('grant select, insert, update, delete on panel.%I to authenticated', t);
  end loop;
end $$;

-- Recibos: bucket privado; solo el personal sube, ve y borra. Se ven con links temporales.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fiesta-recibos', 'fiesta-recibos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists fiesta_recibos_personal on storage.objects;
create policy fiesta_recibos_personal on storage.objects for all to authenticated
  using (bucket_id = 'fiesta-recibos' and panel.es_personal())
  with check (bucket_id = 'fiesta-recibos' and panel.es_personal());
