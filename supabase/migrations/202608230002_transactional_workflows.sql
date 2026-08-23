-- Toughcuts transactional workflow hardening.
-- This migration supersedes the 7-argument create_order_atomic function.

alter table public.payment_attempts add column if not exists updated_at timestamptz not null default now();

create or replace function public.adjust_product_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_user_id uuid := auth.uid();
    v_order_user uuid;
    v_order_status text;
begin
    select user_id, status into v_order_user, v_order_status from public.orders where id = new.order_id for update;
    if v_order_status = 'cancelled' then
        raise exception 'Cannot add items to a cancelled order.' using errcode = 'P0001';
    end if;

    update public.products
       set stock_quantity = stock_quantity - new.quantity
     where id = new.product_id and is_active and stock_quantity >= new.quantity;
    if not found then
        raise exception 'Product % is unavailable or out of stock.', new.product_id using errcode = 'P0001';
    end if;

    insert into public.stock_movements(product_id, order_id, quantity_delta, reason, actor_id)
    values (new.product_id, new.order_id, -new.quantity, 'order_reserved', coalesce(v_user_id, v_order_user));
    return new;
end;
$$;

drop trigger if exists trg_decrement_stock_on_order_item on public.order_items;
create trigger trg_decrement_stock_on_order_item
after insert on public.order_items
for each row execute function public.adjust_product_stock();

create or replace function public.restore_product_stock_on_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if old.status is distinct from 'cancelled' and new.status = 'cancelled' then
        update public.products p
           set stock_quantity = p.stock_quantity + oi.quantity
          from public.order_items oi
         where oi.order_id = new.id and p.id = oi.product_id;
        insert into public.stock_movements(product_id, order_id, quantity_delta, reason, actor_id)
        select oi.product_id, new.id, oi.quantity, 'order_cancelled_restocked', coalesce(auth.uid(), new.user_id)
        from public.order_items oi where oi.order_id = new.id;
        new.cancelled_at = coalesce(new.cancelled_at, now());
    elsif old.status = 'cancelled' and new.status <> 'cancelled' then
        update public.products p
           set stock_quantity = p.stock_quantity - oi.quantity
          from public.order_items oi
         where oi.order_id = new.id and p.id = oi.product_id and p.is_active and p.stock_quantity >= oi.quantity;
        if exists (
            select 1 from public.order_items oi left join public.products p on p.id = oi.product_id
            where oi.order_id = new.id and (p.id is null or not p.is_active or p.stock_quantity < oi.quantity)
        ) then
            raise exception 'Order cannot be reopened because one or more products are unavailable.' using errcode = 'P0001';
        end if;
        insert into public.stock_movements(product_id, order_id, quantity_delta, reason, actor_id)
        select oi.product_id, new.id, -oi.quantity, 'order_reopened_reserved', coalesce(auth.uid(), new.user_id)
        from public.order_items oi where oi.order_id = new.id;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_adjust_stock_on_order_status_change on public.orders;
create trigger trg_adjust_stock_on_order_status_change
before update of status on public.orders
for each row execute function public.restore_product_stock_on_cancel();

-- Replace the earlier overload so all new order creation goes through one
-- transaction. p_payment_provider = 'paymongo' creates a reserved unpaid order.
drop function if exists public.create_order_atomic(text, text, text, text, text, text, jsonb);
drop function if exists public.create_order_atomic(text, text, text, text, text, text, jsonb, text);

