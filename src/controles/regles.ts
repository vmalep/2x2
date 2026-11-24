/**
 * Règles de contrôle : ce que l'outil vérifie, décrit comme des DONNÉES (jamais du code).
 *
 * Les règles se lisent et s'écrivent sous forme de tableau (une règle par ligne), pour être
 * éditées dans un tableur puis importées. Chaque jeu de règles importé est signé au journal.
 */
import type { Tableau } from '../io/tableau.ts';
import type { Parametres } from '../model/types.ts';
import { detecterColonneGps } from './geo.ts';
import { detecterColonnes } from './parametres.ts';
import { t, type Cle } from '../i18n/index.ts';

/** Types de règles et nombre de colonnes requises. Libellé et aide : libelleType(), aideType() (traduits). */
export const TYPES_REGLES = {
  duree: { colonnes: 2 },
  ordre_dates: { colonnes: 2 },
  periode: { colonnes: 1 },
  seuil: { colonnes: 1 },
  obligatoire: { colonnes: 1 },
  valeurs: { colonnes: 1 },
  format: { colonnes: 1 },
  doublon: { colonnes: 1 },
  doublon_telephone: { colonnes: 1 },
  noms_proches: { colonnes: 1 },
  part_enqueteur: { colonnes: 1 },
  proximite_gps: { colonnes: 1 },
  gps_groupes: { colonnes: 2 },
  obligatoire_si: { colonnes: 1 },
  lien: { colonnes: 1 },
  lien_requis: { colonnes: 1 },
  gps_hors_zone: { colonnes: 2 },
} as const;

export type TypeRegle = keyof typeof TYPES_REGLES;

export function libelleType(type: TypeRegle): string {
  return t(`regle_type.${type}.libelle` as Cle);
}
export function aideType(type: TypeRegle): string {
  return t(`regle_type.${type}.aide` as Cle);
}

export interface Regle {
  /** Identifiant court et stable ([a-z0-9_]) : il relie les alertes aux décisions du journal. */
  nom: string;
  libelle: string;
  type: TypeRegle;
  colonne: string;
  colonne2: string;
  min: string;
  max: string;
  liste: string;
  actif: boolean;
}

/** En-têtes du fichier de règles, dans l'ordre. */
/** Condition « colonne=valeur » (plusieurs valeurs séparées par « ; »), insensible à la casse. */
export function lireCondition(texte: string): { colonne: string; valeurs: Set<string> } | undefined {
  const i = texte.indexOf('=');
  if (i <= 0) return undefined;
  const colonne = texte.slice(0, i).trim();
  const valeurs = new Set(texte.slice(i + 1).split(';').map((x) => x.trim().toLowerCase()).filter(Boolean));
  return colonne && valeurs.size ? { colonne, valeurs } : undefined;
}

export const COLONNES_FICHIER = ['actif', 'nom', 'libelle', 'type', 'colonne', 'colonne_2', 'min', 'max', 'liste'] as const;

const OUI = /^(oui|o|yes|y|vrai|true|1|x)$/i;
const NON = /^(non|n|no|faux|false|0)$/i;

export function lireNombre(texte: string): number | undefined {
  const t = texte.trim().replace(',', '.').replace(/\s*%$/, '');
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return /%\s*$/.test(texte) ? n / 100 : n;
}

// ---------------------------------------------------------------- Règles par défaut

/** Règles proposées d'après les colonnes de l'export (détection automatique). */
export function reglesParDefaut(colonnes: string[], lignes: string[][] = []): Regle[] {
  const detectees = detecterColonnes(colonnes);
  const regles = reglesDepuisParametres({
    colonnes: detectees,
    seuilDureeMinutes: 6,
    dureeMaxHeures: 3,
    partCourtsEnqueteur: 0.2,
    minEntretiensEnqueteur: 5,
    distanceNoms: 2,
  });
  // Contrôles GPS, si l'export contient des coordonnées.
  const gps = detecterColonneGps(colonnes);
  if (gps) {
    const r = (nom: string, libelle: string, type: TypeRegle, autres: Partial<Regle>): Regle => ({
      nom, libelle, type, colonne: gps, colonne2: '', min: '', max: '', liste: '', actif: true, ...autres,
    });
    regles.push(r('gps_proches', t('regle.gps_proches'), 'proximite_gps', { max: '5' }));
    if (detectees.enqueteur) regles.push(r('gps_groupes', t('regle.gps_groupes'), 'gps_groupes', { colonne2: detectees.enqueteur, min: '5', max: '20' }));
    if (detectees.village) regles.push(r('gps_hors_zone', t('regle.gps_hors_zone'), 'gps_hors_zone', { colonne2: detectees.village, max: '3000' }));
  }
  regles.push(...reglesDeLien(colonnes, lignes, !!gps));
  return regles;
}

