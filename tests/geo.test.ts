import { describe, expect, it } from 'vitest';
import { centre, detecterColonneGps, distance, groupesProches, lirePoint, pointDepuis, type Point } from '../src/controles/geo.ts';

describe('GPS', () => {
  it('lit le format Kobo et les variantes', () => {
    expect(lirePoint('-4.180000 18.300000 350.5 4.8')).toEqual({ lat: -4.18, lon: 18.3, precision: 4.8 });
    expect(lirePoint('-4.18,18.3')).toEqual({ lat: -4.18, lon: 18.3, precision: undefined });
    expect(lirePoint('')).toBeUndefined();
    expect(lirePoint('0 0 0 0')).toBeUndefined();
    expect(lirePoint('120 10')).toBeUndefined();
  });
  it('colonnes éclatées et détection', () => {
    const v: Record<string, string> = { _gps_latitude: '-4.2', _gps_longitude: '18.4', _gps_precision: '6' };
    expect(pointDepuis((c) => v[c], 'gps')).toEqual({ lat: -4.2, lon: 18.4, precision: 6 });
    expect(detecterColonneGps(['start', 'gps', '_gps_latitude', '_gps_longitude'])).toBe('gps');
    expect(detecterColonneGps(['start', 'coordonnees'])).toBe('coordonnees');
    expect(detecterColonneGps(['start', 'end'])).toBeUndefined();
  });
  it('distances', () => {
    // 0,001° de latitude ≈ 111 m.
    expect(distance({ lat: -4.2, lon: 18.3 }, { lat: -4.201, lon: 18.3 })).toBeCloseTo(111.2, 0);
    expect(centre([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, { lat: 50, lon: 50 }])).toEqual({ lat: 1, lon: 1 });
  });
  it('regroupement par grille identique au calcul exhaustif', () => {
    let graine = 42;
    const alea = () => ((graine = (graine * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const points = new Map<string, Point>();
    for (let i = 0; i < 400; i++) points.set(`M${String(i).padStart(3, '0')}`, { lat: -4.2 + alea() * 0.01, lon: 18.3 + alea() * 0.01 });
    const seuil = 25;
    const parent = new Map([...points.keys()].map((k) => [k, k]));
    const r = (x: string): string => (parent.get(x) === x ? x : r(parent.get(x)!));
    const ids = [...points.keys()];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (distance(points.get(ids[i])!, points.get(ids[j])!) <= seuil) parent.set(r(ids[j]), r(ids[i]));
    const attendus = new Map<string, string[]>();
    for (const id of ids) attendus.set(r(id), [...(attendus.get(r(id)) ?? []), id]);
    const norm = (g: string[][]) => g.map((x) => x.sort().join(',')).sort();
    expect(norm(groupesProches(points, seuil))).toEqual(norm([...attendus.values()].filter((g) => g.length > 1)));
  });
});
