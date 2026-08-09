/**
 * Shared Region/City bucketing for reports that offer "Region Wise" / "City Wise" /
 * "Region + City Wise" grouping (Sale Analysis, Sale Report) — one implementation so the three
 * modes sort/group identically everywhere they're offered, instead of each report page rolling
 * its own copy (see the pre-existing per-page `regionGroups` duplication this replaces).
 */

export interface GeoRow {
  regionId: number | null;
  regionName: string | null;
  cityId: number | null;
  cityName: string | null;
}

export interface GeoBucket<T> {
  id: number | null;
  name: string;
  rows: T[];
}

export interface RegionCityBucket<T> {
  id: number | null;
  name: string;
  rows: T[];
  cities: GeoBucket<T>[];
}

function bucketBy<T>(rows: T[], keyOf: (row: T) => number | null, nameOf: (row: T) => string): GeoBucket<T>[] {
  const buckets = new Map<string, GeoBucket<T>>();
  rows.forEach(row => {
    const id = keyOf(row);
    const key = String(id ?? 'none');
    if (!buckets.has(key)) buckets.set(key, { id, name: nameOf(row), rows: [] });
    buckets.get(key)!.rows.push(row);
  });
  return Array.from(buckets.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Region Wise: one bucket per region ("No Region" for null region_id), sorted alphabetically. */
export function groupByRegion<T extends GeoRow>(rows: T[]): GeoBucket<T>[] {
  return bucketBy(rows, r => r.regionId, r => r.regionName || 'No Region');
}

/** City Wise: one bucket per city ("No City" for null city_id), sorted alphabetically — ignores region entirely. */
export function groupByCity<T extends GeoRow>(rows: T[]): GeoBucket<T>[] {
  return bucketBy(rows, r => r.cityId, r => r.cityName || 'No City');
}

/** Region + City Wise: region buckets (alphabetical), each holding its own city sub-buckets (alphabetical). */
export function groupByRegionThenCity<T extends GeoRow>(rows: T[]): RegionCityBucket<T>[] {
  return groupByRegion(rows).map(region => ({
    ...region,
    cities: groupByCity(region.rows),
  }));
}
