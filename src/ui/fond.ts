/**
 * Fond de carte hors ligne, chargé depuis le disque (aucune connexion) et gardé le temps de la séance :
 * - vectoriel : un fichier GeoJSON, ou un ZIP qui en contient (export du HOT Export Tool, données
 *   OpenStreetMap). 2x2 dessine lui-même routes, rivières, plans d'eau et noms de lieux ;
 * - images : un ZIP de tuiles z/x/y.png (par exemple produit par QGIS), utile pour l'imagerie satellite.
 */
import { lireFondVectoriel, type FondVectoriel } from '../io/geojson.ts';
import { indexerZip } from '../io/zip.ts';
import { t } from '../i18n/index.ts';

export interface FondCarte {
  nom: string;
  /** Niveaux de zoom présents dans le paquet. */
  zooms: number[];
  nombre: number;
  /** URL (blob:) d'une tuile, si elle existe ; lue dans l'archive à la première demande. */
  tuile(z: number, x: number, y: number): Promise<string | undefined>;
  /** Vrai si la tuile existe dans le paquet (sans la lire). */
  existe(z: number, x: number, y: number): boolean;
  /** Fond vectoriel (GeoJSON) : éléments à dessiner. Absent pour un paquet de tuiles. */
  vecteur?: FondVectoriel;
  /** Mention de la source à afficher sur le plan (licence). */
  attribution?: string;
}

let fond: FondCarte | undefined;
/** Libère les images de l'ancien fond (URL blob:). */
let liberer = () => {};
const abonnes = new Set<() => void>();

export function fondCarte(): FondCarte | undefined {
  return fond;
}

/** Prévient quand le fond change (chargé ou retiré). */
export function surChangementFond(f: () => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export async function chargerFond(nom: string, octets: Uint8Array<ArrayBuffer>): Promise<FondCarte> {
  const estZip = octets[0] === 0x50 && octets[1] === 0x4b;
  if (!estZip) return installer(fondVectoriel(nom, lireFondVectoriel([{ nom, texte: new TextDecoder().decode(octets) }])));
  const index = indexerZip(octets);
  // ZIP de GeoJSON (export HOT) : on lit les .geojson / .json qu'il contient.
  const geojson = [...index.keys()].filter((c) => /\.(geo)?json$/i.test(c));
  const avecTuiles = [...index.keys()].some((c) => /(?:^|\/)\d{1,2}\/\d+\/\d+\.(png|jpe?g|webp)$/i.test(c));
  if (geojson.length && !avecTuiles) {
    const textes = await Promise.all(geojson.map(async (c) => ({ nom: c, texte: new TextDecoder().decode(await index.get(c)!()) })));
    return installer(fondVectoriel(nom, lireFondVectoriel(textes)));
  }
  const tuiles = new Map<string, { lire: () => Promise<Uint8Array>; type: string }>();
  const zooms = new Set<number>();
  for (const [chemin, lire] of index) {
    const m = chemin.match(/(?:^|\/)(\d{1,2})\/(\d+)\/(\d+)\.(png|jpe?g|webp)$/i);
    if (!m) continue;
    const z = Number(m[1]);
    tuiles.set(`${z}/${m[2]}/${m[3]}`, { lire, type: TYPES[m[4].toLowerCase()] });
    zooms.add(z);
  }
  if (!tuiles.size) throw new Error(t('fond.aucune_tuile'));
  const urls = new Map<string, Promise<string | undefined>>();
  // Tuiles au format XYZ (le plus courant) ; à défaut, schéma TMS (axe Y inversé).
  const cle = (z: number, x: number, y: number) => {
    const xyz = `${z}/${x}/${y}`;
    if (tuiles.has(xyz)) return xyz;
    const tms = `${z}/${x}/${2 ** z - 1 - y}`;
    return tuiles.has(tms) ? tms : undefined;
  };
  if (fond) liberer();
  const f: FondCarte = {
    nom,
    zooms: [...zooms].sort((a, b) => a - b),
    nombre: tuiles.size,
    existe: (z, x, y) => cle(z, x, y) !== undefined,
    tuile(z, x, y) {
      const k = cle(z, x, y);
      if (!k) return Promise.resolve(undefined);
      let u = urls.get(k);
      if (!u) {
        const t = tuiles.get(k)!;
        u = t.lire().then((o) => URL.createObjectURL(new Blob([o as Uint8Array<ArrayBuffer>], { type: t.type })));
        urls.set(k, u);
      }
      return u;
    },
  };
  installer(f);
  liberer = () => {
    for (const u of urls.values()) void u.then((x) => x && URL.revokeObjectURL(x));
    urls.clear();
  };
  return f;
}

function fondVectoriel(nom: string, vecteur: FondVectoriel): FondCarte {
  return {
    nom,
    zooms: [],
    nombre: vecteur.elements.length,
    existe: () => false,
    tuile: () => Promise.resolve(undefined),
    vecteur,
    attribution: vecteur.attribution,
  };
}

function installer(f: FondCarte): FondCarte {
  if (fond) liberer();
  liberer = () => {};
  fond = f;
  abonnes.forEach((x) => x());
  return f;
}

export function retirerFond() {
  liberer();
  fond = undefined;
  abonnes.forEach((f) => f());
}
