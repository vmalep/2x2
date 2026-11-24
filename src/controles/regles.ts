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

export const TYPES_REGLES = {
  duree: {
    libelle: 'Durée entre deux dates',
    aide: 'colonne = début, colonne_2 = fin. Signale une durée (en minutes) inférieure à min ou supérieure à max. Les durées négatives sont ignorées (voir ordre_dates).',
    colonnes: 2,
  },
  ordre_dates: {
    libelle: 'Ordre de deux dates',
    aide: 'Signale quand la date de « colonne » est postérieure à celle de « colonne_2 » (ex. fin avant le début, soumission avant la fin).',
    colonnes: 2,
  },
  periode: {
    libelle: 'Date hors période',
    aide: 'Signale une date de « colonne » antérieure à min ou postérieure à max (dates AAAA-MM-JJ).',
    colonnes: 1,
  },
  seuil: {
    libelle: 'Nombre hors limites',
    aide: 'Signale une valeur numérique de « colonne » inférieure à min ou supérieure à max, ou une valeur qui n’est pas un nombre.',
    colonnes: 1,
  },
  obligatoire: {
    libelle: 'Valeur obligatoire',
    aide: 'Signale une cellule vide dans « colonne ».',
    colonnes: 1,
  },
  valeurs: {
    libelle: 'Valeur hors liste',
    aide: 'Signale une valeur de « colonne » absente de « liste » (valeurs séparées par des points-virgules). Les cellules vides sont ignorées.',
    colonnes: 1,
  },
  format: {
    libelle: 'Format inattendu',
    aide: 'Signale une valeur de « colonne » qui ne respecte pas le motif de « liste » (expression régulière, ex. ^\\+243[0-9]{9}$). Les cellules vides sont ignorées.',
    colonnes: 1,
  },
  doublon: {
    libelle: 'Valeur en double',
    aide: 'Signale les ménages qui partagent la même valeur de « colonne » (et de « colonne_2 » si elle est renseignée). Casse, espaces et ponctuation ignorés.',
    colonnes: 1,
  },
  doublon_telephone: {
    libelle: 'Téléphone en double',
    aide: 'Comme doublon, en comparant les 9 derniers chiffres du numéro (+243 81… et 081… sont reconnus).',
    colonnes: 1,
  },
  noms_proches: {
    libelle: 'Noms proches dans un même groupe',
    aide: 'colonne = nom, colonne_2 = groupe (ex. village, facultatif). Signale les noms qui diffèrent d’au plus « max » lettres (2 conseillé), ordre des mots et accents ignorés.',
    colonnes: 1,
  },
  part_enqueteur: {
    libelle: 'Enquêteur atypique',
    aide: 'colonne = enquêteur, liste = nom d’une autre règle. Signale l’enquêteur dont la part de ménages signalés par cette règle atteint min (0,2 = 20 %), sur au moins 5 entretiens.',
    colonnes: 1,
  },
  proximite_gps: {
    libelle: 'Ménages trop proches (GPS)',
    aide: 'colonne = point GPS (format Kobo « lat lon altitude précision »). Signale les ménages situés à moins de « max » mètres les uns des autres (5 conseillé) : même ménage enregistré deux fois ?',
    colonnes: 1,
  },
  gps_groupes: {
    libelle: 'Entretiens groupés au même endroit',
    aide: 'colonne = point GPS, colonne_2 = enquêteur. Signale un enquêteur qui a enregistré au moins « min » ménages (5 conseillé) dans un rayon de « max » mètres (20 conseillé) : signe possible de questionnaires remplis sans visite.',
    colonnes: 2,
  },
  obligatoire_si: {
    libelle: 'Valeur obligatoire sous condition',
    aide: 'Signale une cellule vide dans « colonne » pour les ménages qui remplissent la condition de « liste », écrite colonne=valeur (plusieurs valeurs séparées par « ; »). Ex. : colonne = id_menage_hote, liste = statut_menage=deplace.',
    colonnes: 1,
  },
  lien: {
    libelle: 'Lien vers un autre ménage',
    aide: 'colonne = code du ménage de référence saisi par le ménage rattaché (ex. id_menage_hote) ; colonne_2 (facultative) = codes des ménages rattachés saisis par le ménage de référence, séparés par des espaces (ex. ids_menages_heberges). Le lien compte dès qu’il est saisi d’un côté. Signale : code introuvable, ménage qui se désigne lui-même, ménage rattaché à plusieurs ménages de référence, ménage de référence exclu ou qui ne remplit pas la condition de « liste » (colonne=valeur, facultatif), ménages distants de plus de « max » mètres (GPS, facultatif), plus de « min » ménages rattachés au même ménage (facultatif).',
    colonnes: 1,
  },
  lien_requis: {
    libelle: 'Ménage sans ménage rattaché',
    aide: 'colonne et colonne_2 : comme pour « lien ». Signale un ménage qui remplit la condition de « liste » (colonne=valeur) mais qui est lié, dans un sens ou dans l’autre, à moins de « min » ménages INCLUS (1 par défaut). Ex. : statut_menage=famille_accueil (une famille d’accueil doit héberger au moins un ménage retenu), ou statut_menage=deplace_heberge (un ménage hébergé doit avoir un hôte retenu).',
    colonnes: 1,
  },
  gps_hors_zone: {
    libelle: 'Point éloigné de son groupe (GPS)',
    aide: 'colonne = point GPS, colonne_2 = groupe (ex. village). Signale un ménage situé à plus de « max » mètres (3000 conseillé) du centre des ménages de son groupe (au moins 3 points).',
    colonnes: 2,
  },
} as const;

