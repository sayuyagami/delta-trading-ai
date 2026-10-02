create table if not exists public.user_subscriptions (
  google_sub text primary key,
  email text not null,
  name text not null,
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

alter table public.user_subscriptions enable row level security;
revoke all on table public.user_subscriptions from anon, authenticated;
grant all on table public.user_subscriptions to service_role;