-- Toughcuts security and payment hardening.
-- Apply after 202608230001 and 202608230002.

-- These tables contain internal audit/payment payload data and are never
-- intended for direct browser access.
alter table public.payment_attempts enable row level security;
alter table public.stock_movements enable row level security;
revoke all on table public.payment_attempts from public, anon, authenticated;
revoke all on table public.stock_movements from public, anon, authenticated;

-- Track the provider event so webhook retries are idempotent and a stale
-- checkout session cannot complete a newer attempt.
alter table public.payment_attempts
  add column if not exists provider_event_id text;
create unique index if not exists idx_payment_attempts_provider_event
  on public.payment_attempts(provider_event_id)
  where provider_event_id is not null;
create index if not exists idx_payment_attempts_session
  on public.payment_attempts(checkout_session_id);

-- Customer cancellation must go through one locked transaction. This keeps
-- stock restoration, payment-attempt cancellation, and order state changes
-- together and prevents a direct client update from racing the webhook.
drop policy if exists "Users update own cancellable orders" on public.orders;

create or replace function public.cancel_order_atomic(
    p_order_id uuid,
    p_cancel_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.orders%rowtype;
    v_user_id uuid := auth.uid();
    v_reason text := nullif(left(trim(coalesce(p_cancel_reason, '')), 500), '');
begin
    if v_user_id is null then
        raise exception 'Please log in to cancel an order.' using errcode = '42501';
    end if;

    select * into v_order
      from public.orders
     where id = p_order_id
     for update;

    if not found then
        raise exception 'Order not found.' using errcode = 'P0002';
    end if;

    if v_order.user_id <> v_user_id and not public.is_admin() then
        raise exception 'You are not allowed to cancel this order.' using errcode = '42501';
    end if;

    if v_order.status not in ('pending', 'awaiting_payment') then
        raise exception 'This order can no longer be cancelled.' using errcode = 'P0001';
    end if;

    if v_order.payment_status = 'paid' then
        raise exception 'Paid orders require staff assistance for cancellation.' using errcode = 'P0001';
    end if;

    update public.orders
       set status = 'cancelled',
           payment_status = case
               when payment_provider is not null then 'failed'
               else payment_status
           end,
           cancel_reason = coalesce(v_reason, cancel_reason, 'Cancelled by customer'),
           cancelled_at = coalesce(cancelled_at, now())
     where id = p_order_id
     returning * into v_order;

    update public.payment_attempts
       set status = 'cancelled',
           completed_at = coalesce(completed_at, now())
     where order_id = p_order_id
       and status = 'created';

    return v_order;
end;
$$;

revoke all on function public.cancel_order_atomic(uuid, text) from public, anon;
grant execute on function public.cancel_order_atomic(uuid, text) to authenticated;


-- Provision the bucket used by the admin barber image form. The public can
-- read profile images, but only administrators can upload/change/delete them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'barber-images',
    'barber-images',
    true,
    2097152,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view barber images" on storage.objects;
create policy "Public can view barber images"
    on storage.objects for select
    using (bucket_id = 'barber-images');

drop policy if exists "Admins manage barber images" on storage.objects;
create policy "Admins manage barber images"
    on storage.objects for all to authenticated
    using (bucket_id = 'barber-images' and public.is_admin())
    with check (bucket_id = 'barber-images' and public.is_admin());


-- Re-declare the admin booking RPC here as well, because an already-applied
-- 202608230002 migration will not be re-run just because its source file was
-- edited. This version also rejects closed and blocked time ranges.
create or replace function public.update_booking_admin(
    p_booking_id uuid,
    p_new_status text,
    p_booking_date date,
    p_booking_time time,
    p_barber_id text,
    p_admin_notes text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
    v_booking public.bookings%rowtype;
    v_barber public.barbers%rowtype;
    v_duration integer;
    v_barber_id text := nullif(trim(p_barber_id), '');
begin
    if not public.is_admin() then
        raise exception 'Only administrators can update appointments.' using errcode = '42501';
    end if;

    select * into v_booking from public.bookings where id = p_booking_id for update;
    if not found then raise exception 'Appointment not found.'; end if;
    if p_new_status not in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show') then
        raise exception 'Invalid appointment status.';
    end if;

    v_duration := coalesce(nullif(regexp_replace(v_booking.service_duration, '[^0-9]', '', 'g'), '')::integer, 60);
    if p_booking_date is null or p_booking_time is null then
        raise exception 'Please provide an appointment date and time.';
    end if;
    if p_booking_date < current_date - 1 or p_booking_date > current_date + 180 then
        raise exception 'Appointment date is outside the allowed range.';
    end if;
    if v_barber_id is null then raise exception 'Please assign a barber.'; end if;

    select * into v_barber
      from public.barbers
     where id = v_barber_id
       and is_active
       and (service_gender = 'all' or service_gender = v_booking.gender);
    if not found then raise exception 'Selected barber is not available.'; end if;

    perform pg_advisory_xact_lock(hashtextextended(v_barber_id || ':' || p_booking_date::text || ':' || p_booking_time::text, 0));

    if exists (
        select 1 from public.bookings b
        where b.id <> p_booking_id
          and b.barber_id = v_barber_id
          and b.booking_date = p_booking_date
          and b.status <> 'cancelled'
          and p_booking_time < b.booking_time + make_interval(mins => coalesce(nullif(regexp_replace(b.service_duration, '[^0-9]', '', 'g'), '')::integer, 60))
          and b.booking_time < p_booking_time + make_interval(mins => v_duration)
    ) then
        raise exception 'The selected barber already has an overlapping appointment.' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.barber_schedules s
        where s.barber_id = v_barber_id
          and s.day_of_week = extract(dow from p_booking_date)::integer
          and s.is_active
          and p_booking_time >= s.open_time
          and p_booking_time + make_interval(mins => v_duration) <= s.close_time
    ) then
        raise exception 'That time is outside the barber schedule.' using errcode = 'P0001';
    end if;

    if exists (
        select 1 from public.barber_blocked_times bt
        where bt.barber_id = v_barber_id
          and bt.starts_at < ((p_booking_date + p_booking_time) at time zone 'Asia/Manila') + make_interval(mins => v_duration)
          and bt.ends_at > ((p_booking_date + p_booking_time) at time zone 'Asia/Manila')
    ) then
        raise exception 'The selected barber is blocked at that time.' using errcode = 'P0001';
    end if;

    update public.bookings set
        status = p_new_status,
        booking_date = p_booking_date,
        booking_time = p_booking_time,
        barber_id = v_barber_id,
        barber_name = v_barber.name,
        admin_notes = nullif(trim(p_admin_notes), '')
    where id = p_booking_id
    returning * into v_booking;

    return v_booking;
end;
$$;

grant execute on function public.update_booking_admin(uuid, text, date, time, text, text) to authenticated;

-- Defense in depth for cancellations performed by the admin order RPC or
-- another trusted server path.
create or replace function public.cancel_payment_attempts_on_order_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if old.status is distinct from 'cancelled' and new.status = 'cancelled' then
        update public.payment_attempts
           set status = 'cancelled',
               completed_at = coalesce(completed_at, now())
         where order_id = new.id
           and status = 'created';
    end if;
    return new;
end;
$$;

drop trigger if exists orders_cancel_payment_attempts on public.orders;
create trigger orders_cancel_payment_attempts
after update of status on public.orders
for each row execute function public.cancel_payment_attempts_on_order_cancel();
revoke all on function public.cancel_payment_attempts_on_order_cancel() from public, anon, authenticated;
