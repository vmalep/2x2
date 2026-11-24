/**
 * Coordonnées GPS : lecture des points (format Kobo « geopoint » : « lat lon altitude précision »,
 * ou colonnes séparées _xxx_latitude / _xxx_longitude), distances et regroupements.
 * Aucun fond de carte ni service en ligne : tout est calculé localement.
 */
import { langueCourante } from '../i18n/index.ts';

export interface Point {
  lat: number;
  lon: number;
  /** Précision annoncée par l'appareil, en mètres (si connue). */
  precision?: number;
}

const RAYON_TERRE = 6_371_000;

/** Lit « lat lon [altitude] [précision] » ou « lat,lon ». Renvoie undefined si ce n'est pas un point valide. */
export function lirePoint(texte: string | undefined): Point | undefined {
  const t = texte?.trim();
  if (!t) return undefined;
  const parts = t.split(/[\s,;]+/).map(Number);
  if (parts.length < 2 || parts.slice(0, 2).some((n) => !Number.isFinite(n))) return undefined;
  const [lat, lon] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return undefined;
  const precision = parts.length >= 4 && Number.isFinite(parts[3]) && parts[3] > 0 ? parts[3] : undefined;
  return { lat, lon, precision };
}

/** Distance en mètres entre deux points (formule de haversine). */
export function distance(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(Math.round(m / 100) / 10).toLocaleString(langueCourante())} km`;
}

/**
 * Colonne GPS d'un export : la colonne « geopoint » dont Kobo a aussi éclaté les parties
 * (_gps_latitude…), sinon une colonne au nom évocateur.
 */
export function detecterColonneGps(colonnes: string[]): string | undefined {
  const eclatee = colonnes.find((c) => !c.startsWith('_') && colonnes.includes(`_${c}_latitude`) && colonnes.includes(`_${c}_longitude`));
  if (eclatee) return eclatee;
  return colonnes.find((c) => /^(gps|geopoint|coordonnees|coordinates|localisation|location|position|point_gps)$/i.test(c.replace(/^.*\//, '')));
}

/** Point d'un ménage : la colonne geopoint, ou à défaut ses colonnes éclatées (_c_latitude / _c_longitude). */
export function pointDepuis(valeur: (col: string) => string | undefined, colonne: string): Point | undefined {
  const direct = lirePoint(valeur(colonne));
  if (direct) return direct;
  const lat = Number(valeur(`_${colonne}_latitude`));
  const lon = Number(valeur(`_${colonne}_longitude`));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0) || valeur(`_${colonne}_latitude`) === undefined) return undefined;
  const p = Number(valeur(`_${colonne}_precision`));
  return { lat, lon, precision: Number.isFinite(p) && p > 0 ? p : undefined };
}

/**
 * Groupes de points reliés de proche en proche (distance ≤ seuil), calculés par grille
 * pour rester rapides sur plusieurs milliers de ménages.
 */
export function groupesProches(points: Map<string, Point>, seuil: number): string[][] {
  const ids = [...points.keys()];
  const parent = new Map(ids.map((id) => [id, id]));
  const racine = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  // Cases d'au moins « seuil » mètres de côté partout (pas en longitude calculé à la latitude la plus
  // éloignée de l'équateur) : deux points voisins sont toujours dans des cases adjacentes.
  const pasLat = seuil / 110_000;
  const latMax = Math.max(0, ...[...points.values()].map((p) => Math.abs(p.lat)));
  const pasLon = pasLat / Math.max(0.01, Math.cos((Math.min(89, latMax) * Math.PI) / 180));
  const grille = new Map<string, string[]>();
  const cle = (p: Point) => [Math.floor(p.lat / pasLat), Math.floor(p.lon / pasLon)] as const;
  for (const id of ids) {
    const [i, j] = cle(points.get(id)!);
    const k = `${i}:${j}`;
    grille.set(k, [...(grille.get(k) ?? []), id]);
  }
  for (const id of ids) {
    const p = points.get(id)!;
    const [i, j] = cle(p);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const autre of grille.get(`${i + di}:${j + dj}`) ?? []) {
          if (autre <= id) continue;
          if (distance(p, points.get(autre)!) <= seuil) parent.set(racine(autre), racine(id));
        }
      }
    }
  }
  const groupes = new Map<string, string[]>();
  for (const id of ids) groupes.set(racine(id), [...(groupes.get(racine(id)) ?? []), id]);
  return [...groupes.values()].filter((g) => g.length > 1).map((g) => g.sort());
}

/** Centre robuste d'un ensemble de points (médiane des latitudes et des longitudes). */
export function centre(points: Point[]): Point {
  const med = (t: number[]) => {
    const s = [...t].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return { lat: med(points.map((p) => p.lat)), lon: med(points.map((p) => p.lon)) };
}