create or replace function public.create_order_atomic(
    p_customer_name text,
    p_fulfillment_type text,
    p_area text,
    p_address text,
    p_contact_phone text,
    p_notes text,
    p_items jsonb,
    p_payment_provider text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_user_id uuid := auth.uid();
    v_order_id uuid;
    v_subtotal numeric(12,2);
    v_delivery_fee numeric(12,2) := 0;
    v_total numeric(12,2);
    v_status text := case when p_payment_provider is null then 'pending' else 'awaiting_payment' end;
    v_payment_status text := case when p_payment_provider is null then 'unpaid' else 'unpaid' end;
    v_count integer;
begin
    if v_user_id is null then raise exception 'Please log in to place an order.' using errcode = '42501'; end if;
    if nullif(trim(p_customer_name), '') is null or length(trim(p_customer_name)) < 2 then raise exception 'Please provide your full name.'; end if;
    if p_fulfillment_type not in ('pickup', 'delivery') then raise exception 'Please choose pickup or delivery.'; end if;
    if p_fulfillment_type = 'delivery' and (nullif(trim(p_area), '') is null or length(trim(p_address)) < 10) then raise exception 'Please provide a complete delivery area and address.'; end if;
    if p_payment_provider is not null and p_payment_provider <> 'paymongo' then raise exception 'Unsupported payment provider.'; end if;
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty.'; end if;

    -- Lock every referenced product before calculating totals. This makes the
    -- stock check and the reservation part of one serializable operation.
    perform 1 from public.products p
     where p.id in (select value->>'product_id' from jsonb_array_elements(p_items))
     for update;

    if exists (
        select 1 from jsonb_array_elements(p_items) x
        where jsonb_typeof(x->'quantity') <> 'number'
           or (x->>'quantity')::numeric <> floor((x->>'quantity')::numeric)
           or (x->>'quantity')::integer <= 0
           or nullif(trim(x->>'product_id'), '') is null
    ) then raise exception 'Your cart contains an invalid item.'; end if;

    if exists (
        with requested as (
            select trim(value->>'product_id') product_id, (value->>'quantity')::integer quantity
            from jsonb_array_elements(p_items)
        ), aggregated as (select product_id, sum(quantity)::integer quantity from requested group by product_id)
        select 1 from aggregated r left join public.products p on p.id = r.product_id
        where p.id is null or not p.is_active or p.stock_quantity < r.quantity
    ) then raise exception 'One or more products are unavailable or out of stock.' using errcode = 'P0001'; end if;

    with requested as (
        select trim(value->>'product_id') product_id, (value->>'quantity')::integer quantity from jsonb_array_elements(p_items)
    ), aggregated as (select product_id, sum(quantity)::integer quantity from requested group by product_id)
    select coalesce(sum(p.price * r.quantity), 0) into v_subtotal
    from aggregated r join public.products p on p.id = r.product_id;

    if p_fulfillment_type = 'delivery' then
        select fee into v_delivery_fee from public.delivery_areas where name = lower(trim(p_area)) and is_active;
        if v_delivery_fee is null then raise exception 'Please choose a valid delivery area.'; end if;
    end if;
    v_total := v_subtotal + v_delivery_fee;

    insert into public.orders (user_id, customer_name, fulfillment_type, area, address, contact_phone, subtotal, delivery_fee, total_price, status, payment_status, payment_provider, expires_at, notes)
    values (v_user_id, trim(p_customer_name), p_fulfillment_type, case when p_fulfillment_type = 'delivery' then lower(trim(p_area)) else null end, case when p_fulfillment_type = 'delivery' then trim(p_address) else null end, trim(p_contact_phone), v_subtotal, v_delivery_fee, v_total, v_status, v_payment_status, p_payment_provider, case when p_payment_provider is null then null else now() + interval '30 minutes' end, nullif(trim(p_notes), ''))
    returning id into v_order_id;

    with requested as (
        select trim(value->>'product_id') product_id, (value->>'quantity')::integer quantity from jsonb_array_elements(p_items)
    ), aggregated as (select product_id, sum(quantity)::integer quantity from requested group by product_id)
    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
    select v_order_id, p.id, p.name, p.price, r.quantity, p.price * r.quantity
    from aggregated r join public.products p on p.id = r.product_id;

    return jsonb_build_object('id', v_order_id, 'customer_name', trim(p_customer_name), 'subtotal', v_subtotal, 'delivery_fee', v_delivery_fee, 'total_price', v_total, 'status', v_status, 'payment_status', v_payment_status);
end;
$$;

grant execute on function public.create_order_atomic(text, text, text, text, text, text, jsonb, text) to authenticated;

create or replace function public.expire_unpaid_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
    update public.orders
       set status = 'cancelled', payment_status = 'failed', cancel_reason = 'Payment window expired', cancelled_at = now()
     where status = 'awaiting_payment' and payment_status <> 'paid' and expires_at is not null and expires_at < now();
    get diagnostics v_count = row_count;
    update public.payment_attempts set status = 'expired', completed_at = now() where status = 'created' and expires_at < now();
    return v_count;
end;
$$;

grant execute on function public.expire_unpaid_orders() to service_role;


create or replace function public.create_booking_atomic(
    p_gender text,
    p_service_id text,
    p_barber_id text,
    p_location_type text,
    p_area text,
    p_address text,
    p_booking_date date,
    p_booking_time time,
    p_contact_phone text,
    p_contact_preference text,
    p_notes text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_user_id uuid := auth.uid();
    v_service public.services%rowtype;
    v_area_fee numeric(12,2) := 0;
    v_barber public.barbers%rowtype;
    v_barber_id text := nullif(trim(p_barber_id), '');
    v_duration integer;
    v_total numeric(12,2);
    v_booking_id uuid;
    v_candidate record;
begin
    if v_user_id is null then raise exception 'Please log in to book an appointment.' using errcode = '42501'; end if;
    if p_gender not in ('men', 'women') then raise exception 'Please choose a valid service category.'; end if;
    select * into v_service from public.services where id = p_service_id and is_active and (gender = p_gender or gender = 'all');
    if not found then raise exception 'That service is no longer available.'; end if;
    v_duration := v_service.duration_minutes;
    if p_location_type not in ('studio', 'home') then raise exception 'Please choose a valid appointment location.'; end if;
    if p_booking_date is null or p_booking_time is null then raise exception 'Please choose a date and time.'; end if;
    if p_booking_date < current_date or p_booking_date > current_date + 60 then raise exception 'Please choose a date within the next 60 days.'; end if;
    if extract(dow from p_booking_date) = 0 then raise exception 'The shop is closed on Sundays.'; end if;
    if p_contact_preference not in ('phone', 'email') then raise exception 'Please choose a valid contact preference.'; end if;
    if p_contact_preference = 'phone' and nullif(trim(p_contact_phone), '') is null then raise exception 'Please provide a phone number.'; end if;
    if p_location_type = 'home' then
        select fee into v_area_fee from public.delivery_areas where name = lower(trim(p_area)) and is_active;
        if v_area_fee is null or length(trim(p_address)) < 10 then raise exception 'Please provide a valid delivery area and complete address.'; end if;
    end if;

    if v_barber_id is not null then
        select * into v_barber from public.barbers where id = v_barber_id and is_active and (service_gender = 'all' or service_gender = p_gender);
        if not found then raise exception 'That barber is not available for this service.'; end if;
        perform pg_advisory_xact_lock(hashtextextended(v_barber_id || ':' || p_booking_date::text || ':' || p_booking_time::text, 0));
        if exists (
            select 1 from public.bookings b
            where b.barber_id = v_barber_id and b.booking_date = p_booking_date and b.status <> 'cancelled'
              and p_booking_time < b.booking_time + make_interval(mins => coalesce(nullif(regexp_replace(b.service_duration, '[^0-9]', '', 'g'), '')::integer, 60))
              and b.booking_time < p_booking_time + make_interval(mins => v_duration)
        ) or exists (
            select 1 from public.barber_blocked_times bt
            where bt.barber_id = v_barber_id
              and bt.starts_at < ((p_booking_date + p_booking_time) at time zone 'Asia/Manila') + make_interval(mins => v_duration)
              and bt.ends_at > ((p_booking_date + p_booking_time) at time zone 'Asia/Manila')
        ) then raise exception 'That time was just booked or blocked with this barber.' using errcode = 'P0001'; end if;
    else
        for v_candidate in
            select b.id, b.name from public.barbers b
            where b.is_active and (b.service_gender = 'all' or b.service_gender = p_gender)
            order by md5(b.id || p_booking_date::text || p_booking_time::text || v_user_id::text)
        loop
            perform pg_advisory_xact_lock(hashtextextended(v_candidate.id || ':' || p_booking_date::text || ':' || p_booking_time::text, 0));
            if not exists (
                select 1 from public.bookings b
                where b.barber_id = v_candidate.id and b.booking_date = p_booking_date and b.status <> 'cancelled'
                  and p_booking_time < b.booking_time + make_interval(mins => coalesce(nullif(regexp_replace(b.service_duration, '[^0-9]', '', 'g'), '')::integer, 60))
                  and b.booking_time < p_booking_time + make_interval(mins => v_duration)
            ) and not exists (
                select 1 from public.barber_blocked_times bt
                where bt.barber_id = v_candidate.id
                  and bt.starts_at < ((p_booking_date + p_booking_time) at time zone 'Asia/Manila') + make_interval(mins => v_duration)
                  and bt.ends_at > ((p_booking_date + p_booking_time) at time zone 'Asia/Manila')
            ) then
                v_barber_id := v_candidate.id;
                v_barber.name := v_candidate.name;
                exit;
            end if;
        end loop;
        if v_barber_id is null then raise exception 'All barbers are booked at that time.' using errcode = 'P0001'; end if;
    end if;

    -- Validate the chosen time against the configured schedule, not only the
    -- browser-generated list.
    if not exists (
        select 1 from public.barber_schedules s
        where s.barber_id = v_barber_id and s.day_of_week = extract(dow from p_booking_date)::integer and s.is_active
          and p_booking_time >= s.open_time
          and p_booking_time + make_interval(mins => v_duration) <= s.close_time
    ) then raise exception 'That time is outside the barber schedule.' using errcode = 'P0001'; end if;

    v_total := v_service.price + v_area_fee;
    insert into public.bookings (user_id, gender, service_id, service_name, service_price, service_duration, barber_id, barber_name, location_type, area, address, travel_fee, total_price, booking_date, booking_time, contact_phone, contact_preference, notes, status)
    values (v_user_id, p_gender, v_service.id, v_service.name, v_service.price, v_service.duration_minutes || ' min', v_barber_id, v_barber.name, p_location_type, case when p_location_type = 'home' then lower(trim(p_area)) else null end, case when p_location_type = 'home' then trim(p_address) else null end, v_area_fee, v_total, p_booking_date, p_booking_time, nullif(trim(p_contact_phone), ''), p_contact_preference, nullif(trim(p_notes), ''), 'pending')
    returning id into v_booking_id;

    return jsonb_build_object('id', v_booking_id, 'service_name', v_service.name, 'service_price', v_service.price, 'service_duration', v_service.duration_minutes || ' min', 'barber_id', v_barber_id, 'barber_name', v_barber.name, 'location_type', p_location_type, 'area', p_area, 'address', p_address, 'travel_fee', v_area_fee, 'total_price', v_total, 'booking_date', p_booking_date, 'booking_time', p_booking_time, 'contact_phone', p_contact_phone, 'contact_preference', p_contact_preference, 'status', 'pending');
end;
$$;

grant execute on function public.create_booking_atomic(text, text, text, text, text, text, date, time, text, text, text) to authenticated;


create or replace function public.update_order_status(
    p_order_id uuid,
    p_new_status text,
    p_cancel_reason text default null
)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
    v_order public.orders%rowtype;
    v_allowed boolean := false;
begin
    if not public.is_admin() then raise exception 'Only administrators can update order status.' using errcode = '42501'; end if;
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then raise exception 'Order not found.'; end if;
    if p_new_status not in ('awaiting_payment', 'pending', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled') then raise exception 'Invalid order status.'; end if;

    v_allowed := (v_order.status = p_new_status)
        or (v_order.status = 'pending' and p_new_status in ('preparing', 'cancelled'))
        or (v_order.status = 'preparing' and p_new_status in ('ready', 'cancelled'))
        or (v_order.status = 'ready' and p_new_status in ('out_for_delivery', 'completed', 'cancelled'))
        or (v_order.status = 'out_for_delivery' and p_new_status in ('completed', 'cancelled'))
        or (v_order.status = 'awaiting_payment' and p_new_status = 'cancelled');
    if not v_allowed then raise exception 'That order status transition is not allowed.' using errcode = 'P0001'; end if;

    update public.orders set
        status = p_new_status,
        cancel_reason = case when p_new_status = 'cancelled' then coalesce(nullif(trim(p_cancel_reason), ''), cancel_reason) else cancel_reason end,
        completed_at = case when p_new_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
        cancelled_at = case when p_new_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end
    where id = p_order_id
    returning * into v_order;
    return v_order;
end;
$$;

grant execute on function public.update_order_status(uuid, text, text) to authenticated;

alter table public.bookings add column if not exists admin_notes text;

create or replace function public.update_booking_admin(
    p_booking_id uuid,
    p_new_status text,
    p_booking_date date,
    p_booking_time time,
    p_barber_id text,
    p_admin_notes text default null
)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
    v_booking public.bookings%rowtype;
    v_barber public.barbers%rowtype;
    v_duration integer;
    v_barber_id text := nullif(trim(p_barber_id), '');
begin
    if not public.is_admin() then raise exception 'Only administrators can update appointments.' using errcode = '42501'; end if;
    select * into v_booking from public.bookings where id = p_booking_id for update;
    if not found then raise exception 'Appointment not found.'; end if;
    if p_new_status not in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show') then raise exception 'Invalid appointment status.'; end if;
    v_duration := coalesce(nullif(regexp_replace(v_booking.service_duration, '[^0-9]', '', 'g'), '')::integer, 60);
    if p_booking_date is null or p_booking_time is null then raise exception 'Please provide an appointment date and time.'; end if;
    if p_booking_date < current_date - 1 or p_booking_date > current_date + 180 then raise exception 'Appointment date is outside the allowed range.'; end if;
    if v_barber_id is null then raise exception 'Please assign a barber.'; end if;
    select * into v_barber from public.barbers where id = v_barber_id and is_active and (service_gender = 'all' or service_gender = v_booking.gender);
    if not found then raise exception 'Selected barber is not available.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_barber_id || ':' || p_booking_date::text || ':' || p_booking_time::text, 0));
    if exists (
        select 1 from public.bookings b
        where b.id <> p_booking_id and b.barber_id = v_barber_id and b.booking_date = p_booking_date and b.status <> 'cancelled'
          and p_booking_time < b.booking_time + make_interval(mins => coalesce(nullif(regexp_replace(b.service_duration, '[^0-9]', '', 'g'), '')::integer, 60))
          and b.booking_time < p_booking_time + make_interval(mins => v_duration)
    ) then raise exception 'The selected barber already has an overlapping appointment.' using errcode = 'P0001'; end if;

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

 drop policy if exists "Admins view admin notes" on public.bookings;


create or replace function public.record_profile_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' then
        insert into public.notifications(audience, event_type, title, body, entity_type, entity_id)
        values ('admin', 'account_created', 'New customer account', coalesce(new.full_name, new.email, 'A new account was created.'), 'profile', new.id::text);
    end if;
    return new;
end;
$$;

drop trigger if exists profiles_record_event on public.profiles;
create trigger profiles_record_event after insert on public.profiles for each row execute function public.record_profile_event();
revoke all on function public.record_profile_event() from public, anon, authenticated;


create or replace function public.record_product_stock_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if new.stock_quantity <= new.low_stock_threshold and (tg_op = 'INSERT' or old.stock_quantity > old.low_stock_threshold) then
        insert into public.notifications(audience, event_type, title, body, entity_type, entity_id)
        values ('admin', 'product_low_stock', case when new.stock_quantity = 0 then 'Product out of stock' else 'Product low stock' end, new.name || ' has ' || new.stock_quantity || ' unit(s) left.', 'product', new.id);
    end if;
    return new;
end;
$$;

drop trigger if exists products_record_stock_event on public.products;
create trigger products_record_stock_event after insert or update of stock_quantity, low_stock_threshold on public.products for each row execute function public.record_product_stock_event();
revoke all on function public.record_product_stock_event() from public, anon, authenticated;


create or replace function public.get_available_booking_slots(
    p_date date,
    p_barber_id text default null,
    p_gender text default 'men',
    p_service_duration_minutes integer default 30
)
returns table(slot_time time, available_barber_id text, available_barber_name text)
language sql stable security definer set search_path = public as $$
    with candidates as (
        select b.id, b.name
        from public.barbers b
        where b.is_active
          and (p_barber_id is null or b.id = p_barber_id)
          and (b.service_gender = 'all' or b.service_gender = p_gender)
    ), slots as (
        select (time '09:00' + (slot_index * interval '1 hour'))::time as slot_time
        from generate_series(0, 10) as slot_index
        where extract(dow from p_date) between 1 and 6
    )
    select s.slot_time, min(c.id), min(c.name)
    from slots s
    join candidates c on exists (
        select 1 from public.barber_schedules bs
        where bs.barber_id = c.id
          and bs.day_of_week = extract(dow from p_date)::integer
          and bs.is_active
          and s.slot_time >= bs.open_time
          and s.slot_time + make_interval(mins => p_service_duration_minutes) <= bs.close_time
    )
    where not exists (
        select 1 from public.bookings x
        where x.barber_id = c.id
          and x.booking_date = p_date
          and x.status <> 'cancelled'
          and s.slot_time < x.booking_time + make_interval(mins => coalesce(nullif(regexp_replace(x.service_duration, '[^0-9]', '', 'g'), '')::integer, 60))
          and x.booking_time < s.slot_time + make_interval(mins => p_service_duration_minutes)
    )
    and not exists (
        select 1 from public.barber_blocked_times bt
        where bt.barber_id = c.id
          and bt.starts_at < ((p_date + s.slot_time) at time zone 'Asia/Manila') + make_interval(mins => p_service_duration_minutes)
          and bt.ends_at > ((p_date + s.slot_time) at time zone 'Asia/Manila')
    )
    group by s.slot_time
    order by s.slot_time;
$$;


alter table public.barber_schedules enable row level security;
alter table public.barber_blocked_times enable row level security;
drop policy if exists "Public view active barber schedules" on public.barber_schedules;
create policy "Public view active barber schedules" on public.barber_schedules for select using (is_active or public.is_admin());
drop policy if exists "Admins manage barber schedules" on public.barber_schedules;
create policy "Admins manage barber schedules" on public.barber_schedules for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Public view blocked barber times" on public.barber_blocked_times;
drop policy if exists "Admins manage blocked barber times" on public.barber_blocked_times;
create policy "Admins manage blocked barber times" on public.barber_blocked_times for all using (public.is_admin()) with check (public.is_admin());
