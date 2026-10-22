-- One-off update run live with the schema changes of October 22, 2026: the owner's starting prices replace the ones
-- first shown on the Rentals page, and the three package deals are withdrawn. Not part of schema.sql, so running that
-- again never overwrites prices changed since.
update public.items set price = 299 where kind = 'wall';
update public.items set price = 30 where kind = 'neon';
update public.items set price = null where id = 'bloom-bar';
update public.items set price = 120 where id = 'pedestals';
update public.items set price = 5.95 where id = 'sweets-cart';
delete from public.packages where id in ('pkg-sweet-setup', 'pkg-bridal-suite', 'pkg-full-bloom');
