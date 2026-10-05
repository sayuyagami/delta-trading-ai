create table if not exists public.user_subscriptions (
  google_sub text primary key,
  email text not null,
  name text not null,
  manual_payment_request_id text unique,
  manual_payment_reference text unique,
  manual_payment_status text not null default 'none',
  manual_payment_submitted_at timestamptz,
  manual_payment_reviewed_at timestamptz,
  manual_payment_reviewed_by text,
  manual_payment_review_note text,
  phonepe_merchant_order_id text,
  phonepe_last_merchant_order_id text,
  phonepe_payment_transaction_id text,
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_subscription_id text unique,
  access_expires_at timestamptz,
  status text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_subscriptions add column if not exists razorpay_order_id text;
alter table public.user_subscriptions add column if not exists razorpay_payment_id text;
alter table public.user_subscriptions add column if not exists access_expires_at timestamptz;
alter table public.user_subscriptions alter column razorpay_subscription_id drop not null;
alter table public.user_subscriptions add column if not exists phonepe_merchant_order_id text;
alter table public.user_subscriptions add column if not exists phonepe_last_merchant_order_id text;
alter table public.user_subscriptions add column if not exists phonepe_payment_transaction_id text;
alter table public.user_subscriptions add column if not exists manual_payment_request_id text;
alter table public.user_subscriptions add column if not exists manual_payment_reference text;
alter table public.user_subscriptions add column if not exists manual_payment_status text not null default 'none';
alter table public.user_subscriptions add column if not exists manual_payment_submitted_at timestamptz;
alter table public.user_subscriptions add column if not exists manual_payment_reviewed_at timestamptz;
alter table public.user_subscriptions add column if not exists manual_payment_reviewed_by text;
alter table public.user_subscriptions add column if not exists manual_payment_review_note text;

create unique index if not exists user_subscriptions_razorpay_order_id_key
  on public.user_subscriptions (razorpay_order_id);
create unique index if not exists user_subscriptions_razorpay_payment_id_key
  on public.user_subscriptions (razorpay_payment_id);
create unique index if not exists user_subscriptions_phonepe_merchant_order_id_key
  on public.user_subscriptions (phonepe_merchant_order_id);
create unique index if not exists user_subscriptions_phonepe_last_merchant_order_id_key
  on public.user_subscriptions (phonepe_last_merchant_order_id);
create unique index if not exists user_subscriptions_phonepe_payment_transaction_id_key
  on public.user_subscriptions (phonepe_payment_transaction_id);
create unique index if not exists user_subscriptions_manual_payment_request_id_key
  on public.user_subscriptions (manual_payment_request_id);
create unique index if not exists user_subscriptions_manual_payment_reference_key
  on public.user_subscriptions (manual_payment_reference);

create table if not exists public.manual_payment_reviews (
  id uuid primary key default gen_random_uuid(),
  google_sub text not null,
  email text not null,
  manual_payment_request_id text not null unique,
  manual_payment_reference text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reviewed_by text not null,
  note text,
  reviewed_at timestamptz not null default now()
);

alter table public.user_subscriptions enable row level security;
alter table public.manual_payment_reviews enable row level security;
revoke all on table public.user_subscriptions from anon, authenticated;
revoke all on table public.manual_payment_reviews from anon, authenticated;
grant all on table public.user_subscriptions to service_role;
grant all on table public.manual_payment_reviews to service_role;