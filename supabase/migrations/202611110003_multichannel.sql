begin;
alter table requests_app.tickets
 add column channel text not null default 'telegram' check(channel in ('telegram','max')),
 add column contact_phone text,
 add column order_details jsonb;
alter table requests_app.tickets drop constraint tickets_check;
alter table requests_app.tickets add constraint tickets_link_state
 check ((status='draft' and chat_id is null) or status<>'draft');

alter table requests_app.updates add column channel text not null default 'telegram',
 add column event_id text;
update requests_app.updates set event_id=id::text;
alter table requests_app.updates drop constraint updates_pkey;
alter table requests_app.updates alter column id drop not null;
alter table requests_app.updates alter column event_id set not null;
alter table requests_app.updates add primary key(channel,event_id);
create index updates_rate on requests_app.updates(channel,chat_id,created_at);

alter table requests_app.prompts drop constraint prompts_pkey;
alter table requests_app.prompts alter column message_id type text using message_id::text;
alter table requests_app.prompts add column channel text not null default 'telegram';
alter table requests_app.prompts add primary key(channel,chat_id,message_id);

alter table requests_app.outbox add column channel text not null default 'telegram',
 add column sender_channel text,
 add column sender_id bigint;

create function requests_app.enqueue_channel(
 k text,c bigint,ch text,t text,m jsonb default null,p uuid default null,
 receipt_channel text default null,receipt_user bigint default null
) returns void language sql set search_path=pg_catalog as $$
 insert into requests_app.outbox(effect_key,chat_id,channel,payload,prompt_ticket,sender_channel,sender_id)
 values(k,c,ch,jsonb_strip_nulls(jsonb_build_object('chat_id',c,'text',t,'reply_markup',m)),p,receipt_channel,receipt_user)
 on conflict(effect_key) do nothing
$$;
create or replace function requests_app.enqueue(k text,c bigint,t text,m jsonb default null,p uuid default null)
returns void language sql set search_path=pg_catalog as $$
 select requests_app.enqueue_channel(k,c,coalesce(nullif(current_setting('requests_app.channel',true),''),'telegram'),t,m,p)
$$;

create function public.nr_handle_event(u text,c bigint,a bigint,p_channel text,txt text,cb text,h text,r text,bot_reply boolean)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare
 owner boolean:=p_channel='telegram' and coalesce(c=a,false);
 k text:=case when p_channel='telegram' then 'update:'||u else 'max:'||u end;
 t requests_app.tickets%rowtype;
 v text[];
 action text;
 filter text;
 page integer;
 rows jsonb;
 markup jsonb;
 output text;
 target bigint;
 cnt integer;
