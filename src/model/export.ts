/**
 * Construction des exports : liste finale (ménages inclus, valeurs corrigées) et rapport des alertes.
 * Chaque export porte l'empreinte du journal et est lui-même inscrit au journal avec sa propre empreinte.
 */
import type { IdentiteDeverrouillee } from '../crypto/cles.ts';
import type { Octets } from '../crypto/encodage.ts';
import { sha256Hex } from '../crypto/empreinte.ts';
import { LIBELLES_CONTROLES, type Alerte } from '../controles/controles.ts';
import { ecrireCsv } from '../io/csv.ts';
import { ecrireOds } from '../io/ods.ts';
import type { Tableau } from '../io/tableau.ts';
import { ecrireXlsx, type FeuilleXlsx } from '../io/xlsx.ts';
import { journaliserExport, type Etat } from './journal.ts';
import { CHAMP_STATUT, DECISIONS_ALERTE, type ContenuExport, type Liste } from './types.ts';

export type Nature = ContenuExport['nature'];
export type FormatExport = ContenuExport['format'];

export interface Blocage {
  correctionsEnAttente: number;
  alertesSansDecision: number;
}

export function blocages(etat: Etat, alertes: Alerte[]): Blocage {
  return {
    correctionsEnAttente: etat.enAttente().length,
    alertesSansDecision: alertes.filter((a) => !etat.decisionsAlertes.has(a.id)).length,
  };
}

export function exportPossible(b: Blocage): boolean {
  return b.correctionsEnAttente === 0 && b.alertesSansDecision === 0;
}

const nomAuteur = (etat: Etat, empreinte: string) => etat.utilisateurs.get(empreinte)?.nom ?? 'inconnu';
const date = (iso: string) => iso.replace('T', ' ').slice(0, 19) + ' UTC';

function idsMenages(etat: Etat): string[] {
  const o = etat.original;
  const i = o.colonnes.indexOf(o.colonneId);
  return o.lignes.map((l) => l[i]);
}

export function tableauListeFinale(etat: Etat): Tableau {
  const colonnes = etat.original.colonnes;
  return {
    colonnes,
    lignes: idsMenages(etat)
      .filter((id) => !etat.estExclu(id))
      .map((id) => colonnes.map((c) => etat.valeur(id, c) ?? '')),
  };
}

export function tableauAlertes(etat: Etat, alertes: Alerte[]): Tableau {
  return {
    colonnes: ['Alerte', 'Catégorie', 'Contrôle', 'Ménages', 'Constat', 'Décision', 'Décidée par', 'Le', 'Commentaire', 'Décision équipe (à remplir)', 'Commentaire équipe'],
    lignes: alertes.map((a) => {
      const d = etat.decisionsAlertes.get(a.id);
      return [
        a.id,
        a.categorie === 'protection' ? 'Protection' : 'Intégrité',
        LIBELLES_CONTROLES[a.controle],
        a.menages.join(', '),
        a.message,
        d ? DECISIONS_ALERTE[d.contenu.categorie][d.contenu.decision] : '',
        d ? nomAuteur(etat, d.auteur) : '',
        d ? date(d.le) : '',
        d?.contenu.commentaire ?? '',
        '',
        '',
      ];
    }),
  };
}

export function tableauCorrections(etat: Etat): Tableau {
  return {
    colonnes: ['N°', 'Ménage', 'Champ', 'Ancienne valeur', 'Nouvelle valeur', 'Motif', 'Commentaire', 'Proposée par', 'Le', 'Statut', 'Décidée par', 'Le (décision)', 'Commentaire (décision)'],
    lignes: [...etat.corrections.values()].map((c) => {
      const e = c.entree;
      return [
        String(e.n),
        e.contenu.menage,
        e.contenu.champ === CHAMP_STATUT ? 'Statut du ménage' : e.contenu.champ,
        e.contenu.ancienne,
        e.contenu.nouvelle,
        e.contenu.motif,
        e.contenu.commentaire,
        nomAuteur(etat, e.auteur),
        date(e.le),
        c.statut === 'en_attente' ? 'en attente' : c.statut === 'acceptee' ? 'acceptée' : 'refusée',
        c.decision ? nomAuteur(etat, c.decision.auteur) : '',
        c.decision ? date(c.decision.le) : '',
        c.decision?.contenu.commentaire ?? '',
      ];
    }),
  };
}

