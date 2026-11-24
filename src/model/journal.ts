/**
 * Journal signé et chaîné.
 *
 * Chaque ligne contient l'empreinte de la précédente et est signée par son auteur (ECDSA P-256).
 * Les mêmes règles métier s'appliquent à l'ajout d'une ligne et à la vérification à l'ouverture :
 * un fichier fabriqué à la main en dehors de l'outil est donc contrôlé comme une saisie normale.
 */
import { signer, verifier, type IdentiteDeverrouillee } from '../crypto/cles.ts';
import { jsonCanonique } from '../crypto/encodage.ts';
import { sha256Hex } from '../crypto/empreinte.ts';
import { reglesDepuisParametres, reglesParDefaut, validerRegles, type Regle } from '../controles/regles.ts';
import {
  CHAMP_STATUT,
  DECISIONS_ALERTE,
  MOTIFS,
  STATUTS,
  type ContenuDecisionAlerte,
  type ContenuExport,
  type ContenuRegles,
  type Parametres,
  type ContenuCorrection,
  type ContenuDecision,
  type CorpsEntree,
  type Entree,
  type EntreeNonSignee,
  type Liste,
  type Original,
  type Role,
  type Utilisateur,
} from './types.ts';
import { langueCourante, t } from '../i18n/index.ts';

export const EMPREINTE_INITIALE = '0'.repeat(64);

export interface CorrectionSuivie {
  entree: Entree & { type: 'correction' };
  statut: 'en_attente' | 'acceptee' | 'refusee';
  decision?: Entree & { type: 'decision' };
}

/** État courant, recalculé en rejouant le journal sur l'original. */
export class Etat {
  utilisateurs = new Map<string, Utilisateur>();
  corrections = new Map<number, CorrectionSuivie>();
  /** Valeurs modifiées par des corrections acceptées : ménage → champ → valeur. */
  modifications = new Map<string, Map<string, string>>();
  /** Correction en attente par cellule « ménage␟champ ». */
  enAttenteParCellule = new Map<string, number>();
  indexMenages = new Map<string, number>();
  /** Paramètres des contrôles (ancien format), convertis en règles. */
  parametres: Parametres | undefined;
  /** Dernier jeu de règles signé au journal, avec sa ligne. */
  regles: (Entree & { type: 'regles' }) | undefined;
  /** Dernière décision humaine par alerte. */
  decisionsAlertes = new Map<string, Entree & { type: 'decision_alerte' }>();
  exports: (Entree & { type: 'export' })[] = [];
  derniere: Entree | undefined;

  constructor(readonly original: Original) {
    const iId = original.colonnes.indexOf(original.colonneId);
    original.lignes.forEach((l, i) => this.indexMenages.set(l[iId], i));
  }

  valeur(menage: string, champ: string): string | undefined {
    const modifiee = this.modifications.get(menage)?.get(champ);
    if (modifiee !== undefined) return modifiee;
    const i = this.indexMenages.get(menage);
    if (champ === CHAMP_STATUT) return i === undefined ? undefined : 'inclus';
    const c = this.original.colonnes.indexOf(champ);
    return i === undefined || c < 0 ? undefined : this.original.lignes[i][c];
  }

  aRole(empreinte: string, role: Role): boolean {
    return this.utilisateurs.get(empreinte)?.roles.includes(role) ?? false;
  }

  /** Règles en vigueur : dernier jeu signé, sinon anciens paramètres convertis, sinon règles par défaut. */
  reglesCourantes(): Regle[] {
    if (this.regles) return this.regles.contenu.regles;
    if (this.parametres) return reglesDepuisParametres(this.parametres);
    // L'original ne change jamais : les règles par défaut se calculent une seule fois.
    // Leurs libellés suivent la langue de l'interface (leurs noms, donc les identifiants d'alerte, non).
    if (this.reglesDefautCache?.langue !== langueCourante()) {
      this.reglesDefautCache = { langue: langueCourante(), regles: reglesParDefaut(this.original.colonnes, this.original.lignes) };
    }
    return this.reglesDefautCache.regles;
  }
  private reglesDefautCache?: { langue: string; regles: Regle[] };

  estExclu(menage: string): boolean {
    return this.valeur(menage, CHAMP_STATUT) === 'exclu';
  }

  enAttente(): CorrectionSuivie[] {
    return [...this.corrections.values()].filter((c) => c.statut === 'en_attente');
  }
}

export const cellule = (menage: string, champ: string) => `${menage}␟${champ}`;

export function empreinteContenu(original: Original): Promise<string> {
  return sha256Hex(jsonCanonique({ colonnes: original.colonnes, colonneId: original.colonneId, lignes: original.lignes }));
}

