/**
 * Construction des exports : liste finale (ménages inclus, valeurs corrigées) et rapport des alertes.
 * Chaque export porte l'empreinte du journal et est lui-même inscrit au journal avec sa propre empreinte.
 */
import type { IdentiteDeverrouillee } from '../crypto/cles.ts';
import type { Octets } from '../crypto/encodage.ts';
import { sha256Hex } from '../crypto/empreinte.ts';
import type { Alerte } from '../controles/controles.ts';
import { ecrireCsv } from '../io/csv.ts';
import { ecrireOds } from '../io/ods.ts';
import type { Tableau } from '../io/tableau.ts';
import { ecrireXlsx, type FeuilleXlsx } from '../io/xlsx.ts';
import { journaliserExport, type Etat } from './journal.ts';
import { CHAMP_STATUT, DECISIONS_ALERTE, libelleMotif, type ContenuExport, type Liste } from './types.ts';
import { langueCourante, libelles, t } from '../i18n/index.ts';

/** Version de l'outil (définie à la compilation ; absente dans les tests). */
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '?';

export type Nature = ContenuExport['nature'];

export const LIBELLES_NATURE: Record<Nature, string> = libelles({
  liste: 'nature.liste',
  rapport: 'nature.rapport',
  visite: 'nature.visite',
  kobo: 'nature.kobo',
});
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

const nomAuteur = (etat: Etat, empreinte: string) => etat.utilisateurs.get(empreinte)?.nom ?? t('session.auteur_inconnu');
const date = (iso: string) => iso.replace('T', ' ').slice(0, 19) + ' UTC';

/** Statut inclus / exclu (code du journal), tel qu'affiché. */
const libelleStatut = (s: string) => (s === 'exclu' ? t('statut.exclu') : s === 'inclus' ? t('statut.inclus') : s);

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
    colonnes: (['alerte', 'controle', 'menages', 'constat', 'decision', 'decidee_par', 'le', 'commentaire', 'decision_equipe', 'commentaire_equipe'] as const).map((c) => t(`rapport.${c}`)),
    lignes: alertes.map((a) => {
      const d = etat.decisionsAlertes.get(a.id);
      return [
        a.id,
        a.libelle,
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
    colonnes: (['numero', 'menage', 'champ', 'ancienne', 'nouvelle', 'motif', 'commentaire', 'proposee_par', 'le', 'statut', 'decidee_par', 'le_decision', 'commentaire_decision'] as const).map((c) => t(`rapport.${c}`)),
    lignes: [...etat.corrections.values()].map((c) => {
      const e = c.entree;
      return [
        String(e.n),
        e.contenu.menage,
        e.contenu.champ === CHAMP_STATUT ? t('correction.statut_menage') : e.contenu.champ,
        e.contenu.champ === CHAMP_STATUT ? libelleStatut(e.contenu.ancienne) : e.contenu.ancienne,
        e.contenu.champ === CHAMP_STATUT ? libelleStatut(e.contenu.nouvelle) : e.contenu.nouvelle,
        libelleMotif(e.contenu.motif),
        e.contenu.commentaire,
        nomAuteur(etat, e.auteur),
        date(e.le),
        c.statut === 'en_attente' ? t('correction.en_attente') : c.statut === 'acceptee' ? t('correction.acceptee') : t('correction.refusee'),
        c.decision ? nomAuteur(etat, c.decision.auteur) : '',
        c.decision ? date(c.decision.le) : '',
        c.decision?.contenu.commentaire ?? '',
      ];
    }),
  };
}

export function tableauMetadonnees(liste: Liste, etat: Etat, nature: Nature, auteur: string, le: string): Tableau {
  const derniere = liste.journal.at(-1)!;
  const ids = idsMenages(etat);
  const exclus = ids.filter((id) => etat.estExclu(id)).length;
  return {
    colonnes: [t('meta.element'), t('meta.valeur')],
    lignes: [
      [t('meta.outil'), t('meta.outil_valeur', { version: VERSION })],
      [t('meta.nature'), LIBELLES_NATURE[nature]],
      [t('meta.fichier'), liste.original.nomFichier],
      [t('meta.empreinte_fichier'), liste.original.empreinteFichier],
      [t('meta.menages'), `${ids.length} / ${ids.length - exclus} / ${exclus}`],
      [t('meta.lignes'), String(liste.journal.length)],
      [t('meta.empreinte_journal'), derniere.empreinte],
      [t('meta.par'), auteur],
      [t('rapport.le'), date(le)],
      [t('meta.langue'), langueCourante()],
      [t('meta.verification'), t('meta.verification_texte')],
    ],
  };
}

export const LARGEURS_META = [42, 70];

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
    // Liste finale : colonnes de l'export d'origine, inchangées (seul le nom de la feuille est traduit).
    feuilles = [{ nom: t('nature.liste'), tableau: tableauListeFinale(etat) }, meta];
  } else {
    if (format === 'csv') throw new Error(t('export.err_rapport_csv'));
    feuilles = [
      { nom: t('rapport.feuille_alertes'), tableau: tableauAlertes(etat, alertes), largeurs: [30, 26, 22, 60, 26, 18, 20, 40, 26, 40] },
      { nom: t('rapport.feuille_corrections'), tableau: tableauCorrections(etat) },
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
  if (b.correctionsEnAttente) throw new Error(t('export.err_attente', { n: b.correctionsEnAttente }));
  if (b.alertesSansDecision) throw new Error(t('export.err_alertes', { n: b.alertesSansDecision }));
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
