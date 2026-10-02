-- =====================================================================
-- SKCT 연습 사이트 DB 스키마
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전합니다.
--
-- 보안 구조
--  · 모든 테이블은 RLS가 켜져 있고 정책이 없어 브라우저에서 직접 읽고 쓸 수 없습니다.
--  · 브라우저는 아래 RPC 함수만 호출할 수 있고, 함수가 세션 토큰으로 사용자를 확인합니다.
--  · 비밀번호는 bcrypt 해시로만 저장됩니다.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- 테이블 ----------
create table if not exists public.users (
  id          uuid primary key default gen_random_uuid(),
  username    text not null unique,
  pw_hash     text not null,
  name        text not null,
  campus      text,                 -- 광주 / 울산 / 판교 (관리자는 비워둠)
  class_no    int,                  -- 1 ~ 10
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

create table if not exists public.sessions (
  token       uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days'
);

create table if not exists public.login_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.users(id) on delete cascade,
  username    text,
  kind        text not null,        -- signup / login / logout / fail
  user_agent  text,
  at          timestamptz not null default now()
);

create table if not exists public.visits (
  user_id     uuid not null references public.users(id) on delete cascade,
  day         date not null,
  seconds     int not null default 0,
  primary key (user_id, day)
);

create table if not exists public.records (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null,
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  section     text not null,
  q_count     int not null,
  time_limit  int not null,         -- 분
  used_sec    int not null default 0,
  answers     jsonb not null,       -- [1~5 | null, ...]
  times       jsonb not null,       -- [초, ...]
  answer_key  text,                 -- 본인이 입력한 정답 '32514...'
  correct     int,
  graded      int not null default 0,
  source      text
);

create table if not exists public.app_settings (
  key         text primary key,
  value       text not null
);

create index if not exists records_user_idx on public.records (user_id, created_at);
create index if not exists login_logs_at_idx on public.login_logs (at desc);
create index if not exists sessions_user_idx on public.sessions (user_id);

alter table public.users      enable row level security;
alter table public.sessions   enable row level security;
alter table public.login_logs enable row level security;
alter table public.visits     enable row level security;
alter table public.records    enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.users, public.sessions, public.login_logs, public.visits, public.records, public.app_settings
  from anon, authenticated;

-- 예전 버전 함수 정리 (인자가 바뀐 함수)
drop function if exists public.signup(text, text, text, text, int, text);
drop function if exists public.save_attempt(uuid, jsonb, text);