/**
 * Applique une ligne à l'état. Renvoie un message d'erreur si la ligne viole une règle,
 * sans modifier l'état dans ce cas.
 */
function appliquer(etat: Etat, e: EntreeNonSignee): string | undefined {
  const auteur = etat.utilisateurs.get(e.auteur);
  switch (e.type) {
    case 'ouverture': {
      if (e.n !== 0) return t('verif.ouverture_premiere');
      const resp = e.contenu.utilisateurs.find((u) => u.empreinte === e.auteur);
      if (!resp?.roles.includes('responsable')) return t('verif.ouverture_responsable');
      for (const u of e.contenu.utilisateurs) {
        if (etat.utilisateurs.has(u.empreinte)) return t('verif.deux_fois', { nom: u.nom });
        etat.utilisateurs.set(u.empreinte, u);
      }
      return undefined;
    }
    case 'utilisateur': {
      if (!auteur?.roles.includes('responsable')) return t('verif.declarer');
      const u = e.contenu.utilisateur;
      if (etat.utilisateurs.has(u.empreinte)) return t('verif.deja_declaree', { nom: etat.utilisateurs.get(u.empreinte)!.nom });
      etat.utilisateurs.set(u.empreinte, u);
      return undefined;
    }
    case 'correction': {
      const c = e.contenu;
      if (!auteur) return t('verif.auteur_inconnu');
      if (!auteur.roles.includes('correction')) return t('verif.role_correction', { nom: auteur.nom });
      if (!etat.indexMenages.has(c.menage)) return t('verif.menage', { menage: c.menage });
      if (!etat.original.colonnes.includes(c.champ) && c.champ !== CHAMP_STATUT) return t('verif.champ', { champ: c.champ });
      if (c.champ === CHAMP_STATUT && !(STATUTS as readonly string[]).includes(c.nouvelle)) return t('verif.statut');
      if (c.champ === etat.original.colonneId) return t('verif.identifiant');
      if (!(MOTIFS as readonly string[]).includes(c.motif)) return t('verif.motif');
      if (c.motif.startsWith('Autre') && !c.commentaire.trim()) return t('verif.autre');
      const cle = cellule(c.menage, c.champ);
      if (etat.enAttenteParCellule.has(cle)) return t('verif.deja_attente');
      if (etat.valeur(c.menage, c.champ) !== c.ancienne) return t('verif.ancienne');
      if (c.nouvelle === c.ancienne) return t('verif.identique');
      etat.corrections.set(e.n, { entree: e as CorrectionSuivie['entree'], statut: 'en_attente' });
      etat.enAttenteParCellule.set(cle, e.n);
      return undefined;
    }
    case 'decision': {
      const d = e.contenu;
      if (!auteur) return t('verif.auteur_inconnu');
      if (!auteur.roles.includes('validation')) return t('verif.role_validation', { nom: auteur.nom });
      const suivie = etat.corrections.get(d.correction);
      if (!suivie) return t('verif.correction', { n: d.correction });
      if (suivie.statut !== 'en_attente') return t('verif.traitee', { n: d.correction });
      if (suivie.entree.auteur === e.auteur) return t('verif.propre');
      if (d.decision !== 'acceptee' && d.decision !== 'refusee') return t('verif.decision');
      if (d.decision === 'refusee' && !d.commentaire.trim()) return t('verif.refus');
      suivie.statut = d.decision;
      suivie.decision = e as CorrectionSuivie['decision'];
      const c = suivie.entree.contenu;
      etat.enAttenteParCellule.delete(cellule(c.menage, c.champ));
      if (d.decision === 'acceptee') {
        let m = etat.modifications.get(c.menage);
        if (!m) etat.modifications.set(c.menage, (m = new Map()));
        m.set(c.champ, c.nouvelle);
      }
      return undefined;
    }
    case 'parametres': {
      if (!auteur?.roles.includes('responsable')) return t('verif.parametres');
      const p = e.contenu.parametres;
      for (const c of Object.values(p.colonnes ?? {})) {
        if (c !== undefined && !etat.original.colonnes.includes(c)) return t('verif.colonne_parametres', { colonne: c });
      }
      const nombres = [p.seuilDureeMinutes, p.dureeMaxHeures, p.partCourtsEnqueteur, p.minEntretiensEnqueteur, p.distanceNoms];
      if (nombres.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) return t('verif.parametre_nombre');
      etat.parametres = p;
      etat.regles = undefined;
      return undefined;
    }
    case 'regles': {
      if (!auteur?.roles.includes('responsable')) return t('verif.regles');
      if (!Array.isArray(e.contenu.regles)) return t('verif.regles_illisibles');
      const erreurs = validerRegles(e.contenu.regles, etat.original.colonnes);
      if (erreurs.length) return t('verif.regles_invalides', { erreur: erreurs[0] });
      etat.regles = e as Entree & { type: 'regles' };
      return undefined;
    }
    case 'decision_alerte': {
      const d = e.contenu;
      if (!auteur) return t('verif.auteur_inconnu');
      if (!auteur.roles.includes('validation') && !auteur.roles.includes('responsable')) {
        return t('verif.role_decider', { nom: auteur.nom });
      }
      if (!DECISIONS_ALERTE[d.categorie]?.[d.decision]) return t('verif.decision_alerte');
      if (!d.alerte || !Array.isArray(d.menages)) return t('verif.alerte');
      if (d.menages.some((m) => !etat.indexMenages.has(m))) return t('verif.menage_alerte');
      if (d.decision === 'confirmee' && !d.commentaire.trim()) {
        return t('verif.confirmee');
      }
      if (d.decision === 'faux_positif' && !d.commentaire.trim()) return t('verif.faux_positif');
      etat.decisionsAlertes.set(d.alerte, e as Entree & { type: 'decision_alerte' });
      return undefined;
    }
    case 'export': {
      if (!auteur?.roles.includes('responsable')) return t('verif.exporter');
      const x = e.contenu;
      if (x.nature === 'liste' && etat.enAttente().length) return t('verif.export_attente');
      if (x.lignesJournal !== e.n || x.empreinteJournal !== e.precedente) return t('verif.export_empreinte');
      etat.exports.push(e as Entree & { type: 'export' });
      return undefined;
    }
    default:
      return t('verif.type');
  }
}

