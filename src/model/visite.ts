/**
 * Listes pour le terrain : liste de visite (tableur) et fichier de préchargement d'un formulaire
 * Kobo de revisite. Ces fichiers font sortir des données personnelles en clair : on n'y met que
 * les ménages et les colonnes choisis, et chaque sortie est inscrite au journal (qui, quoi, quand).
 */
import type { IdentiteDeverrouillee } from '../crypto/cles.ts';
import type { Octets } from '../crypto/encodage.ts';
import { sha256Hex } from '../crypto/empreinte.ts';
import { detecterColonnes } from '../controles/parametres.ts';
import { ecrireCsv } from '../io/csv.ts';
import { ecrireOds } from '../io/ods.ts';
import type { Tableau } from '../io/tableau.ts';
import { ecrireXlsx, type FeuilleXlsx } from '../io/xlsx.ts';
import { LARGEURS_META, tableauMetadonnees, type FichierExporte, type FormatExport } from './export.ts';
import { journaliserExport, type Etat } from './journal.ts';
import type { Liste } from './types.ts';
import { langueCourante, t, tl, type Langue } from '../i18n/index.ts';

/** Colonnes laissées vides, à remplir par l'équipe de terrain (dans la langue de l'utilisateur). */
const CLES_RETOUR = ['visite.retour_date', 'visite.retour_trouve', 'visite.retour_constat', 'visite.retour_champ', 'visite.retour_valeur', 'visite.retour_visiteur'] as const;
export const colonnesRetour = (l: Langue = langueCourante()): string[] => CLES_RETOUR.map((c) => tl(l, c));
/** Colonne « À vérifier » (alertes du ménage). */
export const colonneAVerifier = (l: Langue = langueCourante()): string => tl(l, 'visite.retour_a_verifier');

/** Nom conseillé pour la pièce jointe du formulaire Kobo (référencé par le formulaire). */
export const NOM_PRECHARGEMENT = 'menages_a_revoir.csv';

export interface DemandeVisite {
  ids: string[];
  /** Colonnes de l'export d'origine à faire figurer (données personnelles comprises). */
  colonnes: string[];
  /** Ce qu'il faut vérifier, par ménage (alertes en clair). */
  aVerifier: Map<string, string>;
  /** Préchargement Kobo : colonnes affichées après l'identifiant dans la liste de choix (ex. nom, village). */
  etiquette?: string[];
}

function base(liste: Liste): string {
  return liste.original.nomFichier.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_');
}

export function tableauVisite(etat: Etat, d: DemandeVisite): Tableau {
  return {
    colonnes: [etat.original.colonneId, ...d.colonnes.filter((c) => c !== etat.original.colonneId), colonneAVerifier(), ...colonnesRetour()],
    lignes: d.ids.map((id) => [
      id,
      ...d.colonnes.filter((c) => c !== etat.original.colonneId).map((c) => etat.valeur(id, c) ?? ''),
      d.aVerifier.get(id) ?? '',
      ...colonnesRetour().map(() => ''),
    ]),
  };
}

/** Nom de colonne utilisable dans un formulaire Kobo (minuscules, sans accent ni espace). */
export function nomKobo(colonne: string): string {
  const n = colonne
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z_]/.test(n) ? n : `c_${n}`;
}

/**
 * Fichier de préchargement d'un formulaire Kobo (select_one_from_file / pulldata) :
 * colonne « name » (identifiant), « label » (ce qui s'affiche dans la liste de choix),
 * puis les colonnes choisies et ce qu'il faut vérifier. Rien d'autre.
 */
const comparateur = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function trierPourEtiquette(ids: string[], colonnes: string[], etat: Etat): string[] {
  return [...ids].sort((a, b) => {
    for (const c of colonnes) {
      const r = comparateur.compare(etat.valeur(a, c) ?? '', etat.valeur(b, c) ?? '');
      if (r) return r;
    }
    return comparateur.compare(a, b);
  });
}

