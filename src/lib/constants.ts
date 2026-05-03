// Closed enums shared by the LLM extraction prompt AND the frontend filter UI.
// Adding a value here is the single source of truth — no drift between scraper and UI.

export const DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
export type District = (typeof DISTRICTS)[number];

export const NEIGHBORHOODS = [
  'Bayview',
  'Bernal Heights',
  'Castro',
  'Chinatown',
  'Excelsior',
  'Financial District',
  'Glen Park',
  'Haight',
  'Hayes Valley',
  'Inner Richmond',
  'Inner Sunset',
  'Marina',
  'Mission',
  'Mission Bay',
  'Nob Hill',
  'Noe Valley',
  'North Beach',
  'Outer Richmond',
  'Outer Sunset',
  'Pacific Heights',
  'Portola',
  'Potrero Hill',
  'Presidio',
  'Russian Hill',
  'SoMa',
  'Tenderloin',
  'Treasure Island',
  'Twin Peaks',
  'Visitacion Valley',
  'West Portal',
  'Western Addition',
] as const;
export type Neighborhood = (typeof NEIGHBORHOODS)[number];

export const TOPICS = [
  'housing',
  'zoning',
  'transit',
  'parks',
  'public-safety',
  'homelessness',
  'small-business',
  'climate',
  'budget',
  'health',
  'education',
  'arts',
  'infrastructure',
  'elections',
  'other',
] as const;
export type Topic = (typeof TOPICS)[number];

export const ITEM_TYPES = [
  'hearing',
  'resolution',
  'ordinance',
  'informational',
  'other',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const SOURCES = [
  { id: 'planning', name: 'SF Planning Commission' },
  { id: 'bos', name: 'SF Board of Supervisors' },
  { id: 'hpc', name: 'SF Historic Preservation Commission' },
  { id: 'hearings', name: 'SF Public Hearing Notices' },
] as const;
export type SourceId = (typeof SOURCES)[number]['id'];
