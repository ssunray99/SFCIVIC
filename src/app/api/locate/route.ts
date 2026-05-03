import { neighborhoodFromPoint, districtFromPoint } from '../../../../scraper/lib/geo.ts';

// SF bounding box (loose) matching scraper/lib/geocode.ts
const SF_BBOX = {
  minLat: 37.704,
  maxLat: 37.835,
  minLng: -122.524,
  maxLng: -122.354,
};

const USER_AGENT = 'sfcivic-tracker/0.1 (https://github.com/ssunray99/SFCIVIC)';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address')?.trim();
  if (!address || address.length < 4) {
    return Response.json({ error: 'address required' }, { status: 400 });
  }

  const q = encodeURIComponent(`${address}, San Francisco, CA`);
  const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&limit=1&countrycodes=us`;

  let lat: number;
  let lng: number;
  try {
    const resp = await fetch(nominatimUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!resp.ok) {
      return Response.json({ error: 'geocode failed' }, { status: 502 });
    }
    const json = (await resp.json()) as Array<{ lat: string; lon: string }>;
    if (json.length === 0) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
    lat = parseFloat(json[0].lat);
    lng = parseFloat(json[0].lon);
    if (
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < SF_BBOX.minLat || lat > SF_BBOX.maxLat ||
      lng < SF_BBOX.minLng || lng > SF_BBOX.maxLng
    ) {
      return Response.json({ error: 'address not found in San Francisco' }, { status: 404 });
    }
  } catch {
    return Response.json({ error: 'geocode failed' }, { status: 502 });
  }

  const neighborhood = neighborhoodFromPoint(lat, lng);
  const district = districtFromPoint(lat, lng);

  return Response.json({ lat, lng, neighborhood, district });
}