export function tableauPrechargementKobo(etat: Etat, d: DemandeVisite): Tableau {
  const autres = d.colonnes.filter((c) => c !== etat.original.colonneId);
  // Étiquette de la liste de choix : de quoi reconnaître le ménage (nom, village), si ces colonnes ont été choisies.
  const detectees = detecterColonnes(etat.original.colonnes);
  const pourEtiquette = (d.etiquette?.length ? d.etiquette : [detectees.nom, detectees.village]).filter((c): c is string => !!c && autres.includes(c));
  const etiquetteDe = (id: string) => {
    const cols = pourEtiquette.length ? pourEtiquette : autres.filter((c) => !/^(start|end|today)$/.test(c)).slice(0, 2);
    return [id, ...cols.map((c) => etat.valeur(id, c) ?? '')].filter(Boolean).join(' – ');
  };
  const vus = new Set(['name', 'label', 'infos', 'a_verifier']);
  const noms = autres.map((c) => {
    let n = nomKobo(c);
    while (vus.has(n)) n = `${n}_`;
    vus.add(n);
    return n;
  });
  return {
    colonnes: ['name', 'label', 'infos', ...noms, 'a_verifier'],
    // Ordre de la liste de choix : selon les colonnes de l'étiquette, dans l'ordre choisi (ex. village puis nom).
    lignes: trierPourEtiquette(d.ids, pourEtiquette, etat).map((id) => {
      const valeurs = autres.map((c) => etat.valeur(id, c) ?? '');
      // « infos » : toutes les colonnes choisies, affichées par le formulaire une fois le ménage sélectionné.
      const infos = autres.map((c, i) => t('visite.infos', { colonne: c, valeur: valeurs[i] || '—' })).join(' · ');
      return [id, etiquetteDe(id), infos, ...valeurs, d.aVerifier.get(id) ?? ''];
    }),
  };
}

/** Feuille « Consignes » : la liste sert au terrain ; les résultats reviennent dans 2x2 par la saisie ou par Kobo. */
function consignes(): Tableau {
  return {
    colonnes: ['', ''],
    lignes: (['usage', 'retour', 'kobo', 'donnees'] as const).map((k) => [t(`consignes.${k}`), t(`consignes.${k}_texte`)]),
  };
}

export async function construireVisite(
  liste: Liste,
  etat: Etat,
  d: DemandeVisite,
  nature: 'visite' | 'kobo',
  format: FormatExport,
  auteur: string,
): Promise<FichierExporte> {
  const le = new Date().toISOString();
  const horodatage = le.slice(0, 16).replace(/[-:]/g, '').replace('T', '_');
  if (nature === 'kobo') {
    // Sans BOM : Kobo doit lire « name » tel quel dans la première colonne.
    const csv = ecrireCsv(tableauPrechargementKobo(etat, d), ',', false);
    return { nomFichier: NOM_PRECHARGEMENT, octets: new TextEncoder().encode(csv) as Octets, type: 'text/csv' };
  }
  const nomFichier = `visite_terrain_${base(liste)}_${horodatage}.${format}`;
  const tableau = tableauVisite(etat, d);
  if (format === 'csv') return { nomFichier, octets: new TextEncoder().encode(ecrireCsv(tableau, ',')) as Octets, type: 'text/csv' };
  const meta = tableauMetadonnees(liste, etat, 'visite', auteur, le);
  meta.lignes.push([t('meta.donnees_personnelles'), t('meta.donnees_personnelles_texte')]);
  const feuilles: FeuilleXlsx[] = [
    { nom: t('visite.feuille_visites'), tableau, largeurs: [14, ...d.colonnes.filter((c) => c !== etat.original.colonneId).map(() => 20), 60, 16, 14, 40, 22, 22, 20] },
    { nom: t('visite.feuille_consignes'), tableau: consignes(), largeurs: [26, 110] },
    { nom: '2x2', tableau: meta, largeurs: LARGEURS_META },
  ];
  return format === 'xlsx'
    ? { nomFichier, octets: await ecrireXlsx(feuilles), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    : { nomFichier, octets: await ecrireOds(feuilles), type: 'application/vnd.oasis.opendocument.spreadsheet' };
}

/** Produit la liste et inscrit au journal ce qui sort de l'outil : ménages, colonnes, empreinte du fichier. */
export async function exporterVisite(
  liste: Liste,
  etat: Etat,
  identite: IdentiteDeverrouillee,
  d: DemandeVisite,
  nature: 'visite' | 'kobo',
  format: FormatExport,
): Promise<FichierExporte> {
  if (!d.ids.length) throw new Error(t('err.aucun_menage'));
  const derniere = liste.journal.at(-1)!;
  const fichier = await construireVisite(liste, etat, d, nature, nature === 'kobo' ? 'csv' : format, identite.nom);
  await journaliserExport(liste, etat, identite, {
    nature,
    format: nature === 'kobo' ? 'csv' : format,
    nomFichier: fichier.nomFichier,
    empreinteFichier: await sha256Hex(fichier.octets),
    lignesJournal: liste.journal.length,
    empreinteJournal: derniere.empreinte,
    menages: d.ids.length,
    colonnes: d.colonnes,
    identifiants: d.ids,
  });
  return fichier;
}
