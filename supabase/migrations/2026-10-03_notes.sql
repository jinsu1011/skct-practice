-- 2026-10-03: 문항별 메모·그림 저장 (30일 뒤 자동 삭제)
-- schema.sql 의 해당 부분만 모은 것 (schema.sql 전체를 다시 실행해도 결과는 같음)

alter table public.records add column if not exists notes jsonb;

-- p_sections: [{name, count, time, used, answers:[...], times:[...]}, ...]
-- p_external: 시험모드(북마크)처럼 사이트 밖에서 푼 기록이면 사용 시간을 접속 시간에도 더한다
create or replace function public.save_attempt(p_token uuid, p_sections jsonb, p_source text default null,
                                               p_external boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  v uuid := _uid(p_token);
  aid uuid := gen_random_uuid();
  s jsonb;
  rid uuid;
  cnt int;
  nts jsonb;
  saved jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) not between 1 and 10 then
    raise exception '잘못된 응시 기록입니다.';
  end if;
  -- 무료 용량을 넘지 않도록 30일 지난 메모·그림은 지운다 (답안·채점 기록은 유지)
  update records set notes = null where notes is not null and created_at < now() - interval '30 days';
  for s in select * from jsonb_array_elements(p_sections) loop
    cnt := (s->>'count')::int;
    if s->>'name' not in ('언어이해', '자료해석', '창의수리', '언어추리', '수열추리')
       or cnt not between 1 and 100
       or jsonb_array_length(s->'answers') <> cnt
       or jsonb_array_length(s->'times') <> cnt then
      raise exception '잘못된 응시 기록입니다.';
    end if;
    -- 메모는 2,000자, 그림은 약 45KB까지만 저장
    select nullif(coalesce(jsonb_agg(jsonb_build_object(
             'q', (n->>'q')::int,
             'memo', left(coalesce(n->>'memo', ''), 2000),
             'img', case when n->>'img' like 'data:image/%' and char_length(n->>'img') <= 60000 then n->>'img' end)), '[]'::jsonb), '[]'::jsonb)
      into nts
      from jsonb_array_elements(case when jsonb_typeof(s->'notes') = 'array' then s->'notes' else '[]'::jsonb end) n
     where coalesce(n->>'q', '') ~ '^[0-9]+$' and (n->>'q')::int < cnt
       and (coalesce(n->>'memo', '') <> '' or n->>'img' like 'data:image/%');
    insert into records (attempt_id, user_id, section, q_count, time_limit, used_sec, answers, times, source, notes)
    values (aid, v, s->>'name', cnt, least(greatest((s->>'time')::int, 1), 180),
            least(greatest(coalesce((s->>'used')::int, 0), 0), 180 * 60),
            s->'answers', s->'times', left(p_source, 300), nts)
    returning id into rid;
    saved := saved || jsonb_build_object('id', rid, 'section', s->>'name');
  end loop;
  if p_external then
    insert into visits (user_id, day, seconds)
    select v, (now() at time zone 'Asia/Seoul')::date, coalesce(sum(used_sec), 0) from records where attempt_id = aid
    on conflict (user_id, day) do update set seconds = visits.seconds + excluded.seconds;
  end if;
  return json_build_object('attempt_id', aid, 'records', saved);
end $$;

create or replace function public._user_data(p_uid uuid)
returns json language sql security definer set search_path = public as $$
  select json_build_object(
    'user', _profile(p_uid),
    'records', coalesce((select json_agg(r order by r.created_at)
                           from (select id, attempt_id, created_at, section, q_count, time_limit, used_sec,
                                        answers, times, answer_key, correct, graded, source,
                                        coalesce(jsonb_array_length(notes), 0) as note_count
                                   from records where user_id = p_uid) r), '[]'::json),
    'visits', coalesce((select json_agg(json_build_object('day', day, 'seconds', seconds) order by day)
                          from visits where user_id = p_uid), '[]'::json)
  );
$$;

-- 응시 1회의 문항별 메모·그림 (본인 또는 관리자만)
create or replace function public.attempt_notes(p_token uuid, p_attempt uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v uuid := _uid(p_token);
begin
  return coalesce((select json_agg(json_build_object('id', id, 'section', section, 'notes', notes) order by created_at)
                     from records
                    where attempt_id = p_attempt
                      and (user_id = v or exists (select 1 from users where id = v and is_admin))), '[]'::json);
end $$;

create or replace function public.admin_records(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  return coalesce((select json_agg(r order by r.created_at) from (
    select id, attempt_id, user_id, created_at, section, q_count, time_limit, used_sec,
           answers, times, answer_key, correct, graded, source,
           coalesce(jsonb_array_length(notes), 0) as note_count
      from records) r), '[]'::json);
end $$;

revoke execute on function public.attempt_notes(uuid, uuid) from public, anon, authenticated;
grant execute on function public.attempt_notes(uuid, uuid) to anon, authenticated;
