begin;
create function requests_app.enqueue(k text,c bigint,t text,m jsonb default null,p uuid default null)
returns void language sql set search_path=pg_catalog as $$
insert into requests_app.outbox(effect_key,chat_id,payload,prompt_ticket)
values(k,c,jsonb_strip_nulls(jsonb_build_object('chat_id',c,'text',t,'reply_markup',m)),p)
on conflict(effect_key) do nothing
$$;
create function requests_app.button(t text,d text) returns jsonb language sql immutable
set search_path=pg_catalog as $$select jsonb_build_object('text',t,'callback_data',d)$$;
create function requests_app.status(s text) returns text language sql immutable set search_path=pg_catalog as $$
select case s when 'new' then 'Новая' when 'in_progress' then 'В работе' when 'done' then 'Завершена' end
$$;
create function public.nr_handle_update(u bigint,c bigint,a bigint,txt text,cb text,h text,r bigint,bot_reply boolean)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare
 owner boolean:=coalesce(c=a,false);
 k text:='update:'||u;
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
 perform pg_advisory_xact_lock(c);
 insert into requests_app.updates(id,chat_id) values(u,c) on conflict do nothing;
 if not found then return; end if;
 if (select count(*) from requests_app.updates where chat_id=c and created_at>now()-interval '1 minute')>30 then return; end if;
 if txt='/id' and cb is null then
  perform requests_app.enqueue(k,c,'Ваш Telegram ID: '||c);
 elsif a is null then
  perform requests_app.enqueue(k,c,'Приём обращений пока не настроен.');
 elsif h is not null then
  update requests_app.tickets set chat_id=c,status='new'
  where code_hash=h and status='draft' and expires_at>now() returning * into t;
  if found then
   perform requests_app.enqueue(k||':client',c,'Обращение №'||t.number||' принято. /my — ваши обращения.');
   perform requests_app.enqueue(k||':owner',a,'Обращение №'||t.number||' · Новая'||chr(10)||t.name||chr(10)||t.subject||chr(10)||t.description,
      jsonb_build_object('inline_keyboard',jsonb_build_array(jsonb_build_array(requests_app.button('Открыть','card:'||t.number)))));
  else
   select * into t from requests_app.tickets where code_hash=h and chat_id=c;
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
  where status<>'draft' and ((filter='my' and chat_id=c) or (filter<>'my' and (filter='all' or status=filter)))
  order by number desc offset page*8 limit 8) x;
  if owner and filter<>'my' then rows:=rows||jsonb_build_array(jsonb_build_array(
   requests_app.button('Новые','list:new:0'),requests_app.button('В работе','list:in_progress:0'),requests_app.button('Все','list:all:0'))); end if;
  if page>0 then rows:=rows||jsonb_build_array(jsonb_build_array(requests_app.button('← Назад','list:'||filter||':'||(page-1)))); end if;
  if page<99999 and exists(select 1 from requests_app.tickets
  where status<>'draft' and ((filter='my' and chat_id=c) or (filter<>'my' and (filter='all' or status=filter)))
  offset (page+1)*8 limit 1) then
   rows:=rows||jsonb_build_array(jsonb_build_array(requests_app.button('Дальше →','list:'||filter||':'||(page+1))));
  end if;
  perform requests_app.enqueue(k,c,'Обращения · страница '||(page+1),jsonb_build_object('inline_keyboard',rows));
 elsif cb ~ '^(card|history|reply|progress|done):[0-9]{1,15}(:[0-9]{1,5})?$' then
  v:=string_to_array(cb,':'); action:=v[1];
  select * into t from requests_app.tickets where number=v[2]::bigint and status<>'draft' and (owner or chat_id=c) for update;
  if not found or (action in ('progress','done') and not owner) then perform requests_app.enqueue(k,c,'Обращение недоступно.'); return; end if;
  if action='reply' then
   perform requests_app.enqueue(k,c,'Обращение №'||t.number||'. Ответьте на это сообщение текстом до 2000 символов.',
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
    perform requests_app.enqueue(k||':status',t.chat_id,'Обращение №'||t.number||': '||requests_app.status(t.status));
   end if;
  end if;
  rows:=jsonb_build_array(jsonb_build_array(requests_app.button(case when owner then 'Ответить' else 'Написать уточнение' end,'reply:'||t.number),
      requests_app.button('История','history:'||t.number)));
  if owner then rows:=rows||jsonb_build_array(jsonb_build_array(requests_app.button('В работу','progress:'||t.number),requests_app.button('Завершить','done:'||t.number))); end if;
  rows:=rows||jsonb_build_array(jsonb_build_array(requests_app.button('К списку',case when owner then 'list:all:0' else 'list:my:0' end)));
  perform requests_app.enqueue(k,c,'№'||t.number||' · '||requests_app.status(t.status)||chr(10)||t.name||chr(10)||t.subject||chr(10)||t.description,
   jsonb_build_object('inline_keyboard',rows));
 elsif r is not null then
  select q.* into t from requests_app.prompts p join requests_app.tickets q on q.id=p.ticket_id where p.chat_id=c and p.message_id=r;
  if not found then
   if bot_reply and exists(select 1 from requests_app.outbox where chat_id=c and prompt_ticket is not null
      and state='processing' and leased_until>now()) then
    raise exception using errcode='40001',message='Prompt delivery is being recorded';
   end if;
   perform requests_app.enqueue(k,c,'Откройте обращение и ответьте на подсказку бота. /my — ваши обращения.');
   return;
  end if;
  if not owner and t.chat_id<>c then return; end if;
  if txt is null or char_length(btrim(txt)) not between 1 and 2000 then
   perform requests_app.enqueue(k,c,'Нужен текст длиной от 1 до 2000 символов. Ответьте на ту же подсказку.'); return;
  end if;
  insert into requests_app.messages(ticket_id,from_owner,body) values(t.id,owner,txt);
  target:=case when owner then t.chat_id else a end;
  perform requests_app.enqueue(k||':send',target,(case when owner then 'Ответ' else 'Уточнение' end)||' по обращению №'||t.number||chr(10)||txt);
  perform requests_app.enqueue(k||':saved',c,'Сообщение сохранено и поставлено в очередь доставки.');
 else
  perform requests_app.enqueue(k,c,case when owner then 'Выберите обращение через /requests или /my.' else 'Выберите обращение через /my.' end);
 end if;
end $$;

create function public.nr_claim_outbox()
returns jsonb language sql security definer set search_path=pg_catalog as $$
with candidate as (
 select id from requests_app.outbox
 where state='pending' or (state='processing' and leased_until<=now())
 order by id limit 1 for update skip locked
), claimed as (
 update requests_app.outbox q set state='processing',attempts=attempts+1,
 lease_token=gen_random_uuid(),leased_until=now()+interval '60 seconds'
 from candidate where q.id=candidate.id returning q.id,q.lease_token,q.payload
)
select (select to_jsonb(claimed) from claimed)
$$;
create function public.nr_delivered(i bigint,l uuid,m bigint)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare q requests_app.outbox%rowtype;
begin
 update requests_app.outbox set state='sent',lease_token=null,leased_until=null,error_code=null
 where id=i and lease_token=l and state='processing' returning * into q;
 if found and q.prompt_ticket is not null then
  insert into requests_app.prompts values(q.chat_id,m,q.prompt_ticket) on conflict do nothing;
 end if;
end $$;
create function public.nr_failed(i bigint,l uuid,e text)
returns void language sql security definer set search_path=pg_catalog as $$
update requests_app.outbox set state='failed',lease_token=null,leased_until=null,error_code=left(e,40)
where id=i and lease_token=l and state='processing'
$$;
create function public.nr_pending_count()
returns bigint language sql security definer set search_path=pg_catalog as $$
select count(*) from requests_app.outbox where state in ('pending','processing')
$$;
revoke all on all functions in schema requests_app from public,anon,authenticated;
revoke all on function public.nr_handle_update(bigint,bigint,bigint,text,text,text,bigint,boolean),
 public.nr_claim_outbox(),public.nr_delivered(bigint,uuid,bigint),public.nr_failed(bigint,uuid,text),
 public.nr_pending_count() from public,anon,authenticated;
grant execute on function public.nr_handle_update(bigint,bigint,bigint,text,text,text,bigint,boolean),
 public.nr_claim_outbox(),public.nr_delivered(bigint,uuid,bigint),public.nr_failed(bigint,uuid,text),
 public.nr_pending_count() to service_role;
commit;