function tableauMetadonnees(liste: Liste, etat: Etat, nature: Nature, auteur: string, le: string): Tableau {
  const derniere = liste.journal.at(-1)!;
  const ids = idsMenages(etat);
  const exclus = ids.filter((id) => etat.estExclu(id)).length;
  return {
    colonnes: ['Élément', 'Valeur'],
    lignes: [
      ['Outil', '2x2 (prototype, données fictives uniquement)'],
      ['Nature', nature === 'liste' ? 'Liste finale' : 'Rapport des alertes et des corrections'],
      ['Fichier d’origine', liste.original.nomFichier],
      ['Empreinte SHA-256 du fichier d’origine', liste.original.empreinteFichier],
      ['Ménages : origine / inclus / exclus', `${ids.length} / ${ids.length - exclus} / ${exclus}`],
      ['Lignes du journal', String(liste.journal.length)],
      ['Empreinte de la dernière ligne du journal', derniere.empreinte],
      ['Exporté par', auteur],
      ['Le', date(le)],
      ['Vérification', 'Ouvrez la liste chiffrée dans 2x2, écran Export, « Vérifier un fichier exporté ».'],
    ],
  };
}

const LARGEURS_META = [42, 70];

export interface FichierExporte {
  nomFichier: string;
  octets: Octets;
  type: string;
}

export async function construireExport(
  liste: Liste,
  etat: Etat,
  alertes: Alerte[],
  nature: Nature,
  format: FormatExport,
  auteur: string,
): Promise<FichierExporte> {
  const le = new Date().toISOString();
  const base = liste.original.nomFichier.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_');
  const horodatage = le.slice(0, 16).replace(/[-:]/g, '').replace('T', '_');
  const nomFichier = `${nature === 'liste' ? 'liste_finale' : 'rapport_alertes'}_${base}_${horodatage}.${format}`;
  const meta: FeuilleXlsx = { nom: '2x2', tableau: tableauMetadonnees(liste, etat, nature, auteur, le), largeurs: LARGEURS_META };
  let feuilles: FeuilleXlsx[];
  if (nature === 'liste') {
    if (format === 'csv') {
      return { nomFichier, octets: new TextEncoder().encode(ecrireCsv(tableauListeFinale(etat), ',')) as Octets, type: 'text/csv' };
    }
    feuilles = [{ nom: 'Liste finale', tableau: tableauListeFinale(etat) }, meta];
  } else {
    if (format === 'csv') throw new Error('Le rapport des alertes est disponible en XLSX ou ODS.');
    feuilles = [
      { nom: 'Alertes', tableau: tableauAlertes(etat, alertes), largeurs: [30, 11, 26, 22, 60, 26, 18, 20, 40, 26, 40] },
      { nom: 'Corrections', tableau: tableauCorrections(etat) },
      meta,
    ];
  }
  return format === 'xlsx'
    ? { nomFichier, octets: await ecrireXlsx(feuilles), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    : { nomFichier, octets: await ecrireOds(feuilles), type: 'application/vnd.oasis.opendocument.spreadsheet' };
}

/** Produit l'export et l'inscrit au journal (signé) avec l'empreinte du fichier. */
export async function exporter(
  liste: Liste,
  etat: Etat,
  alertes: Alerte[],
  identite: IdentiteDeverrouillee,
  nature: Nature,
  format: FormatExport,
): Promise<FichierExporte> {
  // Le rapport des alertes est un document de travail : il reste exportable à tout moment.
  const b = nature === 'liste' ? blocages(etat, alertes) : { correctionsEnAttente: 0, alertesSansDecision: 0 };
  if (b.correctionsEnAttente) throw new Error(`Export verrouillé : ${b.correctionsEnAttente} correction(s) en attente de validation.`);
  if (b.alertesSansDecision) throw new Error(`Export verrouillé : ${b.alertesSansDecision} alerte(s) sans décision.`);
  const derniere = liste.journal.at(-1)!;
  const fichier = await construireExport(liste, etat, alertes, nature, format, identite.nom);
  await journaliserExport(liste, etat, identite, {
    nature,
    format,
    nomFichier: fichier.nomFichier,
    empreinteFichier: await sha256Hex(fichier.octets),
    lignesJournal: liste.journal.length,
    empreinteJournal: derniere.empreinte,
    menages: nature === 'liste' ? tableauListeFinale(etat).lignes.length : alertes.length,
  });
  return fichier;
}

/** Retrouve dans le journal l'export correspondant exactement à un fichier. */
export async function verifierFichierExporte(etat: Etat, octets: Octets) {
  const empreinte = await sha256Hex(octets);
  return { empreinte, entree: etat.exports.find((e) => e.contenu.empreinteFichier === empreinte) };
}
