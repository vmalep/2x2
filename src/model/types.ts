import type { ClePubliqueJwk } from '../crypto/cles.ts';

export type Role = 'responsable' | 'correction' | 'validation';

export const LIBELLES_ROLES: Record<Role, string> = {
  responsable: 'Responsable',
  correction: 'Correction',
  validation: 'Validation',
};

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

export const MOTIFS = [
  'Erreur de saisie',
  'Vérification terrain',
  'Doublon',
  'Fraude suspectée',
  'Changement de situation',
  'Autre (préciser en commentaire)',
] as const;
export type Motif = (typeof MOTIFS)[number];

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

/** Correspondance des colonnes de l'export utilisées par les contrôles. */
export interface ColonnesControles {
  debut?: string;
  fin?: string;
  soumission?: string;
  enqueteur?: string;
  telephone?: string;
  nom?: string;
  village?: string;
  enfantNonAccompagne?: string;
  ageChef?: string;
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

export type CategorieAlerte = 'integrite' | 'protection';

export const DECISIONS_ALERTE: Record<CategorieAlerte, Record<string, string>> = {
  integrite: {
    confirmee: 'Anomalie confirmée',
    verification_terrain: 'À vérifier sur le terrain',
    faux_positif: 'Faux positif',
  },
  protection: {
    orientee: 'Orientée vers les services adaptés',
    deja_suivie: 'Déjà suivie',
    faux_positif: 'Faux positif',
  },
};

export interface ContenuParametres {
  parametres: Parametres;
}
export interface ContenuDecisionAlerte {
  alerte: string;
  categorie: CategorieAlerte;
  menages: string[];
  decision: string;
  commentaire: string;
}
export interface ContenuExport {
  /** Nature de l'export : liste finale ou rapport des alertes. */
  nature: 'liste' | 'rapport';
  format: 'csv' | 'xlsx' | 'ods';
  nomFichier: string;
  /** SHA-256 du fichier exporté : permet de vérifier plus tard qu'un fichier est authentique. */
  empreinteFichier: string;
  /** Nombre de lignes du journal et empreinte de la dernière, au moment de l'export. */
  lignesJournal: number;
  empreinteJournal: string;
  menages: number;
}

export type CorpsEntree =
  | { type: 'ouverture'; contenu: ContenuOuverture }
  | { type: 'utilisateur'; contenu: ContenuUtilisateur }
  | { type: 'correction'; contenu: ContenuCorrection }
  | { type: 'decision'; contenu: ContenuDecision }
  | { type: 'parametres'; contenu: ContenuParametres }
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
