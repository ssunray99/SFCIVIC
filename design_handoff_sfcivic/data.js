// SFCIVIC mock data
window.SFCIVIC_DATA = (() => {
  const today = new Date();
  const iso = (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const SOURCES = [
    { id: 'planning',          name: 'Planning Commission',          code: 'PLN' },
    { id: 'bos',               name: 'Board of Supervisors',         code: 'BOS' },
    { id: 'bos-land-use',      name: 'Land Use & Transportation',    code: 'LUT' },
    { id: 'bos-budget',        name: 'Budget & Appropriations',      code: 'BUD' },
    { id: 'bos-rules',         name: 'Rules Committee',              code: 'RUL' },
    { id: 'bos-public-safety', name: 'Public Safety & Neighborhood', code: 'PSN' },
    { id: 'bos-gao',           name: 'Govt. Audit & Oversight',      code: 'GAO' },
    { id: 'hpc',               name: 'Historic Preservation',        code: 'HPC' },
    { id: 'hearings',          name: 'Public Hearing Notices',       code: 'NTC' },
    { id: 'sfmta',             name: 'SFMTA Board of Directors',     code: 'MTA' },
  ];

  const TOPICS = ['housing','zoning','transit','public-safety','homelessness','parks','budget','climate','small-business','health','education','arts','infrastructure','elections'];

  const FEATURED_NEIGHBORHOODS = ['Mission','SoMa','Tenderloin','Castro','Bayview','Chinatown','Inner Sunset','Outer Sunset'];

  const DISTRICTS = [
    { n: 1,  name: 'Richmond',                count: 7  },
    { n: 2,  name: 'Marina · Pacific Heights', count: 4  },
    { n: 3,  name: 'North Beach · Chinatown',  count: 9  },
    { n: 4,  name: 'Sunset',                   count: 5  },
    { n: 5,  name: 'Haight · Western Addition',count: 12 },
    { n: 6,  name: 'SoMa · Tenderloin',        count: 18 },
    { n: 7,  name: 'West Portal · Lake Merced',count: 3  },
    { n: 8,  name: 'Castro · Noe',             count: 6  },
    { n: 9,  name: 'Mission · Bernal',         count: 14 },
    { n: 10, name: 'Bayview · Potrero',        count: 11 },
    { n: 11, name: 'Excelsior',                count: 4  },
  ];

  const meetings = [
    {
      id: 'm-1', source_id: 'bos-land-use',
      title: 'Land Use & Transportation Committee',
      meeting_date: iso(2), time: '1:30 PM',
      location: 'City Hall, Room 263',
      items: [
        { id: 'i-1', position: 1,
          title: 'Ordinance — Inclusionary Housing fee adjustment for projects above 25 units',
          summary: 'Amends the Planning Code to recalibrate the in-lieu fee schedule. Staff recommends approval with modifications. Sponsor seeks deferral to continue negotiations with affordable housing advocates.',
          item_type: 'ordinance',
          district: 5, neighborhoods: ['Hayes Valley','Western Addition'],
          topics: ['housing','zoning'],
          comment_deadline: iso(1), comment_email: 'board.of.supervisors@sfgov.org',
          matter_file_number: '250604' },
        { id: 'i-2', position: 2,
          title: 'Resolution — 30-month grant agreement for SoMa pedestrian safety improvements',
          summary: 'Approves $4.2M agreement with SFMTA for protected intersections at 7 SoMa crossings identified in the High-Injury Network.',
          item_type: 'resolution',
          district: 6, neighborhoods: ['SoMa'],
          topics: ['transit','public-safety','infrastructure'],
          comment_portal_url: 'https://sfgov.org/comment',
          in_person_slot: 'In person — City Hall Rm 263, 1:30 PM',
          matter_file_number: '250587' },
        { id: 'i-3', position: 3,
          title: 'Hearing — Quarterly update on Vision Zero traffic fatalities (informational)',
          summary: 'Departmental presentation. No action item; public comment open.',
          item_type: 'informational',
          district: null, neighborhoods: [], topics: ['transit','public-safety'] },
      ],
    },
    {
      id: 'm-2', source_id: 'planning',
      title: 'Planning Commission Regular Hearing',
      meeting_date: iso(4), time: '12:00 PM',
      location: 'City Hall, Room 400',
      items: [
        { id: 'i-4', position: 1,
          title: '1840 Mission Street — Conditional Use Authorization for 89-unit residential development',
          summary: 'Six-story mixed-use building with 12 below-market-rate units and 4,400 sq ft of ground-floor retail. Replaces existing single-story commercial structure.',
          item_type: 'hearing',
          district: 9, neighborhoods: ['Mission'],
          topics: ['housing','zoning','small-business'],
          comment_deadline: iso(3), comment_email: 'commissions.secretary@sfgov.org' },
        { id: 'i-5', position: 2,
          title: 'Discretionary Review — 645 Outer Richmond, single-family rear addition',
          summary: 'Neighbor-initiated DR; concerns regarding light, privacy, and rear-yard pattern. Staff recommends approval with conditions.',
          item_type: 'hearing',
          district: 1, neighborhoods: ['Outer Richmond'], topics: ['housing','zoning'] },
        { id: 'i-6', position: 3,
          title: 'Castro Cultural District — Annual Report and Strategic Plan adoption',
          summary: 'Three-year goals around small-business retention, cultural programming, and storefront grants.',
          item_type: 'resolution',
          district: 8, neighborhoods: ['Castro'], topics: ['arts','small-business'],
          comment_deadline: iso(3), comment_portal_url: 'https://sfplanning.org/comment' },
      ],
    },
    {
      id: 'm-3', source_id: 'bos',
      title: 'Board of Supervisors — Regular Meeting',
      meeting_date: iso(7), time: '2:00 PM',
      location: 'City Hall, Legislative Chamber',
      items: [
        { id: 'i-7', position: 1,
          title: 'Second reading — Tenant Protection amendments (relocation assistance increase)',
          summary: 'Increases statutory relocation payments and clarifies notice requirements for owner move-in evictions.',
          item_type: 'ordinance',
          district: null, neighborhoods: [], topics: ['housing'],
          comment_deadline: iso(6), comment_email: 'board.of.supervisors@sfgov.org',
          matter_file_number: '250441' },
        { id: 'i-8', position: 2,
          title: 'Resolution — Naming portion of 24th Street the "Calle 24 Latino Cultural Corridor"',
          summary: 'Ceremonial designation along the existing cultural district boundaries.',
          item_type: 'resolution',
          district: 9, neighborhoods: ['Mission'], topics: ['arts'] },
        { id: 'i-9', position: 3,
          title: 'Hearing — Homelessness response coordination across departments',
          summary: 'Annual cross-departmental update from HSH, DPH, and DPW on shelter capacity, outreach, and housing placements.',
          item_type: 'informational',
          district: null, neighborhoods: [], topics: ['homelessness','health','public-safety'] },
      ],
    },
    {
      id: 'm-4', source_id: 'sfmta',
      title: 'SFMTA Board of Directors',
      meeting_date: iso(9), time: '1:00 PM',
      location: 'SFMTA HQ — One South Van Ness',
      items: [
        { id: 'i-10', position: 1,
          title: 'Approval — Geary Boulevard transit lane extension to 28th Avenue',
          summary: 'Extends red transit-only lanes 14 blocks west; staff projects 12% travel-time improvement on the 38R Geary Rapid.',
          item_type: 'resolution',
          district: 1, neighborhoods: ['Inner Richmond','Outer Richmond'],
          topics: ['transit','infrastructure'],
          comment_deadline: iso(8), comment_portal_url: 'https://sfmta.com/comment' },
        { id: 'i-11', position: 2,
          title: 'Fare structure — Equity-based discount expansion for households below 200% FPL',
          summary: 'Expands existing low-income transit pass eligibility and authorizes 18-month outreach campaign.',
          item_type: 'ordinance',
          district: null, neighborhoods: [], topics: ['transit','budget'] },
      ],
    },
    {
      id: 'm-5', source_id: 'hearings',
      title: 'Public Hearing Notice — 2424 Lombard Street',
      meeting_date: iso(11), time: '6:00 PM',
      location: 'Marina Middle School Auditorium',
      items: [
        { id: 'i-12', position: 1,
          title: 'Demolition and replacement of 2424 Lombard Street — community notice',
          summary: 'Replacement of existing 2-unit building with 6-unit residential structure. Statutory neighborhood notification.',
          item_type: 'hearing',
          district: 2, neighborhoods: ['Marina'], topics: ['housing','zoning'],
          comment_deadline: iso(10), in_person_slot: 'In person — Marina Middle School, 6:00 PM' },
      ],
    },
    {
      id: 'm-6', source_id: 'bos-budget', past: true,
      title: 'Budget & Appropriations Committee',
      meeting_date: iso(-3), time: '10:00 AM',
      location: 'City Hall, Room 250',
      items: [
        { id: 'i-13', position: 1,
          title: 'FY26 Department of Public Health supplemental appropriation',
          summary: 'Reviewed and forwarded to Full Board with recommendation. Two amendments accepted regarding behavioral-health staffing.',
          item_type: 'ordinance',
          district: null, neighborhoods: [], topics: ['health','budget','homelessness'],
          matter_file_number: '250332' },
        { id: 'i-14', position: 2,
          title: 'Hearing — Library system capital plan three-year outlook',
          summary: 'SFPL presented Bayview, Excelsior, and Mission branch renovation timelines and cost contingencies.',
          item_type: 'informational',
          district: null, neighborhoods: ['Bayview','Excelsior','Mission'], topics: ['education','infrastructure'] },
      ],
    },
    {
      id: 'm-7', source_id: 'hpc', past: true,
      title: 'Historic Preservation Commission',
      meeting_date: iso(-7), time: '12:30 PM',
      location: 'City Hall, Room 400',
      items: [
        { id: 'i-15', position: 1,
          title: 'Article 10 designation — 542 Natoma Street worker cottage',
          summary: 'Recommended Article 10 landmark status; forwarded to Board of Supervisors for adoption.',
          item_type: 'resolution',
          district: 6, neighborhoods: ['SoMa'], topics: ['housing','arts'] },
      ],
    },
  ];

  return { SOURCES, TOPICS, FEATURED_NEIGHBORHOODS, DISTRICTS, meetings, today };
})();
