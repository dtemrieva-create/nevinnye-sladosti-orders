begin;
create schema requests_app;
revoke all on schema requests_app from public, anon, authenticated;
create table requests_app.tickets (
 id uuid primary key,
 number bigint generated always as identity unique,
 name text not null check (char_length(name) between 1 and 80),
 subject text not null check (char_length(subject) between 1 and 120),
 description text not null check (char_length(description) between 5 and 2000),
 code_hash text not null unique,
 ip_hash text not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '30 minutes'),
 chat_id bigint,
 status text not null default 'draft' check (status in ('draft','new','in_progress','done')),
 check ((status='draft') = (chat_id is null))
);
create index on requests_app.tickets (ip_hash,created_at);
create index on requests_app.tickets (created_at);
create index on requests_app.tickets (chat_id,number desc);
create table requests_app.messages (
 id bigint generated always as identity primary key,
 ticket_id uuid not null references requests_app.tickets(id),
 from_owner boolean not null,
 body text not null check(char_length(body) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index on requests_app.messages (ticket_id,id desc);
create table requests_app.updates (
 id bigint primary key, chat_id bigint not null, created_at timestamptz not null default now()
);
create index on requests_app.updates (chat_id,created_at);
create table requests_app.outbox (
 id bigint generated always as identity primary key,
 effect_key text not null unique,
 chat_id bigint not null,
 payload jsonb not null,
 prompt_ticket uuid references requests_app.tickets(id),
 state text not null default 'pending' check(state in ('pending','processing','sent','failed')),
 attempts integer not null default 0,
 error_code text,
 lease_token uuid,
 leased_until timestamptz,
 check ((state='processing')=(lease_token is not null and leased_until is not null))
);
create index on requests_app.outbox (id) where state in ('pending','processing');
create table requests_app.prompts (
 chat_id bigint not null, message_id bigint not null,
 ticket_id uuid not null references requests_app.tickets(id),
 primary key(chat_id,message_id)
);
alter table requests_app.tickets enable row level security;
alter table requests_app.messages enable row level security;
alter table requests_app.updates enable row level security;
alter table requests_app.outbox enable row level security;
alter table requests_app.prompts enable row level security;
revoke all on all tables in schema requests_app from public, anon, authenticated;
revoke all on all sequences in schema requests_app from public, anon, authenticated;

create function public.nr_create_draft(p_id uuid,p_name text,p_subject text,p_description text,p_code_hash text,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare existing requests_app.tickets%rowtype;
begin
 perform pg_advisory_xact_lock(927041);
 select * into existing from requests_app.tickets where id=p_id;
 if found then
   if (existing.name,existing.subject,existing.description,existing.code_hash)
      is distinct from (p_name,p_subject,p_description,p_code_hash) then
     return '{"error":"conflict"}'::jsonb;
   end if;
   if existing.expires_at<=now() then return '{"error":"expired"}'::jsonb; end if;
   return jsonb_build_object('expires_at',existing.expires_at);
 end if;
 if (select count(*) from requests_app.tickets where created_at>now()-interval '1 day')>=500
 or (select count(*) from requests_app.tickets where ip_hash=p_ip_hash and created_at>now()-interval '10 minutes')>=10
 then return '{"error":"rate"}'::jsonb; end if;
 delete from requests_app.tickets where status='draft' and created_at<now()-interval '1 day';
 insert into requests_app.tickets(id,name,subject,description,code_hash,ip_hash)
 values(p_id,p_name,p_subject,p_description,p_code_hash,p_ip_hash) returning * into existing;
 return jsonb_build_object('expires_at',existing.expires_at);
end $$;
revoke all on function public.nr_create_draft(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.nr_create_draft(uuid,text,text,text,text,text) to service_role;
commit;