export type TypeRegle = keyof typeof TYPES_REGLES;

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
    regles.push(r('gps_proches', 'Ménages trop proches (GPS)', 'proximite_gps', { max: '5' }));
    if (detectees.enqueteur) regles.push(r('gps_groupes', 'Entretiens groupés au même endroit', 'gps_groupes', { colonne2: detectees.enqueteur, min: '5', max: '20' }));
    if (detectees.village) regles.push(r('gps_hors_zone', 'Point éloigné de son village', 'gps_hors_zone', { colonne2: detectees.village, max: '3000' }));
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
    r('lien_hote', 'Lien vers le ménage hôte invalide', 'lien', {
      liste: statut ? `${statut.colonne}=${statut.hote}` : '',
      max: avecGps ? '500' : '',
      min: '5',
    }),
  ];
  if (statut) regles.push(r('hote_sans_heberge', 'Ménage hôte sans ménage hébergé retenu', 'lien_requis', { liste: `${statut.colonne}=${statut.hote}`, min: '1' }));
  // Un ménage hébergé doit avoir un hôte retenu, que le lien ait été saisi par lui ou par son hôte.
  if (statut?.heberge) regles.push(r('heberge_sans_hote', 'Ménage hébergé sans ménage hôte', 'lien_requis', { liste: `${statut.colonne}=${statut.heberge}`, min: '1' }));
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
    regles.push(r('duree_courte', 'Entretien anormalement court', 'duree', c.debut, { colonne2: c.fin, min: String(p.seuilDureeMinutes) }));
    regles.push(r('duree_longue', 'Entretien anormalement long', 'duree', c.debut, { colonne2: c.fin, max: String(p.dureeMaxHeures * 60) }));
    regles.push(r('fin_avant_debut', 'Fin de l’entretien avant son début', 'ordre_dates', c.debut, { colonne2: c.fin }));
    if (c.soumission) regles.push(r('soumission_avant_fin', 'Soumission avant la fin de l’entretien', 'ordre_dates', c.fin, { colonne2: c.soumission }));
    if (c.enqueteur) {
      regles.push(r('enqueteur_atypique', 'Enquêteur atypique (entretiens courts)', 'part_enqueteur', c.enqueteur, { min: String(p.partCourtsEnqueteur), liste: 'duree_courte' }));
    }
  }
  if (c.telephone) regles.push(r('doublon_telephone', 'Téléphone en double', 'doublon_telephone', c.telephone));
  if (c.identifiant) regles.push(r('doublon_identifiant', 'Pièce d’identité en double', 'doublon', c.identifiant));
  if (c.nom) regles.push(r('doublon_nom', 'Noms proches dans un même village', 'noms_proches', c.nom, { colonne2: c.village ?? '', max: String(p.distanceNoms) }));
  return regles;
}

// ---------------------------------------------------------------- Validation

