import { describe, expect, it } from 'vitest';
import { lireFondVectoriel, zoneArrondie, zoneEnGeoJson } from '../src/io/geojson.ts';

const hot = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[18.30, -4.10], [18.35, -4.12]] }, properties: { osm_id: 1, highway: 'track', name: null } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[18.30, -4.15], [18.40, -4.15]] }, properties: { osm_id: 2, highway: 'secondary' } },
    { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[18.2, -4.0], [18.3, -4.1]]] }, properties: { osm_id: 3, waterway: 'river' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [18.34, -4.17] }, properties: { osm_id: 4, place: 'village', name: 'Village A' } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[18.3, -4.2], [18.31, -4.2], [18.31, -4.21], [18.3, -4.2]]] }, properties: { osm_id: 5, boundary: 'timezone' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [18.3, -4.1] }, properties: { osm_id: 6, amenity: 'ferry_terminal' } },
  ],
};

describe('Fond de carte vectoriel (GeoJSON)', () => {
  it('trie les éléments utiles et ignore le reste', () => {
    const f = lireFondVectoriel([{ nom: 'zone.geojson', texte: JSON.stringify(hot) }]);
    expect(f.elements.map((e) => e.classe)).toEqual(['piste', 'route-principale', 'riviere', 'lieu']);
    expect(f.elements.find((e) => e.classe === 'lieu')?.nom).toBe('Village A');
    expect(f.attribution).toMatch(/OpenStreetMap/);
    expect(f.emprise[0]).toBeLessThan(f.emprise[2]);
  });
  it('refuse un fichier sans rien d’utilisable, avec un message clair', () => {
    expect(() => lireFondVectoriel([{ nom: 'x.json', texte: '{"type":"Polygon","coordinates":[]}' }])).toThrow(/GeoJSON/);
  });
  it('zone arrondie : élargie et calée sur 0,1°', () => {
    const z = zoneArrondie([{ lat: -4.124, lon: 18.4227 }, { lat: -4.31, lon: 18.33 }]);
    expect(z).toEqual({ ouest: 18.2, sud: -4.4, est: 18.5, nord: -4 });
    expect(JSON.parse(zoneEnGeoJson(z)).features[0].geometry.coordinates[0]).toHaveLength(5);
  });
});