begin
 if p_channel not in ('telegram','max') or c is null or c<=0 or char_length(u)>200 then return; end if;
 perform set_config('requests_app.channel',p_channel,true);
 perform pg_advisory_xact_lock(hashtextextended(p_channel||':'||c,0));
 insert into requests_app.updates(id,chat_id,channel,event_id) values(case when p_channel='telegram' then u::bigint end,c,p_channel,u) on conflict do nothing;
 if not found then return; end if;
 if (select count(*) from requests_app.updates where chat_id=c and channel=p_channel and created_at>now()-interval '1 minute')>30 then return; end if;
 if txt='/id' and cb is null then
  perform requests_app.enqueue(k,c,case when p_channel='telegram' then 'Ваш Telegram ID: ' else 'Ваш MAX ID: ' end||c);
 elsif a is null then
  perform requests_app.enqueue(k,c,'Приём обращений пока не настроен.');
 elsif h is not null then
  update requests_app.tickets set chat_id=c,status=case when status='draft' then 'new' else status end
  where code_hash=h and channel=p_channel and chat_id is null and expires_at>now() returning * into t;
  if found then
   perform requests_app.enqueue(k||':client',c,'Обращение №'||t.number||' принято. /my — ваши обращения.');
   perform requests_app.enqueue_channel(k||':owner',a,'telegram','Обращение №'||t.number||case when t.order_details is null then ' · Новая' else ' · Клиент подключён' end||chr(10)||t.name||chr(10)||t.subject||chr(10)||t.description,
      jsonb_build_object('inline_keyboard',jsonb_build_array(jsonb_build_array(requests_app.button('Открыть','card:'||t.number)))));
  else
   select * into t from requests_app.tickets where code_hash=h and chat_id=c and channel=p_channel;
   perform requests_app.enqueue(k,c,case when found then 'Обращение №'||t.number||' уже подтверждено. /my — ваши обращения.'
     else 'Ссылка истекла или уже использована. Вернитесь на сайт и заполните форму снова.' end);
  end if;
 elsif txt in ('/retry') or cb ~ '^retry:[0-9]{1,15}$' then
  if not owner then perform requests_app.enqueue(k,c,'Команда недоступна. /my — ваши обращения.'); return; end if;
  if cb is not null then
   update requests_app.outbox set state='pending',error_code=null where id=split_part(cb,':',2)::bigint and state='failed';
   perform requests_app.enqueue(k,c,case when found then 'Повтор поставлен в очередь.' else 'Эта отправка больше не требует повтора.' end);
  else
   select jsonb_agg(jsonb_build_array(requests_app.button('Повторить №'||id||' · '||coalesce(error_code,'ошибка'),'retry:'||id)))
     into rows from (select id,error_code from requests_app.outbox where state='failed' order by id limit 8) x;
   perform requests_app.enqueue(k,c,case when rows is null then 'Ошибок доставки нет.' else 'Ошибки доставки. Выберите отправку для повтора.' end,
      case when rows is not null then jsonb_build_object('inline_keyboard',rows) end);
  end if;
 elsif txt in ('/my','/requests') or cb ~ '^list:(my|new|in_progress|all):[0-9]{1,5}$' then
  filter:=case when cb is not null then split_part(cb,':',2) when txt='/my' then 'my' else 'new' end;
  if filter<>'my' and not owner then perform requests_app.enqueue(k,c,'Список недоступен. /my — ваши обращения.'); return; end if;
  page:=case when cb is not null then split_part(cb,':',3)::int else 0 end;
  select coalesce(jsonb_agg(jsonb_build_array(requests_app.button('№'||number||' · '||left(subject,50),'card:'||number)) order by number desc),'[]'::jsonb)
  into rows from (select number,subject from requests_app.tickets
  where status<>'draft' and ((filter='my' and chat_id=c and channel=p_channel) or (filter<>'my' and (filter='all' or status=filter)))
  order by number desc offset page*8 limit 8) x;
  if owner and filter<>'my' then rows:=rows||jsonb_build_array(jsonb_build_array(
   requests_app.button('Новые','list:new:0'),requests_app.button('В работе','list:in_progress:0'),requests_app.button('Все','list:all:0'))); end if;
  if page>0 then rows:=rows||jsonb_build_array(jsonb_build_array(requests_app.button('← Назад','list:'||filter||':'||(page-1)))); end if;
  if page<99999 and exists(select 1 from requests_app.tickets
  where status<>'draft' and ((filter='my' and chat_id=c and channel=p_channel) or (filter<>'my' and (filter='all' or status=filter)))
  offset (page+1)*8 limit 1) then
   rows:=rows||jsonb_build_array(jsonb_build_array(requests_app.button('Дальше →','list:'||filter||':'||(page+1))));
  end if;
  perform requests_app.enqueue(k,c,'Обращения · страница '||(page+1),jsonb_build_object('inline_keyboard',rows));
 elsif cb ~ '^(card|history|reply|progress|done):[0-9]{1,15}(:[0-9]{1,5})?$' then
  v:=string_to_array(cb,':'); action:=v[1];
  select * into t from requests_app.tickets where number=v[2]::bigint and status<>'draft' and (owner or (chat_id=c and channel=p_channel)) for update;
  if not found or (action in ('progress','done') and not owner) then perform requests_app.enqueue(k,c,'Обращение недоступно.'); return; end if;
  if action='reply' then
   if t.chat_id is null then
    perform requests_app.enqueue(k,c,'Клиент ещё не подключил мессенджер. Телефон: '||coalesce(t.contact_phone,'не указан'));
    return;
   end if;
   perform requests_app.enqueue(k,c,'Обращение №'||t.number||case when p_channel='max' then '. Используйте действие «Ответить» на ЭТО сообщение и отправьте текст до 2000 символов.' else '. Ответьте на это сообщение текстом до 2000 символов.' end,
      '{"force_reply":true,"selective":true}'::jsonb,t.id);
   return;
  elsif action='history' then
   page:=coalesce(v[3]::int,0);
   select string_agg(case when from_owner then 'Ответ' else 'Уточнение' end||': '||body,chr(10) order by id desc)
     into output from (select * from requests_app.messages where ticket_id=t.id order by id desc offset page limit 1) x;
   rows:=jsonb_build_array(jsonb_build_array(requests_app.button('К карточке','card:'||t.number)));
   if page>0 then rows:=rows||jsonb_build_array(jsonb_build_array(requests_app.button('← Новее','history:'||t.number||':'||(page-1)))); end if;
   if page<99999 and exists(select 1 from requests_app.messages where ticket_id=t.id offset page+1 limit 1) then
    rows:=rows||jsonb_build_array(jsonb_build_array(requests_app.button('Раньше →','history:'||t.number||':'||(page+1)))); end if;
   perform requests_app.enqueue(k,c,'История №'||t.number||chr(10)||coalesce(output,'Переписка пока пуста.'),jsonb_build_object('inline_keyboard',rows));
   return;
  elsif action in ('progress','done') then
   filter:=case when action='progress' then 'in_progress' else 'done' end;
   if t.status<>filter then
    update requests_app.tickets set status=filter where id=t.id returning * into t;
    if t.chat_id is not null then
     perform requests_app.enqueue_channel(k||':status',t.chat_id,t.channel,'Обращение №'||t.number||': '||requests_app.status(t.status));
    end if;
   end if;
  end if;
  rows:=jsonb_build_array(jsonb_build_array(requests_app.button(case when owner then 'Ответить' else 'Написать уточнение' end,'reply:'||t.number),
      requests_app.button('История','history:'||t.number)));
  if owner then rows:=rows||jsonb_build_array(jsonb_build_array(requests_app.button('В работу','progress:'||t.number),requests_app.button('Завершить','done:'||t.number))); end if;
  rows:=rows||jsonb_build_array(jsonb_build_array(requests_app.button('К списку',case when owner then 'list:all:0' else 'list:my:0' end)));
  perform requests_app.enqueue(k,c,'№'||t.number||' · '||requests_app.status(t.status)||chr(10)||t.name||chr(10)||t.subject||chr(10)||t.description||case when owner then chr(10)||'Канал: '||t.channel||coalesce(chr(10)||'Телефон: '||t.contact_phone,'') else '' end,
   jsonb_build_object('inline_keyboard',rows));
 elsif r is not null then
  select q.* into t from requests_app.prompts p join requests_app.tickets q on q.id=p.ticket_id where p.chat_id=c and p.channel=p_channel and p.message_id=r;
  if not found then
   if bot_reply and exists(select 1 from requests_app.outbox where chat_id=c and channel=p_channel and prompt_ticket is not null
      and state='processing' and leased_until>now()) then
    raise exception using errcode='40001',message='Prompt delivery is being recorded';
   end if;
   perform requests_app.enqueue(k,c,'Откройте обращение и ответьте на подсказку бота. /my — ваши обращения.');
   return;
  end if;
  if not owner and (t.chat_id is distinct from c or t.channel<>p_channel) then return; end if;
  if txt is null or char_length(btrim(txt)) not between 1 and 2000 then
   perform requests_app.enqueue(k,c,'Нужен текст длиной от 1 до 2000 символов. Ответьте на ту же подсказку.'); return;
  end if;
  insert into requests_app.messages(ticket_id,from_owner,body) values(t.id,owner,txt);
  target:=case when owner then t.chat_id else a end;
  perform requests_app.enqueue_channel(k||':send',target,case when owner then t.channel else 'telegram' end,(case when owner then 'Ответ' else 'Уточнение' end)||' по обращению №'||t.number||chr(10)||txt,null,null,p_channel,c);
  perform requests_app.enqueue(k||':saved',c,'Сообщение сохранено и поставлено в очередь доставки.');
 else
  perform requests_app.enqueue(k,c,case when owner then 'Выберите обращение через /requests или /my.' else 'Выберите обращение через /my.' end);
 end if;