/** Colonne qui désigne un autre ménage (ménage hôte, d'accueil…), d'après son nom. */
export function detecterColonneLien(colonnes: string[]): string | undefined {
  return colonnes.find((c) => /(^|_)(hote|host|accueil|hebergeur|hebergeant)(_?id)?$/i.test(c.split('/').pop() ?? c) && /id|code|menage|hh/i.test(c));
}

/** Colonne inverse : codes des ménages rattachés (hébergés), saisis par le ménage de référence. */
export function detecterColonneLienRetour(colonnes: string[]): string | undefined {
  return colonnes.find((c) => /(^|_)(heberges?|accueillis?|hosted)$/i.test(c.split('/').pop() ?? c) && /id|code|menage|hh/i.test(c));
}

/**
 * Règles de lien entre ménages, proposées seulement si l'export contient une colonne de lien.
 * Si une colonne de statut distingue familles d'accueil et ménages hébergés (déplacés), les
 * conditions correspondantes sont ajoutées : un hôte doit héberger au moins un ménage inclus,
 * un ménage hébergé doit désigner son hôte.
 */
function reglesDeLien(colonnes: string[], lignes: string[][], avecGps: boolean): Regle[] {
  const lien = detecterColonneLien(colonnes);
  if (!lien) return [];
  // Valeurs d'un statut « hôte » et « hébergé » dans une colonne de l'export.
  let statut: { colonne: string; hote: string; heberge?: string } | undefined;
  for (const [i, c] of colonnes.entries()) {
    if (c === lien) continue;
    const valeurs = [...new Set(lignes.slice(0, 5000).map((l) => (l[i] ?? '').trim()).filter(Boolean))];
    if (valeurs.length > 20) continue;
    const hote = valeurs.find((x) => /accueil|hote|host/i.test(x));
    if (!hote) continue;
    // Ménage hébergé : « …heberge… » de préférence, sinon « déplacé » ; jamais « non hébergé » ni « sans … ».
    const positif = (x: string) => x !== hote && !/(^|_)(non|sans|pas|no|not)(_|$)/i.test(x);
    const heberge = valeurs.find((x) => positif(x) && /heberg|hosted/i.test(x)) ?? valeurs.find((x) => positif(x) && /deplac|displac|idp|refug/i.test(x));
    statut = { colonne: c, hote, heberge };
    break;
  }
  const retour = detecterColonneLienRetour(colonnes) ?? '';
  const r = (nom: string, libelle: string, type: TypeRegle, autres: Partial<Regle>): Regle => ({
    nom, libelle, type, colonne: lien, colonne2: retour, min: '', max: '', liste: '', actif: true, ...autres,
  });
  const regles = [
    r('lien_hote', t('regle.lien_hote'), 'lien', {
      liste: statut ? `${statut.colonne}=${statut.hote}` : '',
      max: avecGps ? '500' : '',
      min: '5',
    }),
  ];
  if (statut) regles.push(r('hote_sans_heberge', t('regle.hote_sans_heberge'), 'lien_requis', { liste: `${statut.colonne}=${statut.hote}`, min: '1' }));
  // Un ménage hébergé doit avoir un hôte retenu, que le lien ait été saisi par lui ou par son hôte.
  if (statut?.heberge) regles.push(r('heberge_sans_hote', t('regle.heberge_sans_hote'), 'lien_requis', { liste: `${statut.colonne}=${statut.heberge}`, min: '1' }));
  return regles;
}

