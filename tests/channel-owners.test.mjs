import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('separate channel owners route, answer, audit and retry only their own channel', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const folder = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(folder)).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(file, folder), 'utf8'));
    }
    const value = async (sql, args=[]) => (await db.query(sql,args)).rows[0]?.value;
    const event = (id, user, channel, text=null, callback=null, hash=null, reply=null) =>
      db.query('select public.nr_handle_event_v2($1,$2,900,$3,$4,$5,$6,$7,$8,901)',
        [id,user,channel,text,callback,hash,reply,reply!==null]);
    const effects = id => value("select payload->>'text' as value from requests_app.outbox where effect_key=$1",[id]);
    for (const [id,channel,hash] of [[1,'max','max-code'],[2,'telegram','tg-code']]) {
      await db.query('select public.nr_create_order_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,900,901)',[
        `00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,'Клиент','Заказ','Контрольный текст',
        hash,'ip-'+id,channel,'+79000000000',{weight:2}]);
    }
    const notifications=(await db.query("select channel,chat_id::int as recipient from requests_app.outbox order by id")).rows;
    assert.deepEqual(notifications,[{channel:'max',recipient:901},{channel:'telegram',recipient:900}]);
    await event('start-max',100,'max',null,null,'max-code');
    await event('1',101,'telegram',null,null,'tg-code');
    await event('owner-list',901,'max','/requests');
    await event('2',900,'telegram','/requests');
    const list = async id => JSON.stringify(await value('select payload as value from requests_app.outbox where effect_key=$1',[id]));
    assert.match(await list('max:owner-list'),/card:1/);
    assert.doesNotMatch(await list('max:owner-list'),/card:2/);
    assert.match(await list('update:2'),/card:2/);
    assert.doesNotMatch(await list('update:2'),/card:1/);
    await event('cross-owner',901,'max',null,'history:2');
    await event('3',900,'telegram',null,'done:1');
    await event('spoof',900,'max','/requests');
    await event('other-client',102,'max',null,'card:1');
    assert.equal(await effects('max:cross-owner'),'Обращение недоступно.');
    assert.equal(await effects('update:3'),'Обращение недоступно.');
    assert.match(await effects('max:spoof'),/недоступен/);
    assert.equal(await effects('max:other-client'),'Обращение недоступно.');
    await event('owner-prompt',901,'max',null,'reply:1');
    await event('client-prompt',100,'max',null,'reply:1');
    await event('4',900,'telegram',null,'reply:2');
    let job;
    while ((job=await value('select public.nr_claim_outbox() as value'))) {
      await db.query('select public.nr_delivered_remote($1,$2,$3)',[job.id,job.lease_token,'mid-'+job.id]);
    }
    const prompt = user => value('select message_id as value from requests_app.prompts where chat_id=$1',[user]);
    await event('answer-max',901,'max','Ответ MAX',null,null,await prompt(901));
    await event('question-max',100,'max','Уточнение MAX',null,null,await prompt(100));
    await event('5',900,'telegram','Ответ Telegram',null,null,await prompt(900));
    const outgoing=(await db.query("select channel,chat_id::int as recipient from requests_app.outbox where effect_key in ('max:answer-max:send','max:question-max:send','update:5:send') order by id")).rows;
    assert.deepEqual(outgoing,[{channel:'max',recipient:100},{channel:'max',recipient:901},{channel:'telegram',recipient:101}]);
    assert.equal(await value('select count(*)::int as value from requests_app.messages'),3);
    await event('answer-max',901,'max','Ответ MAX',null,null,await prompt(901));
    assert.equal(await value('select count(*)::int as value from requests_app.messages'),3);
    await event('status-max',901,'max',null,'progress:1');
    await event('6',900,'telegram',null,'done:2');
    assert.equal(await value('select status as value from requests_app.tickets where number=1'),'in_progress');
    assert.equal(await value('select status as value from requests_app.tickets where number=2'),'done');
    const failed=await value("update requests_app.outbox set state='failed',error_code='max_403' where effect_key='max:answer-max:send' returning id as value");
    await event('7',900,'telegram',null,'retry:'+failed);
    assert.equal(await value('select state as value from requests_app.outbox where id=$1',[failed]),'failed');
    await event('retry-max',901,'max',null,'retry:'+failed);
    assert.equal(await value('select state as value from requests_app.outbox where id=$1',[failed]),'pending');
    assert.equal(await value("select has_function_privilege('anon','public.nr_handle_event_v2(text,bigint,bigint,text,text,text,text,text,boolean,bigint)','EXECUTE') as value"),false);
  } finally { await db.close(); }
});