end $$;


create or replace function public.nr_handle_update(u bigint,c bigint,a bigint,txt text,cb text,h text,r bigint,bot_reply boolean)
returns void language sql security definer set search_path=pg_catalog as $$
 select public.nr_handle_event(u::text,c,a,'telegram',txt,cb,h,r::text,bot_reply)
$$;

create function public.nr_create_order(
 p_id uuid,p_name text,p_subject text,p_description text,p_code_hash text,p_ip_hash text,
 p_channel text,p_phone text,p_details jsonb,p_admin bigint
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare existing requests_app.tickets%rowtype; draft_result jsonb;
begin
 perform pg_advisory_xact_lock(927041);
 select * into existing from requests_app.tickets where id=p_id;
 if found then
  if existing.name<>p_name or existing.subject<>p_subject or existing.description<>p_description
   or existing.code_hash<>p_code_hash or existing.channel<>p_channel
   or existing.contact_phone is distinct from p_phone or existing.order_details is distinct from p_details
  then return '{"error":"conflict"}'::jsonb; end if;
  return jsonb_build_object('number',existing.number,'expires_at',existing.expires_at,
    'expired',existing.expires_at<=now());
 end if;
 if p_channel not in ('telegram','max') or p_phone !~ '^\+7[0-9]{10}$' or p_admin is null or p_admin<=0 then
  raise exception 'Invalid order settings';
 end if;
 draft_result:=public.nr_create_draft(p_id,p_name,p_subject,p_description,p_code_hash,p_ip_hash);
 if draft_result?'error' then return draft_result; end if;
 update requests_app.tickets set channel=p_channel,contact_phone=p_phone,order_details=p_details,status='new'
 where id=p_id returning * into existing;
 perform requests_app.enqueue_channel('order:'||p_id||':admin',p_admin,'telegram',
  'Новый заказ №'||existing.number||chr(10)||p_name||chr(10)||p_phone||chr(10)||p_description||
  chr(10)||'Клиент ещё не подключил '||case when p_channel='max' then 'MAX' else 'Telegram' end||'.',
  jsonb_build_object('inline_keyboard',jsonb_build_array(jsonb_build_array(
   requests_app.button('Открыть','card:'||existing.number)))));
 return jsonb_build_object('number',existing.number,'expires_at',existing.expires_at);
end $$;

create or replace function public.nr_claim_outbox()
returns jsonb language sql security definer set search_path=pg_catalog as $$
 with candidate as (
  select id from requests_app.outbox
  where state='pending' or (state='processing' and leased_until<=now())
  order by id limit 1 for update skip locked
 ), claimed as (
  update requests_app.outbox q set state='processing',attempts=attempts+1,
   lease_token=gen_random_uuid(),leased_until=now()+interval '60 seconds'
  from candidate where q.id=candidate.id returning q.id,q.lease_token,q.payload,q.channel
 )
 select (select to_jsonb(claimed) from claimed)
$$;

create function public.nr_delivered_remote(i bigint,l uuid,m text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare q requests_app.outbox%rowtype;
begin
 update requests_app.outbox set state='sent',lease_token=null,leased_until=null,error_code=null
 where id=i and lease_token=l and state='processing' returning * into q;
 if not found then return; end if;
 if q.prompt_ticket is not null then
  insert into requests_app.prompts(chat_id,message_id,ticket_id,channel)
   values(q.chat_id,m,q.prompt_ticket,q.channel) on conflict do nothing;
 end if;
 if q.sender_id is not null then
  perform requests_app.enqueue_channel(q.effect_key||':delivered',q.sender_id,q.sender_channel,'Сообщение доставлено адресату.');
 end if;
end $$;
create or replace function public.nr_delivered(i bigint,l uuid,m bigint)
returns void language sql security definer set search_path=pg_catalog as $$
 select public.nr_delivered_remote(i,l,m::text)
$$;

revoke all on all functions in schema requests_app from public,anon,authenticated;
revoke all on function public.nr_handle_event(text,bigint,bigint,text,text,text,text,text,boolean),
 public.nr_create_order(uuid,text,text,text,text,text,text,text,jsonb,bigint),
 public.nr_delivered_remote(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.nr_handle_event(text,bigint,bigint,text,text,text,text,text,boolean),
 public.nr_create_order(uuid,text,text,text,text,text,text,text,jsonb,bigint),
 public.nr_delivered_remote(bigint,uuid,text) to service_role;
commit;
