import type { ClePubliqueJwk } from '../crypto/cles.ts';
import type { Regle } from '../controles/regles.ts';
import { langueCourante, libelles, tl, type Cle, type Langue } from '../i18n/index.ts';

export type Role = 'responsable' | 'correction' | 'validation';

/** Libellés affichés (traduits à la lecture). Les codes de rôle, eux, sont signés au journal. */
export const LIBELLES_ROLES: Record<Role, string> = libelles({
  responsable: 'role.responsable',
  correction: 'role.correction',
  validation: 'role.validation',
});

export interface Utilisateur {
  nom: string;
  cle: ClePubliqueJwk;
  /** Empreinte SHA-256 de la clé publique : identifiant de l'utilisateur dans le journal. */
  empreinte: string;
  roles: Role[];
}

/** L'export importé, figé. Il n'est jamais modifié. */
export interface Original {
  nomFichier: string;
  /** SHA-256 des octets du fichier importé, vérifiable avec n'importe quel outil (sha256sum). */
  empreinteFichier: string;
  colonnes: string[];
  colonneId: string;
  lignes: string[][];
}

const AUTRE = 'Autre (préciser en commentaire)';

/**
 * Motifs : les valeurs ci-dessous sont des CODES stables, signés tels quels au journal (en français).
 * Ils ne sont traduits qu'à l'affichage (libelleMotif).
 */

/** Motifs proposés pour corriger une valeur. */
export const MOTIFS_CORRECTION = ['Erreur de saisie', 'Vérification terrain', 'Changement de situation', AUTRE] as const;

/** Motifs proposés pour exclure un ménage de la liste finale. Une simple suspicion appelle une vérification, pas une exclusion. */
export const MOTIFS_EXCLUSION = [
  'Doublon',
  'Ménage introuvable ou inexistant',
  'Fraude avérée',
  'Ne remplit pas les critères d’éligibilité',
  'Ménage parti ou dissous',
  AUTRE,
] as const;

/** Motifs proposés pour réintégrer un ménage exclu. */
export const MOTIFS_REINTEGRATION = ['Exclusion erronée', 'Situation régularisée', AUTRE] as const;

/** Anciens motifs (premières versions) : toujours acceptés pour relire les listes existantes. */
const MOTIFS_ANCIENS = ['Fraude suspectée'] as const;

const CLES_MOTIFS: Record<Motif, Cle> = {
  'Erreur de saisie': 'motif.erreur_saisie',
  'Vérification terrain': 'motif.verification_terrain',
  'Changement de situation': 'motif.changement_situation',
  [AUTRE]: 'motif.autre',
  Doublon: 'motif.doublon',
  'Ménage introuvable ou inexistant': 'motif.introuvable',
  'Fraude avérée': 'motif.fraude_averee',
  'Ne remplit pas les critères d’éligibilité': 'motif.criteres',
  'Ménage parti ou dissous': 'motif.parti',
  'Exclusion erronée': 'motif.exclusion_erronee',
  'Situation régularisée': 'motif.regularisee',
  'Fraude suspectée': 'motif.fraude_suspectee',
};

/** Libellé affiché d'un motif (code du journal), dans la langue courante ou donnée. Un motif inconnu s'affiche tel quel. */
export function libelleMotif(m: string, l: Langue = langueCourante()): string {
  const cle = CLES_MOTIFS[m as Motif];
  return cle ? tl(l, cle) : m;
}

/** Tous les motifs reconnus par le journal. */
export const MOTIFS = [...new Set([...MOTIFS_CORRECTION, ...MOTIFS_EXCLUSION, ...MOTIFS_REINTEGRATION, ...MOTIFS_ANCIENS])] as readonly Motif[];
export type Motif =
  | (typeof MOTIFS_CORRECTION)[number]
  | (typeof MOTIFS_EXCLUSION)[number]
  | (typeof MOTIFS_REINTEGRATION)[number]
  | (typeof MOTIFS_ANCIENS)[number];

export interface ContenuOuverture {
  original: { nomFichier: string; empreinteFichier: string; empreinteContenu: string; colonneId: string; nombreLignes: number };
  utilisateurs: Utilisateur[];
}
export interface ContenuUtilisateur {
  utilisateur: Utilisateur;
}
export interface ContenuCorrection {
  menage: string;
  champ: string;
  ancienne: string;
  nouvelle: string;
  motif: Motif;
  commentaire: string;
}
export interface ContenuDecision {
  correction: number;
  decision: 'acceptee' | 'refusee';
  commentaire: string;
}

/** Champ virtuel de statut du ménage : son changement suit le circuit à quatre yeux d'une correction. */
export const CHAMP_STATUT = '2x2_statut';
export const STATUTS = ['inclus', 'exclu'] as const;