/** Vérifie un jeu de règles contre les colonnes de la liste. Renvoie la liste des erreurs (vide si tout va bien). */
export function validerRegles(regles: Regle[], colonnes: string[]): string[] {
  const erreurs: string[] = [];
  const noms = new Set<string>();
  regles.forEach((r, i) => {
    const ou = `Règle ${i + 1}${r.nom ? ` (« ${r.nom} »)` : ''}`;
    if (!/^[a-z0-9_]{1,40}$/.test(r.nom)) erreurs.push(`${ou} : le nom doit être en minuscules, chiffres ou « _ » (40 caractères au plus).`);
    else if (noms.has(r.nom)) erreurs.push(`${ou} : nom déjà utilisé par une autre règle.`);
    noms.add(r.nom);
    if (!(r.type in TYPES_REGLES)) {
      erreurs.push(`${ou} : type inconnu « ${r.type} ». Types possibles : ${Object.keys(TYPES_REGLES).join(', ')}.`);
      return;
    }
    if (!r.libelle.trim()) erreurs.push(`${ou} : libellé manquant.`);
    if (!r.colonne) erreurs.push(`${ou} : « colonne » manquante.`);
    else if (!colonnes.includes(r.colonne)) erreurs.push(`${ou} : colonne inconnue « ${r.colonne} ».`);
    if (TYPES_REGLES[r.type].colonnes === 2 && !r.colonne2) erreurs.push(`${ou} : « colonne_2 » est obligatoire pour ce type.`);
    if (r.colonne2 && !colonnes.includes(r.colonne2)) erreurs.push(`${ou} : colonne inconnue « ${r.colonne2} ».`);
    for (const [champ, valeur] of [['min', r.min], ['max', r.max]] as const) {
      if (!valeur.trim()) continue;
      if (r.type === 'periode') {
        if (!/^\d{4}-\d{2}-\d{2}/.test(valeur.trim()) || Number.isNaN(Date.parse(valeur.trim()))) erreurs.push(`${ou} : « ${champ} » doit être une date AAAA-MM-JJ.`);
      } else if (lireNombre(valeur) === undefined) erreurs.push(`${ou} : « ${champ} » doit être un nombre.`);
    }
    const aMinOuMax = r.min.trim() !== '' || r.max.trim() !== '';
    if ((r.type === 'duree' || r.type === 'seuil' || r.type === 'periode') && !aMinOuMax) erreurs.push(`${ou} : renseignez min, max ou les deux.`);
    if (r.type === 'part_enqueteur') {
      const part = lireNombre(r.min);
      if (part === undefined || part <= 0 || part > 1) erreurs.push(`${ou} : « min » doit être une part entre 0 et 1 (ex. 0,2).`);
      if (!regles.some((x) => x.nom === r.liste && x.nom !== r.nom)) erreurs.push(`${ou} : « liste » doit contenir le nom d’une autre règle.`);
    }
    if (r.type === 'noms_proches') {
      const d = lireNombre(r.max);
      if (d === undefined || d < 0 || d > 5 || !Number.isInteger(d)) erreurs.push(`${ou} : « max » doit être un nombre entier de 0 à 5.`);
    }
    if (r.type === 'proximite_gps' || r.type === 'gps_groupes' || r.type === 'gps_hors_zone') {
      const d = lireNombre(r.max);
      if (d === undefined || d <= 0) erreurs.push(`${ou} : « max » doit être une distance en mètres, supérieure à 0.`);
    }
    if (r.type === 'gps_groupes') {
      const n = lireNombre(r.min);
      if (n === undefined || n < 2 || !Number.isInteger(n)) erreurs.push(`${ou} : « min » doit être un nombre entier de ménages, au moins 2.`);
    }
    if (r.type === 'obligatoire_si' || r.type === 'lien_requis' || (r.type === 'lien' && r.liste.trim())) {
      const c = lireCondition(r.liste);
      if (!c) erreurs.push(`${ou} : « liste » doit contenir une condition colonne=valeur (ex. statut_menage=famille_accueil).`);
      else if (!colonnes.includes(c.colonne)) erreurs.push(`${ou} : colonne inconnue « ${c.colonne} » dans la condition.`);
    }
    if (r.type === 'lien' || r.type === 'lien_requis') {
      for (const [champ, valeur] of [['min', r.min], ['max', r.max]] as const) {
        const n = lireNombre(valeur);
        if (valeur.trim() && (n === undefined || n <= 0)) erreurs.push(`${ou} : « ${champ} » doit être un nombre supérieur à 0.`);
      }
    }
    if (r.type === 'valeurs' && !r.liste.trim()) erreurs.push(`${ou} : « liste » doit contenir les valeurs admises, séparées par « ; ».`);
    if (r.type === 'format') {
      if (!r.liste.trim() || r.liste.length > 200) erreurs.push(`${ou} : « liste » doit contenir un motif (200 caractères au plus).`);
      else {
        try {
          new RegExp(r.liste);
        } catch {
          erreurs.push(`${ou} : motif invalide dans « liste ».`);
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
export function reglesDepuisTableau(t: Tableau): { regles: Regle[]; erreurs: string[] } {
  const normaliser = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
  const index = new Map(t.colonnes.map((c, i) => [normaliser(c), i]));
  const manquantes = ['nom', 'type', 'colonne'].filter((c) => !index.has(c));
  if (manquantes.length) return { regles: [], erreurs: [`Colonne(s) manquante(s) dans le fichier de règles : ${manquantes.join(', ')}.`] };
  const lire = (l: string[], c: string) => (index.has(c) ? (l[index.get(c)!] ?? '').trim() : '');
  const erreurs: string[] = [];
  const regles = t.lignes
    .filter((l) => lire(l, 'nom') || lire(l, 'type'))
    .map((l, i) => {
      const actif = lire(l, 'actif');
      if (actif && !OUI.test(actif) && !NON.test(actif)) erreurs.push(`Règle ${i + 1} : « actif » doit valoir oui ou non.`);
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
      ...Object.entries(TYPES_REGLES).map(([type, t]) => [type, t.libelle, t.aide]),
      ['', '', ''],
      ['actif', 'oui / non', 'Une règle à « non » reste dans le fichier mais n’est pas appliquée.'],
      ['nom', 'Identifiant', 'Minuscules, chiffres et « _ ». Ne le changez pas si des décisions ont déjà été prises : elles y sont rattachées.'],
      ['', '', ''],
      ['Colonnes de la liste', '', colonnesListe.join(' ; ')],
    ],
  };
}
