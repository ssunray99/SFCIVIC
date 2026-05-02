-- Source registry. Run this once after `supabase db push`.
-- Apply with: supabase db reset --linked  (or paste into SQL editor)

insert into sources (id, name, url) values
  ('planning', 'SF Planning Commission',                'https://sfplanning.org/hearings-cpc'),
  ('bos',      'SF Board of Supervisors',               'https://www.sf.gov/departments--board-supervisors/events/upcoming'),
  ('hpc',      'SF Historic Preservation Commission',   'https://sfplanning.org/hearings-historic-preservation-commission')
on conflict (id) do update set
  name = excluded.name,
  url  = excluded.url;
