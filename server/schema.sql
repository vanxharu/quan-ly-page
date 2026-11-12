-- Meta Assistant — máy chủ bot trên Supabase (một chủ dùng cho Page của mình + nhân viên đăng nhập).
-- Chạy một lần trong SQL Editor. Chạy lại an toàn (IF NOT EXISTS / OR REPLACE).

-- Page đã kết nối (không chứa token).
create table if not exists pages (
  id text primary key,
  name text not null default '',
  picture text not null default '',
  connected_at timestamptz not null default now()
);
-- Token Page dài hạn: chỉ hàm máy chủ (service role) đọc được, trang web không đọc được.
create table if not exists page_tokens (
  page_id text primary key references pages(id) on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);
-- Cài đặt bot từng Page.
create table if not exists page_settings (
  page_id text primary key references pages(id) on delete cascade,
  bot_enabled boolean not null default true,
  pause_minutes int not null default 30,          -- nhân viên trả lời tay → bot im lặng N phút với khách đó
  fallback_text text not null default '',           -- không khớp từ khoá nào (để trống = không trả lời)
  welcome_flow_id uuid,                              -- kịch bản khi khách bấm "Bắt đầu"
  greeting text not null default '',                 -- lời chào hiện trước khi khách nhắn
  persistent_menu jsonb not null default '[]',       -- [{title, type:'flow'|'url'|'text', value}]
  ice_breakers jsonb not null default '[]',          -- [{question, flow_id|text}]
  hide_phone boolean not null default true,          -- ẩn bình luận có SĐT
  hide_link boolean not null default true,           -- ẩn bình luận có link
  like_comments boolean not null default true,       -- tự thích bình luận
  updated_at timestamptz not null default now()
);
-- Hội thoại Messenger (một khách / một Page).
create table if not exists conversations (
  page_id text not null references pages(id) on delete cascade,
  psid text not null,
  name text not null default '',
  pic text not null default '',
  last_text text not null default '',
  last_at timestamptz not null default now(),
  last_customer_at timestamptz,
  unread int not null default 0,
  bot_paused_until timestamptz,
  flow jsonb,                                        -- {flow_id, step, data:{name,phone,address}}
  assigned_to uuid,
  primary key (page_id, psid)
);
-- Mốc "khách đã xem" từ webhook message_reads: mọi tin Page gửi trước thời điểm này khách đã đọc.
alter table conversations add column if not exists read_watermark timestamptz;
create table if not exists messages (
  id bigint generated always as identity primary key,
  page_id text not null,
  psid text not null,
  from_page boolean not null default false,
  by_bot boolean not null default false,
  mid text unique,
  text text not null default '',
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv on messages (page_id, psid, created_at desc);
-- Quy tắc tự động. kind: 'message' (từ khoá trong tin nhắn) | 'comment' (bình luận).
-- page_id null = áp dụng mọi Page. post_id null = mọi bài (chỉ với comment).
create table if not exists rules (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('message', 'comment')),
  page_id text references pages(id) on delete cascade,
  post_id text,
  name text not null default '',
  keywords text[] not null default '{}',             -- rỗng = mọi tin/bình luận
  match text not null default 'contains' check (match in ('contains', 'exact')),
  reply text not null default '',                    -- tin nhắn gửi (message) / tin nhắn riêng (comment)
  public_reply text not null default '',             -- comment: trả lời công khai dưới bình luận
  quick_replies jsonb not null default '[]',         -- [{title, payload}] payload 'FLOW:<id>' hoặc chữ
  image_url text not null default '',
  flow_id uuid,                                      -- chạy kịch bản thay cho reply
  enabled boolean not null default true,
  priority int not null default 0,
  hits int not null default 0,
  created_at timestamptz not null default now()
);
-- Kịch bản chatbot. steps: [{id, text, buttons:[{title, next|url|payload}], ask:'name'|'phone'|'address'|null, next, action:'order'|null}]
create table if not exists flows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  steps jsonb not null default '[]',
  created_at timestamptz not null default now()
);
-- Đơn do kịch bản thu thập (trang web gộp vào tab Bán hàng).
create table if not exists bot_orders (
  id uuid primary key default gen_random_uuid(),
  page_id text not null,
  psid text not null,
  name text not null default '',
  phone text not null default '',
  address text not null default '',
  note text not null default '',
  imported boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists logs (
  id bigint generated always as identity primary key,
  page_id text,
  kind text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists logs_time on logs (created_at desc);

-- Bảo mật: chỉ tài khoản đã đăng nhập (chủ + nhân viên) đọc/ghi; page_tokens không ai ngoài máy chủ.
do $$ declare t text; begin
  foreach t in array array['pages','page_tokens','page_settings','conversations','messages','rules','flows','bot_orders','logs'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
  foreach t in array array['pages','page_settings','conversations','messages','rules','flows','bot_orders','logs'] loop
    execute format('drop policy if exists staff_all on %I', t);
    execute format('create policy staff_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
revoke all on page_tokens from anon, authenticated;

-- Tin mới hiện ngay trên trang web.
do $$ begin
  begin alter publication supabase_realtime add table conversations; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table messages; exception when duplicate_object then null; end;
end $$;

-- Tăng đếm lượt khớp quy tắc (gọi từ máy chủ).
create or replace function rule_hit(rid uuid) returns void language sql security definer set search_path = public as
$$ update rules set hits = hits + 1 where id = rid $$;
revoke execute on function rule_hit(uuid) from public, anon, authenticated;

-- Bài có ảnh + nút Gửi tin nhắn chờ máy chủ đăng đúng giờ (Facebook không hẹn giờ được loại bài này).
create table if not exists scheduled_posts (
  post_id text primary key,
  page_id text not null,
  publish_at timestamptz not null,
  status text not null default 'pending',   -- pending | published | error
  error text not null default '',
  done_at timestamptz,
  created_at timestamptz not null default now()
);
alter table scheduled_posts enable row level security;
drop policy if exists "staff read scheduled_posts" on scheduled_posts;
create policy "staff read scheduled_posts" on scheduled_posts for select to authenticated using (true);
-- Khoá cho pg_cron gọi fb-admin; RLS bật, không policy → chỉ service role đọc được.
create table if not exists app_config (key text primary key, value text not null);
alter table app_config enable row level security;
insert into app_config (key, value) values ('cron_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) on conflict (key) do nothing;
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('publish-due-posts') where exists (select 1 from cron.job where jobname = 'publish-due-posts');
select cron.schedule('publish-due-posts', '* * * * *', $$
  select net.http_post(
    url := 'https://kpzkokyndacmzuvyaxsc.supabase.co/functions/v1/fb-admin',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select value from app_config where key = 'cron_key')),
    body := '{"action":"publish_due"}'::jsonb)
$$);