-- ---------- 내부 함수 ----------
create or replace function public._uid(p_token uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  select user_id into v from sessions where token = p_token and expires_at > now();
  if v is null then
    raise exception '로그인이 만료되었습니다. 다시 로그인해 주세요.' using errcode = 'P0401';
  end if;
  return v;
end $$;

create or replace function public._admin(p_token uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := _uid(p_token);
begin
  if not exists (select 1 from users where id = v and is_admin) then
    raise exception '관리자만 사용할 수 있습니다.' using errcode = 'P0403';
  end if;
  return v;
end $$;

create or replace function public._profile(p_uid uuid)
returns json language sql security definer set search_path = public as $$
  select json_build_object('id', id, 'username', username, 'name', name, 'campus', campus,
                           'class_no', class_no, 'is_admin', is_admin, 'created_at', created_at)
  from users where id = p_uid;
$$;

-- ---------- 회원가입 / 로그인 ----------
-- 가입 코드가 설정돼 있는지 (로그인 화면에서 확인)
create or replace function public.signup_info()
returns json language sql security definer set search_path = public as $$
  select json_build_object('code_required', exists (select 1 from app_settings where key = 'signup_code'));
$$;

create or replace function public.signup(p_username text, p_password text, p_name text,
                                         p_campus text, p_class int, p_ua text default null,
                                         p_code text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v uuid; t uuid; code text;
begin
  select value into code from app_settings where key = 'signup_code';
  if code is not null and coalesce(trim(p_code), '') <> code then
    raise exception '가입 코드가 올바르지 않습니다. 운영진에게 받은 코드를 입력해 주세요.';
  end if;
  p_username := lower(trim(p_username));
  p_name := trim(p_name);
  if p_username !~ '^[a-z0-9_]{4,20}$' then
    raise exception '아이디는 영문 소문자·숫자·_ 4~20자로 입력해 주세요.';
  end if;
  if coalesce(char_length(p_password), 0) < 6 then
    raise exception '비밀번호는 6자 이상이어야 합니다.';
  end if;
  if char_length(p_name) not between 1 and 20 then
    raise exception '이름을 1~20자로 입력해 주세요.';
  end if;
  if p_campus not in ('광주', '울산', '판교') or p_class not between 1 and 10 then
    raise exception '캠퍼스와 반을 선택해 주세요.';
  end if;
  if exists (select 1 from users where username = p_username) then
    raise exception '이미 사용 중인 아이디입니다.';
  end if;

  insert into users (username, pw_hash, name, campus, class_no, last_seen)
  values (p_username, crypt(p_password, gen_salt('bf')), p_name, p_campus, p_class, now())
  returning id into v;
  insert into sessions (user_id) values (v) returning token into t;
  insert into login_logs (user_id, username, kind, user_agent) values (v, p_username, 'signup', left(p_ua, 300));
  return json_build_object('token', t, 'user', _profile(v));
end $$;

create or replace function public.login(p_username text, p_password text, p_ua text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare u users; t uuid; fails int;
begin
  p_username := lower(trim(p_username));
  select count(*) into fails from login_logs
   where username = p_username and kind = 'fail' and at > now() - interval '10 minutes';
  -- 실패는 예외 대신 error 값으로 돌려준다 (예외를 던지면 실패 기록까지 롤백되므로)
  if fails >= 10 then
    return json_build_object('error', '로그인 실패가 너무 많습니다. 10분 뒤에 다시 시도해 주세요.');
  end if;

  select * into u from users where username = p_username;
  if u.id is null or u.pw_hash <> crypt(p_password, u.pw_hash) then
    insert into login_logs (user_id, username, kind, user_agent) values (u.id, p_username, 'fail', left(p_ua, 300));
    return json_build_object('error', '아이디 또는 비밀번호가 올바르지 않습니다.');
  end if;

  delete from sessions where user_id = u.id and expires_at < now();
  insert into sessions (user_id) values (u.id) returning token into t;
  insert into login_logs (user_id, username, kind, user_agent) values (u.id, u.username, 'login', left(p_ua, 300));
  update users set last_seen = now() where id = u.id;
  return json_build_object('token', t, 'user', _profile(u.id));
end $$;

create or replace function public.me(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v uuid := _uid(p_token);
begin
  update users set last_seen = now() where id = v;
  return _profile(v);
end $$;

create or replace function public.logout(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select user_id into v from sessions where token = p_token;
  if v is not null then
    insert into login_logs (user_id, username, kind) select v, username, 'logout' from users where id = v;
    delete from sessions where token = p_token;
  end if;
end $$;

create or replace function public.change_password(p_token uuid, p_old text, p_new text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := _uid(p_token);
begin
  if not exists (select 1 from users where id = v and pw_hash = crypt(p_old, pw_hash)) then
    raise exception '현재 비밀번호가 올바르지 않습니다.';
  end if;
  if coalesce(char_length(p_new), 0) < 6 then
    raise exception '비밀번호는 6자 이상이어야 합니다.';
  end if;
  update users set pw_hash = crypt(p_new, gen_salt('bf')) where id = v;
end $$;

create or replace function public.delete_account(p_token uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := _uid(p_token);
begin
  if not exists (select 1 from users where id = v and pw_hash = crypt(p_password, pw_hash)) then
    raise exception '비밀번호가 올바르지 않습니다.';
  end if;
  if exists (select 1 from users where id = v and is_admin) then
    raise exception '관리자 계정은 탈퇴할 수 없습니다.';
  end if;
  delete from users where id = v;   -- 기록·접속·세션은 함께 삭제됨
end $$;

-- ---------- 접속 시간 ----------
-- 사이트를 보고 있는 동안 1분마다 호출 (한 번에 최대 120초만 인정)
create or replace function public.heartbeat(p_token uuid, p_seconds int)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := _uid(p_token);
begin
  insert into visits (user_id, day, seconds)
  values (v, (now() at time zone 'Asia/Seoul')::date, least(greatest(p_seconds, 0), 120))
  on conflict (user_id, day) do update set seconds = visits.seconds + excluded.seconds;
  update users set last_seen = now() where id = v;
end $$;

-- ---------- 응시 기록 ----------
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
  saved jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) not between 1 and 10 then
    raise exception '잘못된 응시 기록입니다.';
  end if;
  for s in select * from jsonb_array_elements(p_sections) loop
    cnt := (s->>'count')::int;
    if s->>'name' not in ('언어이해', '자료해석', '창의수리', '언어추리', '수열추리')
       or cnt not between 1 and 100
       or jsonb_array_length(s->'answers') <> cnt
       or jsonb_array_length(s->'times') <> cnt then
      raise exception '잘못된 응시 기록입니다.';
    end if;
    insert into records (attempt_id, user_id, section, q_count, time_limit, used_sec, answers, times, source)
    values (aid, v, s->>'name', cnt, least(greatest((s->>'time')::int, 1), 180),
            least(greatest(coalesce((s->>'used')::int, 0), 0), 180 * 60),
            s->'answers', s->'times', left(p_source, 300))
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

-- 본인이 입력한 정답으로 채점 (정답 문자열의 1~5 숫자만 순서대로 사용)
create or replace function public.grade_record(p_token uuid, p_id uuid, p_key text)
returns json language plpgsql security definer set search_path = public as $$
declare v uuid := _uid(p_token); r records; k text; c int;
begin
  select * into r from records where id = p_id and user_id = v;
  if r.id is null then raise exception '기록을 찾을 수 없습니다.'; end if;
  k := left(regexp_replace(coalesce(p_key, ''), '[^1-5]', '', 'g'), r.q_count);
  select count(*) into c from generate_series(0, char_length(k) - 1) i
   where (r.answers->>i) = substr(k, i + 1, 1);
  update records
     set answer_key = nullif(k, ''),
         correct = case when k = '' then null else c end,
         graded = char_length(k)
   where id = p_id;
  return json_build_object('correct', case when k = '' then null else c end, 'graded', char_length(k));
end $$;

create or replace function public.delete_attempt(p_token uuid, p_attempt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := _uid(p_token);
begin
  delete from records where attempt_id = p_attempt and user_id = v;
end $$;

create or replace function public._user_data(p_uid uuid)
returns json language sql security definer set search_path = public as $$
  select json_build_object(
    'user', _profile(p_uid),
    'records', coalesce((select json_agg(r order by r.created_at)
                           from (select id, attempt_id, created_at, section, q_count, time_limit, used_sec,
                                        answers, times, answer_key, correct, graded, source
                                   from records where user_id = p_uid) r), '[]'::json),
    'visits', coalesce((select json_agg(json_build_object('day', day, 'seconds', seconds) order by day)
                          from visits where user_id = p_uid), '[]'::json)
  );
$$;

create or replace function public.my_data(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  return _user_data(_uid(p_token));
end $$;

-- ---------- 관리자 ----------
create or replace function public.admin_users(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  return coalesce((
    select json_agg(x order by x.campus nulls first, x.class_no, x.name) from (
      select u.id, u.username, u.name, u.campus, u.class_no, u.is_admin, u.created_at, u.last_seen,
             coalesce((select sum(seconds) from visits v where v.user_id = u.id), 0) as visit_sec,
             (select count(*) from login_logs l where l.user_id = u.id and l.kind in ('login', 'signup')) as login_count
        from users u
    ) x), '[]'::json);
end $$;

create or replace function public.admin_records(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  return coalesce((select json_agg(r order by r.created_at) from (
    select id, attempt_id, user_id, created_at, section, q_count, time_limit, used_sec,
           answers, times, answer_key, correct, graded, source
      from records) r), '[]'::json);
end $$;

create or replace function public.admin_user_detail(p_token uuid, p_user uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  return _user_data(p_user);
end $$;

create or replace function public.admin_logs(p_token uuid, p_limit int default 300)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  return coalesce((select json_agg(x) from (
    select l.at, l.kind, l.username, u.name, u.campus, u.class_no, l.user_agent
      from login_logs l left join users u on u.id = l.user_id
     order by l.at desc limit least(greatest(p_limit, 1), 2000)) x), '[]'::json);
end $$;

create or replace function public.admin_reset_password(p_token uuid, p_user uuid, p_new text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _admin(p_token);
  if coalesce(char_length(p_new), 0) < 6 then
    raise exception '비밀번호는 6자 이상이어야 합니다.';
  end if;
  update users set pw_hash = crypt(p_new, gen_salt('bf')) where id = p_user;
  delete from sessions where user_id = p_user;
end $$;

create or replace function public.admin_settings(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  return json_build_object('signup_code', (select value from app_settings where key = 'signup_code'));
end $$;

-- 빈 값이면 가입 코드 없이 누구나 가입
create or replace function public.admin_set_signup_code(p_token uuid, p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  if coalesce(trim(p_code), '') = '' then
    delete from app_settings where key = 'signup_code';
  else
    insert into app_settings (key, value) values ('signup_code', trim(p_code))
    on conflict (key) do update set value = excluded.value;
  end if;
end $$;

create or replace function public.admin_delete_user(p_token uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  if exists (select 1 from users where id = p_user and is_admin) then
    raise exception '관리자 계정은 삭제할 수 없습니다.';
  end if;
  delete from users where id = p_user;
end $$;

-- ---------- 실행 권한 ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.signup_info(),
  public.signup(text, text, text, text, int, text, text),
  public.delete_account(uuid, text),
  public.login(text, text, text),
  public.me(uuid),
  public.logout(uuid),
  public.change_password(uuid, text, text),
  public.heartbeat(uuid, int),
  public.save_attempt(uuid, jsonb, text, boolean),
  public.grade_record(uuid, uuid, text),
  public.delete_attempt(uuid, uuid),
  public.my_data(uuid),
  public.admin_users(uuid),
  public.admin_records(uuid),
  public.admin_user_detail(uuid, uuid),
  public.admin_logs(uuid, int),
  public.admin_reset_password(uuid, uuid, text),
  public.admin_settings(uuid),
  public.admin_set_signup_code(uuid, text),
  public.admin_delete_user(uuid, uuid)
to anon, authenticated;