/** Convertit les anciens paramètres (versions précédentes du prototype) en règles. */
export function reglesDepuisParametres(p: Parametres): Regle[] {
  const c = p.colonnes;
  const r = (nom: string, libelle: string, type: TypeRegle, colonne: string, autres: Partial<Regle> = {}): Regle => ({
    nom,
    libelle,
    type,
    colonne,
    colonne2: '',
    min: '',
    max: '',
    liste: '',
    actif: true,
    ...autres,
  });
  const regles: Regle[] = [];
  if (c.debut && c.fin) {
    regles.push(r('duree_courte', t('regle.duree_courte'), 'duree', c.debut, { colonne2: c.fin, min: String(p.seuilDureeMinutes) }));
    regles.push(r('duree_longue', t('regle.duree_longue'), 'duree', c.debut, { colonne2: c.fin, max: String(p.dureeMaxHeures * 60) }));
    regles.push(r('fin_avant_debut', t('regle.fin_avant_debut'), 'ordre_dates', c.debut, { colonne2: c.fin }));
    if (c.soumission) regles.push(r('soumission_avant_fin', t('regle.soumission_avant_fin'), 'ordre_dates', c.fin, { colonne2: c.soumission }));
    if (c.enqueteur) {
      regles.push(r('enqueteur_atypique', t('regle.enqueteur_atypique'), 'part_enqueteur', c.enqueteur, { min: String(p.partCourtsEnqueteur), liste: 'duree_courte' }));
    }
  }
  if (c.telephone) regles.push(r('doublon_telephone', t('regle.doublon_telephone'), 'doublon_telephone', c.telephone));
  if (c.identifiant) regles.push(r('doublon_identifiant', t('regle.doublon_identifiant'), 'doublon', c.identifiant));
  if (c.nom) regles.push(r('doublon_nom', t('regle.doublon_nom'), 'noms_proches', c.nom, { colonne2: c.village ?? '', max: String(p.distanceNoms) }));
  return regles;
}

// ---------------------------------------------------------------- Validation

/** Vérifie un jeu de règles contre les colonnes de la liste. Renvoie la liste des erreurs (vide si tout va bien). */
export function validerRegles(regles: Regle[], colonnes: string[]): string[] {
  const erreurs: string[] = [];
  const noms = new Set<string>();
  regles.forEach((r, i) => {
    const ou = r.nom ? t('regles.err_ou_nom', { n: i + 1, nom: r.nom }) : t('regles.err_ou', { n: i + 1 });
    if (!/^[a-z0-9_]{1,40}$/.test(r.nom)) erreurs.push(t('regles.err_nom', { ou }));
    else if (noms.has(r.nom)) erreurs.push(t('regles.err_nom_utilise', { ou }));
    noms.add(r.nom);
    if (!(r.type in TYPES_REGLES)) {
      erreurs.push(t('regles.err_type', { ou, type: r.type, types: Object.keys(TYPES_REGLES).join(', ') }));
      return;
    }
    if (!r.libelle.trim()) erreurs.push(t('regles.err_libelle', { ou }));
    if (!r.colonne) erreurs.push(t('regles.err_colonne', { ou }));
    else if (!colonnes.includes(r.colonne)) erreurs.push(t('regles.err_colonne_inconnue', { ou, colonne: r.colonne }));
    if (TYPES_REGLES[r.type].colonnes === 2 && !r.colonne2) erreurs.push(t('regles.err_colonne2', { ou }));
    if (r.colonne2 && !colonnes.includes(r.colonne2)) erreurs.push(t('regles.err_colonne_inconnue', { ou, colonne: r.colonne2 }));
    for (const [champ, valeur] of [['min', r.min], ['max', r.max]] as const) {
      if (!valeur.trim()) continue;
      if (r.type === 'periode') {
        if (!/^\d{4}-\d{2}-\d{2}/.test(valeur.trim()) || Number.isNaN(Date.parse(valeur.trim()))) erreurs.push(t('regles.err_date', { ou, champ }));
      } else if (lireNombre(valeur) === undefined) erreurs.push(t('regles.err_nombre', { ou, champ }));
    }
    const aMinOuMax = r.min.trim() !== '' || r.max.trim() !== '';
    if ((r.type === 'duree' || r.type === 'seuil' || r.type === 'periode') && !aMinOuMax) erreurs.push(t('regles.err_min_max', { ou }));
    if (r.type === 'part_enqueteur') {
      const part = lireNombre(r.min);
      if (part === undefined || part <= 0 || part > 1) erreurs.push(t('regles.err_part', { ou }));
      if (!regles.some((x) => x.nom === r.liste && x.nom !== r.nom)) erreurs.push(t('regles.err_liste_regle', { ou }));
    }
    if (r.type === 'noms_proches') {
      const d = lireNombre(r.max);
      if (d === undefined || d < 0 || d > 5 || !Number.isInteger(d)) erreurs.push(t('regles.err_max_noms', { ou }));
    }
    if (r.type === 'proximite_gps' || r.type === 'gps_groupes' || r.type === 'gps_hors_zone') {
      const d = lireNombre(r.max);
      if (d === undefined || d <= 0) erreurs.push(t('regles.err_max_distance', { ou }));
    }
    if (r.type === 'gps_groupes') {
      const n = lireNombre(r.min);
      if (n === undefined || n < 2 || !Number.isInteger(n)) erreurs.push(t('regles.err_min_menages', { ou }));
    }
    if (r.type === 'obligatoire_si' || r.type === 'lien_requis' || (r.type === 'lien' && r.liste.trim())) {
      const c = lireCondition(r.liste);
      if (!c) erreurs.push(t('regles.err_condition', { ou }));
      else if (!colonnes.includes(c.colonne)) erreurs.push(t('regles.err_condition_colonne', { ou, colonne: c.colonne }));
    }
    if (r.type === 'lien' || r.type === 'lien_requis') {
      for (const [champ, valeur] of [['min', r.min], ['max', r.max]] as const) {
        const n = lireNombre(valeur);
        if (valeur.trim() && (n === undefined || n <= 0)) erreurs.push(t('regles.err_positif', { ou, champ }));
      }
    }
    if (r.type === 'valeurs' && !r.liste.trim()) erreurs.push(t('regles.err_valeurs', { ou }));
    if (r.type === 'format') {
      if (!r.liste.trim() || r.liste.length > 200) erreurs.push(t('regles.err_motif', { ou }));
      else {
        try {
          new RegExp(r.liste);
        } catch {
          erreurs.push(t('regles.err_motif_invalide', { ou }));
        }
      }
    }
  });
  return erreurs;
}

