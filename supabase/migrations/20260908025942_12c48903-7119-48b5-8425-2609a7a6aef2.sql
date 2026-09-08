
create extension if not exists vector with schema public;

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  course text,
  subject text,
  semester text,
  doc_type text,
  source_filename text,
  page_count integer not null default 0,
  char_count integer not null default 0,
  chunk_count integer not null default 0,
  status text not null default 'ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resource_chunks (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  page integer,
  section text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

alter table public.resource_chunks
  add column if not exists tsv tsvector
  generated always as (to_tsvector('english', content)) stored;

create index if not exists resource_chunks_resource_idx on public.resource_chunks(resource_id);
create index if not exists resource_chunks_tsv_idx on public.resource_chunks using gin(tsv);
create index if not exists resource_chunks_embedding_idx
  on public.resource_chunks using hnsw (embedding vector_cosine_ops);

grant all on public.resources to service_role;
grant all on public.resource_chunks to service_role;

alter table public.resources enable row level security;
alter table public.resource_chunks enable row level security;

create policy "resources_service_only" on public.resources for all to service_role using (true) with check (true);
create policy "resource_chunks_service_only" on public.resource_chunks for all to service_role using (true) with check (true);

create or replace function public.match_resource_chunks(
  query_embedding vector(1536),
  match_count integer default 6,
  filter_course text default null,
  min_similarity double precision default 0.15
)
returns table (
  chunk_id uuid,
  resource_id uuid,
  title text,
  course text,
  subject text,
  page integer,
  section text,
  chunk_index integer,
  content text,
  similarity double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, r.id, r.title, r.course, r.subject, c.page, c.section, c.chunk_index, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.resource_chunks c
  join public.resources r on r.id = c.resource_id
  where c.embedding is not null
    and (filter_course is null or r.course = filter_course)
    and 1 - (c.embedding <=> query_embedding) > min_similarity
  order by c.embedding <=> query_embedding
  limit match_count
$$;