function partieSignee(e: Entree): EntreeNonSignee {
  const { signature: _s, empreinte: _e, ...reste } = e;
  return reste as EntreeNonSignee;
}

async function empreinteEntree(signee: EntreeNonSignee, signature: string): Promise<string> {
  return sha256Hex(jsonCanonique({ ...signee, signature }));
}

export interface Probleme {
  n: number | null;
  message: string;
}

export interface Verification {
  valide: boolean;
  erreurs: Probleme[];
  avertissements: Probleme[];
  etat: Etat;
}

/** Vérifie tout le fichier : original, chaîne, signatures et règles. */
export async function verifierListe(liste: Liste): Promise<Verification> {
  const erreurs: Probleme[] = [];
  const avertissements: Probleme[] = [];
  const etat = new Etat(liste.original);
  const { journal, original } = liste;

  if (journal.length === 0 || journal[0].type !== 'ouverture') {
    erreurs.push({ n: null, message: t('verif.pas_ouverture') });
    return { valide: false, erreurs, avertissements, etat };
  }
  const ouverture = (journal[0] as Entree & { type: 'ouverture' }).contenu;
  const contenuCalcule = await empreinteContenu(original);
  if (ouverture.original.empreinteContenu !== contenuCalcule) {
    erreurs.push({ n: 0, message: t('verif.original_modifie') });
  }
  if (ouverture.original.empreinteFichier !== original.empreinteFichier) {
    erreurs.push({ n: 0, message: t('verif.empreinte_import') });
  }
  if (etat.indexMenages.size !== original.lignes.length) {
    erreurs.push({ n: 0, message: t('verif.doublons_original') });
  }

  let precedente = EMPREINTE_INITIALE;
  let datePrecedente = '';
  for (let i = 0; i < journal.length; i++) {
    const e = journal[i];
    if (e.n !== i) erreurs.push({ n: i, message: t('verif.numerotation', { n: e.n, i }) });
    if (e.precedente !== precedente) erreurs.push({ n: i, message: t('verif.chaine') });
    const signee = partieSignee(e);
    if ((await empreinteEntree(signee, e.signature)) !== e.empreinte) {
      erreurs.push({ n: i, message: t('verif.contenu') });
    }
    // Pour l'ouverture, l'auteur est dans la liste des utilisateurs qu'elle déclare.
    const auteur =
      e.type === 'ouverture' ? e.contenu.utilisateurs.find((u) => u.empreinte === e.auteur) : etat.utilisateurs.get(e.auteur);
    if (!auteur) erreurs.push({ n: i, message: t('verif.cle_non_declaree') });
    else if (!(await verifier(auteur.cle, jsonCanonique(signee), e.signature))) {
      erreurs.push({ n: i, message: t('verif.signature', { nom: auteur.nom }) });
    }
    const regle = appliquer(etat, signee);
    if (regle) erreurs.push({ n: i, message: regle });
    if (datePrecedente && e.le < datePrecedente) {
      avertissements.push({ n: i, message: t('verif.date') });
    }
    datePrecedente = e.le;
    precedente = e.empreinte;
    etat.derniere = e;
  }
  return { valide: erreurs.length === 0, erreurs, avertissements, etat };
}

