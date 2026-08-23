-- Toughcuts core upgrade
-- Adds repeatable operational tables, safe server-side transactions, and
-- durable event/notification records. Apply with `supabase db push`.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    email text,
    phone text,
    address text,
    is_admin boolean not null default false,
    preferred_barber_id text,
    default_fulfillment_type text not null default 'pickup',
    saved_addresses jsonb not null default '[]'::jsonb,
    notification_email boolean not null default true,
    notification_sms boolean not null default true,
    marketing_opt_in boolean not null default false,
    terms_accepted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists preferred_barber_id text;
alter table public.profiles add column if not exists default_fulfillment_type text not null default 'pickup';
alter table public.profiles add column if not exists saved_addresses jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists notification_email boolean not null default true;
alter table public.profiles add column if not exists notification_sms boolean not null default true;
alter table public.profiles add column if not exists marketing_opt_in boolean not null default false;
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create table if not exists public.barbers (
    id text primary key,
    name text not null,
    service_gender text not null default 'all' check (service_gender in ('all', 'men', 'women')),
    phone text,
    email text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.barber_schedules (
    barber_id text not null references public.barbers(id) on delete cascade,
    day_of_week integer not null check (day_of_week between 0 and 6),
    open_time time not null,
    close_time time not null,
    is_active boolean not null default true,
    primary key (barber_id, day_of_week),
    check (close_time > open_time)
);

create table if not exists public.barber_blocked_times (
    id uuid primary key default gen_random_uuid(),
    barber_id text not null references public.barbers(id) on delete cascade,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    reason text,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    check (ends_at > starts_at)
);

create table if not exists public.services (
    id text primary key,
    gender text not null check (gender in ('men', 'women', 'all')),
    name text not null,
    description text,
    price numeric(12,2) not null check (price >= 0),
    duration_minutes integer not null check (duration_minutes > 0),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.delivery_areas (
    name text primary key,
    label text not null,
    fee numeric(12,2) not null check (fee >= 0),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.products (
    id text primary key,
    name text not null,
    brand text,
    category text,
    price numeric(12,2) not null check (price >= 0),
    stock_quantity integer not null default 0 check (stock_quantity >= 0),
    low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
    description text,
    features text[] not null default '{}',
    how_to_use text[] not null default '{}',
    gallery text[] not null default '{}',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete restrict,
    customer_name text,
    fulfillment_type text not null default 'pickup' check (fulfillment_type in ('pickup', 'delivery')),
    area text,
    address text,
    contact_phone text,
    subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
    delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
    total_price numeric(12,2) not null default 0 check (total_price >= 0),
    status text not null default 'pending' check (status in ('awaiting_payment', 'pending', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
    payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
    payment_provider text,
    payment_reference text,
    paid_at timestamptz,
    expires_at timestamptz,
    last_payment_attempt_at timestamptz,
    notes text,
    cancel_reason text,
    cancelled_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists area text;
alter table public.orders add column if not exists delivery_fee numeric(12,2) not null default 0;
alter table public.orders add column if not exists expires_at timestamptz;
alter table public.orders add column if not exists last_payment_attempt_at timestamptz;
alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists completed_at timestamptz;
alter table public.orders add column if not exists updated_at timestamptz not null default now();
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('awaiting_payment', 'pending', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'));

create table if not exists public.order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    product_id text not null,
    product_name text not null,
    unit_price numeric(12,2) not null check (unit_price >= 0),
    quantity integer not null check (quantity > 0),
    line_total numeric(12,2) not null check (line_total >= 0),
    created_at timestamptz not null default now()
);

create table if not exists public.bookings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete restrict,
    gender text not null check (gender in ('men', 'women')),
    service_id text not null,
    service_name text not null,
    service_price numeric(12,2) not null check (service_price >= 0),
    service_duration text not null,
    barber_id text references public.barbers(id) on delete set null,
    barber_name text,
    location_type text not null default 'studio' check (location_type in ('studio', 'home')),
    area text,
    address text,
    travel_fee numeric(12,2) not null default 0 check (travel_fee >= 0),
    total_price numeric(12,2) not null default 0 check (total_price >= 0),
    booking_date date not null,
    booking_time time not null,
    contact_phone text,
    contact_preference text not null default 'phone' check (contact_preference in ('phone', 'email')),
    notes text,
    status text not null default 'pending' check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.bookings add column if not exists updated_at timestamptz not null default now();
alter table public.bookings add column if not exists contact_phone text;
alter table public.bookings add column if not exists contact_preference text not null default 'phone';

create table if not exists public.order_events (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    event_type text not null,
    old_status text,
    new_status text,
    actor_id uuid references auth.users(id) on delete set null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.booking_events (
    id uuid primary key default gen_random_uuid(),
    booking_id uuid not null references public.bookings(id) on delete cascade,
    event_type text not null,
    old_status text,
    new_status text,
    actor_id uuid references auth.users(id) on delete set null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
    id uuid primary key default gen_random_uuid(),
    product_id text not null references public.products(id) on delete restrict,
    order_id uuid references public.orders(id) on delete set null,
    quantity_delta integer not null,
    reason text not null,
    actor_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.payment_attempts (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    provider text not null default 'paymongo',
    checkout_session_id text,
    status text not null default 'created' check (status in ('created', 'paid', 'failed', 'cancelled', 'expired')),
    amount numeric(12,2) not null default 0 check (amount >= 0),
    created_at timestamptz not null default now(),
    expires_at timestamptz,
    completed_at timestamptz,
    raw_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    audience text not null check (audience in ('customer', 'admin')),
    event_type text not null,
    title text not null,
    body text not null,
    entity_type text,
    entity_id text,
    read_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_orders_user_created on public.orders(user_id, created_at desc);
create index if not exists idx_orders_status_expires on public.orders(status, expires_at);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_bookings_barber_date on public.bookings(barber_id, booking_date, booking_time);
create index if not exists idx_bookings_user_date on public.bookings(user_id, booking_date desc);
create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_admin_created on public.notifications(audience, created_at desc);
create index if not exists idx_payment_attempts_order on public.payment_attempts(order_id, created_at desc);
create index if not exists idx_stock_movements_product_created on public.stock_movements(product_id, created_at desc);

insert into public.barbers (id, name, service_gender) values
    ('barber-russel', 'Barber Russel', 'all'),
    ('klark-dizon', 'Barber Klark', 'all'),
    ('barber-jon', 'Barber Jon', 'all')
on conflict (id) do update set name = excluded.name;

insert into public.services (id, gender, name, description, price, duration_minutes) values
    ('classic-haircut', 'men', 'Classic Haircut', 'A timeless, all-purpose cut — clean and sharp.', 280, 30),
    ('haircut-style', 'women', 'Haircut & Style', 'Cut, shape, and blow-dry finish.', 450, 45)
on conflict (id) do update set name = excluded.name, price = excluded.price, duration_minutes = excluded.duration_minutes;

insert into public.delivery_areas (name, label, fee) values
    ('san isidro', 'San Isidro', 80),
    ('rodriguez', 'Rodriguez (Montalban)', 100),
    ('san mateo', 'San Mateo', 150),
    ('marikina', 'Marikina', 180),
    ('antipolo', 'Antipolo', 200),
    ('cainta', 'Cainta', 200),
    ('taytay', 'Taytay', 220),
    ('quezon city', 'Quezon City', 250)
on conflict (name) do update set label = excluded.label, fee = excluded.fee;

insert into public.barber_schedules (barber_id, day_of_week, open_time, close_time)
select b.id, d.day_of_week, time '09:00', case when d.day_of_week = 6 then time '18:00' else time '20:00' end
from public.barbers b cross join generate_series(1, 6) as d(day_of_week)
on conflict (barber_id, day_of_week) do update set open_time = excluded.open_time, close_time = excluded.close_time;

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at before update on public.bookings for each row execute function public.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles where id = auth.uid() and is_admin = true);
$$;

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
    ),
    slots as (
        select (time '09:00' + (slot_index * interval '1 hour'))::time as slot_time
        from generate_series(0, 10) as slot_index
        where extract(dow from p_date) between 1 and 6
          and (extract(dow from p_date) <> 6 or time '19:00' + make_interval(mins => p_service_duration_minutes) <= time '18:00')
          and (extract(dow from p_date) <> 6 or time '09:00' + make_interval(mins => p_service_duration_minutes) <= time '18:00')
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
          and s.slot_time < x.booking_time + make_interval(mins => regexp_replace(x.service_duration, '[^0-9]', '', 'g')::integer)
          and x.booking_time < s.slot_time + make_interval(mins => p_service_duration_minutes)
    )
    group by s.slot_time
    order by s.slot_time;
$$;

create or replace function public.create_order_atomic(
    p_customer_name text,
    p_fulfillment_type text,
    p_area text,
    p_address text,
    p_contact_phone text,
    p_notes text,
    p_items jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_user_id uuid := auth.uid();
    v_order_id uuid;
    v_subtotal numeric(12,2);
    v_delivery_fee numeric(12,2) := 0;
    v_total numeric(12,2);
    v_count integer;
begin
    if v_user_id is null then raise exception 'Please log in to place an order.' using errcode = '42501'; end if;
    if nullif(trim(p_customer_name), '') is null or length(trim(p_customer_name)) < 2 then raise exception 'Please provide your full name.'; end if;
    if p_fulfillment_type not in ('pickup', 'delivery') then raise exception 'Please choose pickup or delivery.'; end if;
    if p_fulfillment_type = 'delivery' and (nullif(trim(p_area), '') is null or nullif(trim(p_address), '') is null) then raise exception 'Please provide a delivery area and address.'; end if;
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty.'; end if;

    perform 1 from public.products p
    where p.id in (select value->>'product_id' from jsonb_array_elements(p_items))
    for update;

    with requested as (
        select value->>'product_id' as product_id, (value->>'quantity')::integer as quantity
        from jsonb_array_elements(p_items)
    ), aggregated as (
        select product_id, sum(quantity)::integer as quantity from requested group by product_id
    )
    select count(*) into v_count from aggregated;
    if v_count = 0 then raise exception 'Your cart contains no valid products.'; end if;

    if exists (
        with requested as (
            select value->>'product_id' as product_id, (value->>'quantity')::integer as quantity
            from jsonb_array_elements(p_items)
        ), aggregated as (select product_id, sum(quantity)::integer quantity from requested group by product_id)
        select 1 from aggregated r left join public.products p on p.id = r.product_id
        where p.id is null or not p.is_active or r.quantity <= 0 or r.quantity > p.stock_quantity
    ) then raise exception 'One or more products are unavailable or out of stock.' using errcode = 'P0001'; end if;

    with requested as (
        select value->>'product_id' product_id, (value->>'quantity')::integer quantity from jsonb_array_elements(p_items)
    ), aggregated as (select product_id, sum(quantity)::integer quantity from requested group by product_id)
    select coalesce(sum(p.price * r.quantity), 0) into v_subtotal
    from aggregated r join public.products p on p.id = r.product_id;

    if p_fulfillment_type = 'delivery' then
        select fee into v_delivery_fee from public.delivery_areas where name = lower(trim(p_area)) and is_active;
        if v_delivery_fee is null then raise exception 'Please choose a valid delivery area.'; end if;
    end if;
    v_total := v_subtotal + v_delivery_fee;

    insert into public.orders (user_id, customer_name, fulfillment_type, area, address, contact_phone, subtotal, delivery_fee, total_price, status, payment_status, notes)
    values (v_user_id, trim(p_customer_name), p_fulfillment_type, case when p_fulfillment_type = 'delivery' then lower(trim(p_area)) else null end, case when p_fulfillment_type = 'delivery' then trim(p_address) else null end, trim(p_contact_phone), v_subtotal, v_delivery_fee, v_total, 'pending', 'unpaid', nullif(trim(p_notes), ''))
    returning id into v_order_id;

    with requested as (
        select value->>'product_id' product_id, (value->>'quantity')::integer quantity from jsonb_array_elements(p_items)
    ), aggregated as (select product_id, sum(quantity)::integer quantity from requested group by product_id)
    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
    select v_order_id, p.id, p.name, p.price, r.quantity, p.price * r.quantity
    from aggregated r join public.products p on p.id = r.product_id;

    insert into public.order_events (order_id, event_type, new_status, actor_id, details)
    values (v_order_id, 'order_created', 'pending', v_user_id, jsonb_build_object('source', 'customer_checkout'));

    return jsonb_build_object('id', v_order_id, 'subtotal', v_subtotal, 'delivery_fee', v_delivery_fee, 'total_price', v_total);
end;
$$;

grant execute on function public.get_available_booking_slots(date, text, text, integer) to anon, authenticated;
grant execute on function public.create_order_atomic(text, text, text, text, text, text, jsonb) to authenticated;

create or replace function public.expire_unpaid_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
    update public.orders
       set status = 'cancelled', payment_status = 'failed', cancel_reason = 'Payment window expired', cancelled_at = now()
     where status = 'awaiting_payment' and payment_status <> 'paid' and expires_at is not null and expires_at < now();
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

grant execute on function public.expire_unpaid_orders() to service_role;

create or replace function public.record_order_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' then
        insert into public.order_events(order_id, event_type, new_status, actor_id) values (new.id, 'created', new.status, auth.uid());
        if new.user_id is not null then
            insert into public.notifications(user_id, audience, event_type, title, body, entity_type, entity_id)
            values (new.user_id, 'customer', 'order_created', 'Order received', 'Your order has been received and is being reviewed.', 'order', new.id::text);
        end if;
        insert into public.notifications(audience, event_type, title, body, entity_type, entity_id)
        values ('admin', 'order_created', 'New order', 'A new order needs attention.', 'order', new.id::text);
    elsif new.status is distinct from old.status or new.payment_status is distinct from old.payment_status then
        insert into public.order_events(order_id, event_type, old_status, new_status, actor_id)
        values (new.id, case when new.payment_status is distinct from old.payment_status then 'payment_status_changed' else 'status_changed' end, old.status, new.status, auth.uid());
        if new.user_id is not null and new.status is distinct from old.status then
            insert into public.notifications(user_id, audience, event_type, title, body, entity_type, entity_id)
            values (new.user_id, 'customer', 'order_status_changed', 'Order status updated', 'Your order is now ' || replace(new.status, '_', ' ') || '.', 'order', new.id::text);
        end if;
        if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
            insert into public.notifications(user_id, audience, event_type, title, body, entity_type, entity_id)
            values (new.user_id, 'customer', 'payment_paid', 'Payment confirmed', 'Your online payment was confirmed.', 'order', new.id::text);
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists orders_record_event on public.orders;
create trigger orders_record_event after insert or update of status, payment_status on public.orders for each row execute function public.record_order_event();

create or replace function public.record_booking_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' then
        insert into public.booking_events(booking_id, event_type, new_status, actor_id) values (new.id, 'created', new.status, auth.uid());
        insert into public.notifications(audience, event_type, title, body, entity_type, entity_id)
        values ('admin', 'booking_created', 'New appointment', 'A new appointment needs attention.', 'booking', new.id::text);
        insert into public.notifications(user_id, audience, event_type, title, body, entity_type, entity_id)
        values (new.user_id, 'customer', 'booking_created', 'Appointment requested', 'Your appointment request was received and is awaiting confirmation.', 'booking', new.id::text);
    elsif new.status is distinct from old.status or new.booking_date is distinct from old.booking_date or new.booking_time is distinct from old.booking_time then
        insert into public.booking_events(booking_id, event_type, old_status, new_status, actor_id)
        values (new.id, case when new.status is distinct from old.status then 'status_changed' else 'rescheduled' end, old.status, new.status, auth.uid());
        insert into public.notifications(user_id, audience, event_type, title, body, entity_type, entity_id)
        values (new.user_id, 'customer', 'booking_updated', 'Appointment updated', 'Your appointment details were updated.', 'booking', new.id::text);
    end if;
    return new;
end;
$$;

drop trigger if exists bookings_record_event on public.bookings;
create trigger bookings_record_event after insert or update of status, booking_date, booking_time on public.bookings for each row execute function public.record_booking_event();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.bookings enable row level security;
alter table public.barbers enable row level security;
alter table public.services enable row level security;
alter table public.delivery_areas enable row level security;
alter table public.notifications enable row level security;
alter table public.order_events enable row level security;
alter table public.booking_events enable row level security;

 drop policy if exists "Users can view own profile" on public.profiles;
 create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id or public.is_admin());
 drop policy if exists "Users can insert own profile" on public.profiles;
 create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);
 drop policy if exists "Users can update own profile" on public.profiles;
 create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id or public.is_admin()) with check (auth.uid() = id or public.is_admin());

 drop policy if exists "Public can view active products" on public.products;
 create policy "Public can view active products" on public.products for select using (is_active or public.is_admin());
 drop policy if exists "Admins manage products" on public.products;
 create policy "Admins manage products" on public.products for all using (public.is_admin()) with check (public.is_admin());

 drop policy if exists "Users view own orders" on public.orders;
 create policy "Users view own orders" on public.orders for select using (auth.uid() = user_id or public.is_admin());
 drop policy if exists "Users update own cancellable orders" on public.orders;
 create policy "Users update own cancellable orders" on public.orders for update using (auth.uid() = user_id and status in ('pending', 'awaiting_payment') and not (payment_provider is not null and payment_status = 'paid')) with check (auth.uid() = user_id and status = 'cancelled');
 drop policy if exists "Admins manage orders" on public.orders;
 create policy "Admins manage orders" on public.orders for all using (public.is_admin()) with check (public.is_admin());

 drop policy if exists "Users view order items" on public.order_items;
 create policy "Users view order items" on public.order_items for select using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
 drop policy if exists "Admins manage order items" on public.order_items;
 create policy "Admins manage order items" on public.order_items for all using (public.is_admin()) with check (public.is_admin());

 drop policy if exists "Users view own bookings" on public.bookings;
 create policy "Users view own bookings" on public.bookings for select using (auth.uid() = user_id or public.is_admin());
 drop policy if exists "Users cancel own bookings" on public.bookings;
 create policy "Users cancel own bookings" on public.bookings for update using (auth.uid() = user_id and status in ('pending', 'confirmed')) with check (auth.uid() = user_id and status = 'cancelled');
 drop policy if exists "Admins manage bookings" on public.bookings;
 create policy "Admins manage bookings" on public.bookings for all using (public.is_admin()) with check (public.is_admin());

 drop policy if exists "Public view active barbers" on public.barbers;
 create policy "Public view active barbers" on public.barbers for select using (is_active or public.is_admin());
 drop policy if exists "Admins manage barbers" on public.barbers;
 create policy "Admins manage barbers" on public.barbers for all using (public.is_admin()) with check (public.is_admin());
 drop policy if exists "Public view active services" on public.services;
 create policy "Public view active services" on public.services for select using (is_active or public.is_admin());
 drop policy if exists "Admins manage services" on public.services;
 create policy "Admins manage services" on public.services for all using (public.is_admin()) with check (public.is_admin());
 drop policy if exists "Public view active delivery areas" on public.delivery_areas;
 create policy "Public view active delivery areas" on public.delivery_areas for select using (is_active or public.is_admin());

 drop policy if exists "Users view own notifications" on public.notifications;
 create policy "Users view own notifications" on public.notifications for select using ((audience = 'customer' and user_id = auth.uid()) or (audience = 'admin' and public.is_admin()));
 drop policy if exists "Users mark own notifications read" on public.notifications;
 create policy "Users mark own notifications read" on public.notifications for update using ((audience = 'customer' and user_id = auth.uid()) or (audience = 'admin' and public.is_admin())) with check ((audience = 'customer' and user_id = auth.uid()) or (audience = 'admin' and public.is_admin()));

 drop policy if exists "Users view own order events" on public.order_events;
 create policy "Users view own order events" on public.order_events for select using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
 drop policy if exists "Users view own booking events" on public.booking_events;
 create policy "Users view own booking events" on public.booking_events for select using (exists (select 1 from public.bookings b where b.id = booking_id and (b.user_id = auth.uid() or public.is_admin())));

revoke all on function public.record_order_event() from public, anon, authenticated;
revoke all on function public.record_booking_event() from public, anon, authenticated;
