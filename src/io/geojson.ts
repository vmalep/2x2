/**
 * Fond de carte vectoriel : lecture de fichiers GeoJSON (par exemple un export du HOT Export Tool,
 * données OpenStreetMap) et tri des éléments utiles pour se repérer : routes et pistes, rivières,
 * plans d'eau, forêts, bâtiments, limites administratives et noms de lieux. Le reste est ignoré.
 * Les coordonnées sont converties une fois pour toutes en projection Web Mercator normalisée (0..1).
 */
import { t } from '../i18n/index.ts';

export type ClasseFond =
  | 'eau'
  | 'foret'
  | 'batiment'
  | 'limite'
  | 'riviere'
  | 'ruisseau'
  | 'route-principale'
  | 'route'
  | 'piste'
  | 'lieu';

export interface ElementFond {
  classe: ClasseFond;
  /** Surfaces : anneaux ; lignes : tronçons ; lieux : un seul point. En coordonnées Mercator normalisées. */
  parties: [number, number][][];
  surface: boolean;
  nom?: string;
}

export interface FondVectoriel {
  elements: ElementFond[];
  /** Emprise en Mercator normalisé : [xmin, ymin, xmax, ymax]. */
  emprise: [number, number, number, number];
  /** Mention de la source, si les données viennent d'OpenStreetMap. */
  attribution?: string;
}

export const versX = (lon: number) => (lon + 180) / 360;
export const versY = (lat: number) => {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

type Proprietes = Record<string, unknown>;
const v = (p: Proprietes, k: string) => {
  const x = p[k];
  return x === null || x === undefined || x === '' || x === 'no' ? '' : String(x);
};

function classer(p: Proprietes, geometrie: string): ClasseFond | undefined {
  const surface = /Polygon/.test(geometrie);
  const ligne = /LineString/.test(geometrie);
  const point = geometrie === 'Point';
  if (point) return v(p, 'place') && v(p, 'name') ? 'lieu' : undefined;
  if (surface) {
    if (v(p, 'natural') === 'water' || v(p, 'water') || v(p, 'waterway') === 'riverbank' || /^(reservoir|basin)$/.test(v(p, 'landuse'))) return 'eau';
    if (v(p, 'natural') === 'wood' || v(p, 'landuse') === 'forest') return 'foret';
    if (v(p, 'building')) return 'batiment';
    if (v(p, 'boundary') === 'administrative') return 'limite';
    return undefined;
  }
  if (ligne) {
    const w = v(p, 'waterway');
    if (/^(river|canal)$/.test(w)) return 'riviere';
    if (w) return 'ruisseau';
    const h = v(p, 'highway');
    if (/^(motorway|trunk|primary|secondary)(_link)?$/.test(h)) return 'route-principale';
    if (/^(tertiary|tertiary_link|unclassified|residential|road|living_street|service)$/.test(h)) return 'route';
    if (/^(track|path|footway|bridleway)$/.test(h)) return 'piste';
    if (v(p, 'boundary') === 'administrative') return 'limite';
  }
  return undefined;
}

const projeter = (c: number[]): [number, number] => [versX(c[0]), versY(c[1])];

/** Lit un ou plusieurs textes GeoJSON. Lève une erreur claire si rien d'utilisable n'y est trouvé. */
export function lireFondVectoriel(fichiers: { nom: string; texte: string }[]): FondVectoriel {
  const elements: ElementFond[] = [];
  let osm = false;
  for (const f of fichiers) {
    let d: { type?: string; features?: { geometry?: { type: string; coordinates: unknown }; properties?: Proprietes }[] };
    try {
      d = JSON.parse(f.texte);
    } catch {
      continue;
    }
    if (d?.type !== 'FeatureCollection' || !Array.isArray(d.features)) continue;
    for (const ft of d.features) {
      const g = ft.geometry;
      const p = ft.properties ?? {};
      if (!g) continue;
      if ('osm_id' in p || 'osm_type' in p) osm = true;
      const classe = classer(p, g.type);
      if (!classe) continue;
      const c = g.coordinates as number[] | number[][] | number[][][] | number[][][][];
      let parties: [number, number][][] = [];
      switch (g.type) {
        case 'Point':
          parties = [[projeter(c as number[])]];
          break;
        case 'LineString':
          parties = [(c as number[][]).map(projeter)];
          break;
        case 'MultiLineString':
        case 'Polygon':
          parties = (c as number[][][]).map((l) => l.map(projeter));
          break;
        case 'MultiPolygon':
          parties = (c as number[][][][]).flat().map((l) => l.map(projeter));
          break;
        default:
          continue;
      }
      elements.push({ classe, parties, surface: /Polygon/.test(g.type) && classe !== 'limite', nom: v(p, 'name') || undefined });
    }
  }
  if (!elements.length) {
    throw new Error(t('err.geojson'));
  }
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const e of elements) {
    for (const partie of e.parties) {
      for (const [x, y] of partie) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return { elements, emprise: [x0, y0, x1, y1], attribution: osm ? t('fond.attribution') : undefined };
}

/**
 * Zone pour préparer un fond de carte (à importer dans le HOT Export Tool) : l'emprise des points,
 * élargie et arrondie vers l'extérieur au pas donné (0,1° ≈ 11 km), pour ne révéler que la région.
 */
export function zoneArrondie(points: { lat: number; lon: number }[], marge = 0.05, pas = 0.1): { ouest: number; sud: number; est: number; nord: number } {
  if (!points.length) throw new Error(t('err.aucun_point'));
  const arrondi = (x: number, haut: boolean) => Number(((haut ? Math.ceil(x / pas) : Math.floor(x / pas)) * pas).toFixed(6));
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    ouest: arrondi(Math.min(...lons) - marge, false),
    sud: arrondi(Math.min(...lats) - marge, false),
    est: arrondi(Math.max(...lons) + marge, true),
    nord: arrondi(Math.max(...lats) + marge, true),
  };
}

export function zoneEnGeoJson(z: { ouest: number; sud: number; est: number; nord: number }): string {
  const { ouest: o, sud: s, est: e, nord: n } = z;
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { nom: 'Zone pour un fond de carte (2x2)' }, geometry: { type: 'Polygon', coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]] } }],
    },
    null,
    1,
  );
}
