-- Source registry. Run this once after `supabase db push`.
-- Apply with: supabase db reset --linked  (or paste into SQL editor)

insert into sources (id, name, url) values
  ('planning', 'SF Planning Commission',     'https://sfplanning.org/hearings-cpc'),
  ('bos',      'SF Board of Supervisors',    'https://sfbos.org/meetings'),
  ('hearings', 'SF Public Hearing Notices',  'https://sfplanning.org/notices')
on conflict (id) do update set
  name = excluded.name,
  url  = excluded.url;