// ---------------------------------------------------------------- Fichier (tableau)

export function tableauDepuisRegles(regles: Regle[]): Tableau {
  return {
    colonnes: [...COLONNES_FICHIER],
    lignes: regles.map((r) => [r.actif ? 'oui' : 'non', r.nom, r.libelle, r.type, r.colonne, r.colonne2, r.min, r.max, r.liste]),
  };
}

/** Lit un tableau de règles (première feuille d'un XLSX/ODS, ou CSV). En-têtes insensibles à la casse et aux accents. */
export function reglesDepuisTableau(tab: Tableau): { regles: Regle[]; erreurs: string[] } {
  const normaliser = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
  const index = new Map(tab.colonnes.map((c, i) => [normaliser(c), i]));
  const manquantes = ['nom', 'type', 'colonne'].filter((c) => !index.has(c));
  if (manquantes.length) return { regles: [], erreurs: [t('regles.err_entetes', { colonnes: manquantes.join(', ') })] };
  const lire = (l: string[], c: string) => (index.has(c) ? (l[index.get(c)!] ?? '').trim() : '');
  const erreurs: string[] = [];
  const regles = tab.lignes
    .filter((l) => lire(l, 'nom') || lire(l, 'type'))
    .map((l, i) => {
      const actif = lire(l, 'actif');
      if (actif && !OUI.test(actif) && !NON.test(actif)) erreurs.push(t('regles.err_actif', { n: i + 1 }));
      return {
        nom: lire(l, 'nom'),
        libelle: lire(l, 'libelle') || lire(l, 'nom'),
        type: lire(l, 'type').toLowerCase() as TypeRegle,
        colonne: lire(l, 'colonne'),
        colonne2: lire(l, 'colonne_2') || lire(l, 'colonne2'),
        min: lire(l, 'min'),
        max: lire(l, 'max'),
        liste: lire(l, 'liste'),
        actif: !NON.test(actif),
      };
    });
  return { regles, erreurs };
}

/** Feuille d'aide jointe au fichier de règles exporté : types et colonnes disponibles. */
export function tableauAide(colonnesListe: string[]): Tableau {
  return {
    colonnes: ['Type', 'Description', 'Utilisation'],
    lignes: [
      ...(Object.keys(TYPES_REGLES) as TypeRegle[]).map((type) => [type, libelleType(type), aideType(type)]),
      ['', '', ''],
      ['actif', 'oui / non', 'Une règle à « non » reste dans le fichier mais n’est pas appliquée.'],
      ['nom', 'Identifiant', 'Minuscules, chiffres et « _ ». Ne le changez pas si des décisions ont déjà été prises : elles y sont rattachées.'],
      ['', '', ''],
      ['Colonnes de la liste', '', colonnesListe.join(' ; ')],
    ],
  };
}
