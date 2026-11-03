
-- Save a chat only after a successful AI reply. Both turns and the thread
-- are committed in ONE database transaction, never partially.
create or replace function public.loox_chat_commit(
 p_user uuid,p_thread uuid,p_model text,p_question text,p_answer text
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare v_id uuid;
begin
 if p_model not in ('free','premium')
    or p_question is null or length(btrim(p_question)) not between 1 and 1800
    or p_answer is null or length(btrim(p_answer)) not between 1 and 6000 then
   raise exception 'Invalid chat turn' using errcode='22023';
 end if;
 if p_thread is null then
  insert into public.loox_chat_threads(user_id,model,title)
    values(p_user,p_model,left(regexp_replace(btrim(p_question),'\s+',' ','g'),110))
    returning id into v_id;
 else
  select id into v_id from public.loox_chat_threads
   where id=p_thread and user_id=p_user and model=p_model for update;
  if v_id is null then
   raise exception 'Conversation not found' using errcode='22023';
  end if;
  update public.loox_chat_threads
   set title=case when title='New chat' then left(regexp_replace(btrim(p_question),'\s+',' ','g'),110) else title end,
       updated_at=now()
   where id=v_id;
 end if;
 insert into public.loox_chat_messages(thread_id,role,content)
  values (v_id,'user',btrim(p_question)),
         (v_id,'assistant',btrim(p_answer));
 return v_id;
end $$;
revoke all on function public.loox_chat_commit(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.loox_chat_commit(uuid,uuid,text,text,text) to service_role;