/**
 * Ajoute une ligne signée au journal après avoir vérifié les règles sur l'état courant.
 * L'état passé en paramètre est mis à jour.
 */
export async function ajouterEntree(liste: Liste, etat: Etat, identite: IdentiteDeverrouillee, corps: CorpsEntree): Promise<Entree> {
  const derniere = liste.journal.at(-1);
  const signee = {
    ...corps,
    n: liste.journal.length,
    precedente: derniere?.empreinte ?? EMPREINTE_INITIALE,
    le: new Date().toISOString(),
    auteur: identite.empreinte,
  } as EntreeNonSignee;
  // Contrôle sur une copie de l'état pour ne rien modifier en cas d'erreur.
  const erreur = appliquerSurCopie(etat, signee);
  if (erreur) throw new Error(erreur);
  const signature = await signer(identite.clePrivee, jsonCanonique(signee));
  const entree = { ...signee, signature, empreinte: await empreinteEntree(signee, signature) } as Entree;
  appliquer(etat, signee);
  liste.journal.push(entree);
  etat.derniere = entree;
  return entree;
}

function appliquerSurCopie(etat: Etat, e: EntreeNonSignee): string | undefined {
  const copie = new Etat(etat.original);
  copie.utilisateurs = new Map(etat.utilisateurs);
  copie.corrections = new Map([...etat.corrections].map(([k, v]) => [k, { ...v }]));
  copie.modifications = new Map([...etat.modifications].map(([k, v]) => [k, new Map(v)]));
  copie.enAttenteParCellule = new Map(etat.enAttenteParCellule);
  copie.parametres = etat.parametres;
  copie.regles = etat.regles;
  copie.decisionsAlertes = new Map(etat.decisionsAlertes);
  copie.exports = [...etat.exports];
  return appliquer(copie, e);
}

export async function creerListe(
  original: Original,
  responsable: IdentiteDeverrouillee,
  utilisateurs: Utilisateur[],
): Promise<{ liste: Liste; etat: Etat }> {
  if (!original.colonnes.includes(original.colonneId)) throw new Error(t('verif.colonne_id'));
  const iId = original.colonnes.indexOf(original.colonneId);
  const ids = original.lignes.map((l) => l[iId]);
  const vides = ids.filter((id) => !id.trim()).length;
  if (vides) throw new Error(t('verif.sans_id', { n: vides, colonne: original.colonneId }));
  const doublon = ids.find((id, i) => ids.indexOf(id) !== i);
  if (doublon) throw new Error(t('verif.id_double', { id: doublon }));

  const liste: Liste = { format: '2x2-liste-contenu', version: 1, original, journal: [] };
  const etat = new Etat(original);
  await ajouterEntree(liste, etat, responsable, {
    type: 'ouverture',
    contenu: {
      original: {
        nomFichier: original.nomFichier,
        empreinteFichier: original.empreinteFichier,
        empreinteContenu: await empreinteContenu(original),
        colonneId: original.colonneId,
        nombreLignes: original.lignes.length,
      },
      utilisateurs,
    },
  });
  return { liste, etat };
}

export function corriger(liste: Liste, etat: Etat, identite: IdentiteDeverrouillee, contenu: ContenuCorrection) {
  return ajouterEntree(liste, etat, identite, { type: 'correction', contenu });
}

export function decider(liste: Liste, etat: Etat, identite: IdentiteDeverrouillee, contenu: ContenuDecision) {
  return ajouterEntree(liste, etat, identite, { type: 'decision', contenu });
}

export function signerRegles(liste: Liste, etat: Etat, identite: IdentiteDeverrouillee, contenu: ContenuRegles) {
  return ajouterEntree(liste, etat, identite, { type: 'regles', contenu });
}

export function fixerParametres(liste: Liste, etat: Etat, identite: IdentiteDeverrouillee, parametres: Parametres) {
  return ajouterEntree(liste, etat, identite, { type: 'parametres', contenu: { parametres } });
}

export function deciderAlerte(liste: Liste, etat: Etat, identite: IdentiteDeverrouillee, contenu: ContenuDecisionAlerte) {
  return ajouterEntree(liste, etat, identite, { type: 'decision_alerte', contenu });
}

export function journaliserExport(liste: Liste, etat: Etat, identite: IdentiteDeverrouillee, contenu: ContenuExport) {
  return ajouterEntree(liste, etat, identite, { type: 'export', contenu });
}

export function declarerUtilisateur(liste: Liste, etat: Etat, identite: IdentiteDeverrouillee, utilisateur: Utilisateur) {
  return ajouterEntree(liste, etat, identite, { type: 'utilisateur', contenu: { utilisateur } });
}