/** Motifs à proposer selon ce qui change : une valeur, une exclusion ou une réintégration. */
export function motifsPour(champ: string, ancienne: string): readonly Motif[] {
  if (champ !== CHAMP_STATUT) return MOTIFS_CORRECTION;
  return ancienne === 'exclu' ? MOTIFS_REINTEGRATION : MOTIFS_EXCLUSION;
}

/** Correspondance des colonnes de l'export utilisées par les contrôles. */
export interface ColonnesControles {
  debut?: string;
  fin?: string;
  soumission?: string;
  enqueteur?: string;
  telephone?: string;
  nom?: string;
  village?: string;
  /** Numéro de pièce d'identité (ou tout identifiant de personne censé être unique). */
  identifiant?: string;
}

export interface Parametres {
  colonnes: ColonnesControles;
  /** Durée d'entretien en dessous de laquelle l'entretien est suspect (6 minutes par défaut). */
  seuilDureeMinutes: number;
  /** Durée au-delà de laquelle l'horodatage est incohérent. */
  dureeMaxHeures: number;
  /** Part d'entretiens courts au-delà de laquelle un enquêteur est signalé. */
  partCourtsEnqueteur: number;
  /** Nombre minimal d'entretiens pour juger un enquêteur. */
  minEntretiensEnqueteur: number;
  /** Distance d'édition maximale entre deux noms jugés proches, dans un même village. */
  distanceNoms: number;
}

/**
 * Seule la catégorie « intégrité » est produite. « protection » n'existe que pour relire les fichiers
 * créés par une version antérieure : le repérage protection se fait en dehors de l'outil.
 */
export type CategorieAlerte = 'integrite' | 'protection';

/** Décisions d'alerte : les clés sont les codes signés au journal, les valeurs les libellés affichés. */
export const DECISIONS_ALERTE: Record<CategorieAlerte, Record<string, string>> = {
  integrite: libelles({
    confirmee: 'decision.confirmee',
    verification_terrain: 'decision.verification_terrain',
    faux_positif: 'decision.faux_positif',
  }),
  protection: libelles({
    orientee: 'decision.orientee',
    deja_suivie: 'decision.deja_suivie',
    faux_positif: 'decision.faux_positif_protection',
  }),
};

/** Ancien format (paramètres fixes) : conservé pour relire les listes créées avant les règles. */
export interface ContenuParametres {
  parametres: Parametres;
}
/** Jeu de règles de contrôle, signé : il remplace intégralement le précédent. */
export interface ContenuRegles {
  regles: Regle[];
  /** Fichier importé (nom et SHA-256), ou null si les règles ont été produites par l'outil. */
  source: { nomFichier: string; empreinteFichier: string } | null;
}
export interface ContenuDecisionAlerte {
  alerte: string;
  categorie: CategorieAlerte;
  menages: string[];
  decision: string;
  commentaire: string;
}
export interface ContenuExport {
  /**
   * Nature de l'export : liste finale, rapport des alertes, liste de visite terrain,
   * ou fichier de préchargement pour un formulaire Kobo de revisite.
   */
  nature: 'liste' | 'rapport' | 'visite' | 'kobo';
  format: 'csv' | 'xlsx' | 'ods';
  nomFichier: string;
  /** SHA-256 du fichier exporté : permet de vérifier plus tard qu'un fichier est authentique. */
  empreinteFichier: string;
  /** Nombre de lignes du journal et empreinte de la dernière, au moment de l'export. */
  lignesJournal: number;
  empreinteJournal: string;
  menages: number;
  /** Listes de visite et préchargement Kobo : colonnes de données personnelles sorties de l'outil. */
  colonnes?: string[];
  /** Listes de visite et préchargement Kobo : identifiants des ménages concernés. */
  identifiants?: string[];
}

export type CorpsEntree =
  | { type: 'ouverture'; contenu: ContenuOuverture }
  | { type: 'utilisateur'; contenu: ContenuUtilisateur }
  | { type: 'correction'; contenu: ContenuCorrection }
  | { type: 'decision'; contenu: ContenuDecision }
  | { type: 'parametres'; contenu: ContenuParametres }
  | { type: 'regles'; contenu: ContenuRegles }
  | { type: 'decision_alerte'; contenu: ContenuDecisionAlerte }
  | { type: 'export'; contenu: ContenuExport };

/** Partie signée d'une ligne de journal. */
export type EntreeNonSignee = CorpsEntree & {
  n: number;
  /** Empreinte de la ligne précédente (chaîne d'empreintes). */
  precedente: string;
  le: string;
  /** Empreinte de la clé publique de l'auteur. */
  auteur: string;
};

export type Entree = EntreeNonSignee & {
  signature: string;
  /** SHA-256 de la ligne complète (y compris la signature). */
  empreinte: string;
};

/** Contenu du fichier de liste, une fois déchiffré. */
export interface Liste {
  format: '2x2-liste-contenu';
  version: 1;
  original: Original;
  journal: Entree[];
}
