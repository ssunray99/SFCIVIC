-- Source registry. Run this once after `supabase db push`.
-- Apply with: supabase db reset --linked  (or paste into SQL editor)

insert into sources (id, name, url) values
  ('planning',         'SF Planning Commission',                              'https://sfplanning.org/hearings-cpc'),
  ('bos',              'SF Board of Supervisors (Full Board)',                 'https://www.sf.gov/departments--board-supervisors/events/upcoming'),
  ('bos-land-use',     'BOS Land Use and Transportation Committee',           'https://www.sf.gov/departments--board-supervisors/events/upcoming'),
  ('bos-budget',       'BOS Budget and Appropriations Committee',             'https://www.sf.gov/departments--board-supervisors/events/upcoming'),
  ('bos-rules',        'BOS Rules Committee',                                 'https://www.sf.gov/departments--board-supervisors/events/upcoming'),
  ('bos-public-safety','BOS Public Safety and Neighborhood Services Committee','https://www.sf.gov/departments--board-supervisors/events/upcoming'),
  ('bos-gao',          'BOS Government Audit and Oversight Committee',        'https://www.sf.gov/departments--board-supervisors/events/upcoming'),
  ('hpc',              'SF Historic Preservation Commission',                  'https://sfplanning.org/hearings-historic-preservation-commission')
on conflict (id) do update set
  name = excluded.name,
  url  = excluded.url;
