-- Private Yacht Club — NDA archive
-- Table holds one row per signed NDA; the PDF itself lives in the private `ndas`
-- storage bucket and is referenced by `pdf_path`. Access is server-only via the
-- service-role key (RLS enabled, no policies → anon/authenticated have no access).

create table if not exists public.ndas (
  id          uuid primary key default gen_random_uuid(),
  lead_id     text,
  first_name  text not null,
  last_name   text not null,
  email       text not null,
  phone       text,
  job_title   text,
  company     text,
  industry    text,
  nda_version text,
  signed_at   timestamptz not null default now(),
  ip          text,
  user_agent  text,
  pdf_path    text not null,
  created_at  timestamptz not null default now()
);

-- Sorting / lookup the owner dashboard relies on.
create index if not exists ndas_last_name_idx on public.ndas (lower(last_name), lower(first_name));
create index if not exists ndas_email_idx     on public.ndas (lower(email));

-- Lock the table down. The server uses the service-role key, which bypasses RLS;
-- everyone else gets nothing because no policies are defined.
alter table public.ndas enable row level security;

-- Private bucket for the signed NDA PDFs (no public read; access via signed URLs only).
insert into storage.buckets (id, name, public)
values ('ndas', 'ndas', false)
on conflict (id) do nothing;
