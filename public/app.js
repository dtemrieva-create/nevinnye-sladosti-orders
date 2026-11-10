'use strict';
const form=document.querySelector('#application'), submit=document.querySelector('#submit'), notice=document.querySelector('#notice'), config=window.PUBLIC_CONFIG;
let requestId=crypto.randomUUID(), previousPayload='';
const configured=config&&/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/create-application$/.test(config.createApplicationUrl)&&/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(config.botUsername);
if(configured){submit.disabled=false;notice.textContent='Ответим в Telegram после подтверждения обращения.';}
form.addEventListener('input',()=>{for(const field of ['name','subject','description'])document.querySelector(`[data-count="${field}"]`).textContent=`${form.elements[field].value.length} / ${form.elements[field].maxLength}`;});
form.addEventListener('submit',async event=>{event.preventDefault();if(!configured||submit.disabled||!form.reportValidity())return;
const payload=Object.fromEntries(['name','subject','description','website'].map(k=>[k,form.elements[k].value.trim()]));
if(!payload.name||!payload.subject||payload.description.length<5){notice.textContent='Заполните имя, тему и описание (не менее 5 символов).';return;}
const content=JSON.stringify(payload);if(previousPayload&&previousPayload!==content)requestId=crypto.randomUUID();previousPayload=content;
submit.disabled=true;notice.textContent='Сохраняем черновик…';
try{const response=await fetch(config.createApplicationUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,idempotency_key:requestId})});const result=await response.json();if(!response.ok)throw Error('request');const url=new URL(result.confirmation_url);if(url.protocol!=='https:'||url.hostname!=='t.me'||url.port||url.username||url.password||url.pathname!==`/${config.botUsername}`||url.hash||!/^\?start=[A-Za-z0-9_-]{43}$/.test(url.search))throw Error('url');document.querySelector('#telegram').href=url.href;form.hidden=true;document.querySelector('#confirm').hidden=false;notice.textContent='Черновик сохранён. Подтвердите обращение в Telegram.';}catch{notice.textContent='Не удалось продолжить. Ваш текст сохранён в форме. Попробуйте ещё раз позже.';}finally{submit.disabled=false;}});
document.querySelector('#back').addEventListener('click',()=>{form.hidden=false;document.querySelector('#confirm').hidden=true;});
