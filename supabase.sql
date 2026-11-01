-- 사랑을 경희대를 타고 — Supabase 표 만들기
-- Supabase 왼쪽 메뉴 SQL Editor → 이 내용을 전부 붙여넣고 Run

create table if not exists users (
  id            text primary key,
  login_id      text not null,
  login_lower   text not null unique,
  password_hash text not null,
  nickname      text not null,
  nick_lower    text not null unique,
  major         text not null,   -- 비공개
  year          text not null,   -- 비공개
  created_at    bigint not null
);

create table if not exists posts (
  id         text primary key,
  author_id  text not null references users(id) on delete cascade,
  date       text not null,
  place      text not null,
  text       text not null,
  created_at bigint not null
);
create index if not exists posts_created_idx on posts (created_at desc);

create table if not exists messages (
  id         text primary key,
  from_id    text not null references users(id) on delete cascade,
  to_id      text not null references users(id) on delete cascade,
  text       text not null,
  about      jsonb,
  created_at bigint not null
);
create index if not exists messages_from_idx on messages (from_id);
create index if not exists messages_to_idx on messages (to_id);

create table if not exists sessions (
  token_hash text primary key,
  user_id    text not null references users(id) on delete cascade,
  expires    bigint not null
);

-- 외부에서 직접 표를 읽지 못하게 잠그기 (우리 서버만 비밀 키로 접근)
alter table users    enable row level security;
alter table posts    enable row level security;
alter table messages enable row level security;
alter table sessions enable row level security;

grant all on table users, posts, messages, sessions to service_role;
