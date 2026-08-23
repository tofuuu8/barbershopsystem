-- Toughcuts staging seed data. Existing stock is preserved on reruns.

insert into public.products (id, name, brand, category, price, stock_quantity, low_stock_threshold, description, gallery, is_active) values
('wax-fox-matte', 'Matte Molding Wax', 'FOX', 'wax', 250, 10, 5, 'A low-shine, high-hold molding wax built for texture.', array['images/products/matte-wax.jpg'], true),
('wax-atlas-natural', 'Natural Styling Wax', 'ATLAS', 'wax', 350, 10, 5, 'A medium-hold wax for a natural, undone look.', array['images/products/natural-wax.jpg'], true),
('wax-premium', 'Premium Styling Wax', 'Toughcuts', 'wax', 450, 10, 5, 'Barber-grade hold with a soft satin finish.', array['images/products/premium-wax.jpg'], true),
('spray-fox-matte', 'Solid Matte Spray', 'FOX', 'sprays', 400, 10, 5, 'A fine-mist finishing spray with zero shine.', array['images/products/matte-spray.jpg'], true),
('spray-atlas-volume', 'Volume Boost Spray', 'ATLAS', 'sprays', 380, 10, 5, 'A root-lifting spray that adds volume and body.', array['images/products/volume-spray.jpg'], true),
('spray-premium-hold', 'Premium Hold Spray', 'Toughcuts', 'sprays', 420, 10, 5, 'Maximum-hold finishing spray for structured styles.', array['images/products/premium-hold-spray.jpg'], true)
on conflict (id) do nothing;

insert into public.barbers (id, name, service_gender, is_active) values
('barber-russel', 'Barber Russel', 'all', true),
('klark-dizon', 'Barber Klark', 'all', true),
('barber-jon', 'Barber Jon', 'all', true)
on conflict (id) do update set name = excluded.name, is_active = excluded.is_active;

insert into public.services (id, gender, name, description, price, duration_minutes, is_active) values
('classic-haircut', 'men', 'Classic Haircut', 'A timeless, all-purpose cut — clean and sharp.', 280, 30, true),
('haircut-style', 'women', 'Haircut & Style', 'Cut, shape, and blow-dry finish.', 450, 45, true)
on conflict (id) do update set name = excluded.name, price = excluded.price, duration_minutes = excluded.duration_minutes, is_active = excluded.is_active;
