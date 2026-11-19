/**
 * Reçus de validation : un court texte signé par le validateur, conservé EN DEHORS du fichier.
 * Il atteste l'état du journal (nombre de lignes, empreinte de la dernière) à la fin d'une séance.
 * Il comble la limite de la chaîne d'empreintes : la suppression des dernières lignes du journal.
 */
import { signer, verifier, type IdentiteDeverrouillee } from '../crypto/cles.ts';
import { depuisBase64, depuisUtf8, jsonCanonique, utf8, versBase64 } from '../crypto/encodage.ts';
import { grouper } from '../crypto/empreinte.ts';
import type { Liste, Utilisateur } from './types.ts';

const PREFIXE = '2X2-RECU-1.';

export interface Recu {
  format: '2x2-recu';
  version: 1;
  /** Empreinte de la ligne d'ouverture : identifie la liste. */
  liste: string;
  lignes: number;
  derniere: string;
  le: string;
  auteur: string;
  nom: string;
  signature: string;
}

export async function creerRecu(liste: Liste, identite: IdentiteDeverrouillee): Promise<Recu> {
  const corps = {
    format: '2x2-recu' as const,
    version: 1 as const,
    liste: liste.journal[0].empreinte,
    lignes: liste.journal.length,
    derniere: liste.journal.at(-1)!.empreinte,
    le: new Date().toISOString(),
    auteur: identite.empreinte,
    nom: identite.nom,
  };
  return { ...corps, signature: await signer(identite.clePrivee, jsonCanonique(corps)) };
}

/** Texte à conserver ou à envoyer (message, courriel). La ligne « Code » fait foi. */
export function recuEnTexte(r: Recu): string {
  return [
    'Reçu de validation 2x2',
    `Par : ${r.nom} (clé ${grouper(r.auteur, 4)})`,
    `Le : ${new Date(r.le).toLocaleString('fr-BE')}`,
    `Journal : ${r.lignes} lignes, dernière empreinte ${r.derniere.slice(0, 16)}…`,
    `Liste : ${r.liste.slice(0, 16)}…`,
    `Code : ${PREFIXE}${versBase64(utf8(JSON.stringify(r)))}`,
  ].join('\n');
}

export function lireRecu(texte: string): Recu {
  const debut = texte.indexOf(PREFIXE);
  if (debut < 0) throw new Error('Aucun code de reçu 2x2 trouvé dans ce texte.');
  // Le code peut avoir été coupé sur plusieurs lignes par une messagerie : on retire les blancs.
  const code = /^[A-Za-z0-9+/=]+/.exec(texte.slice(debut + PREFIXE.length).replace(/\s+/g, ''))?.[0] ?? '';
  let r: Recu;
  try {
    r = JSON.parse(depuisUtf8(depuisBase64(code)));
  } catch {
    throw new Error('Code de reçu illisible (texte tronqué ?).');
  }
  if (r?.format !== '2x2-recu' || r.version !== 1) throw new Error('Format de reçu non reconnu.');
  return r;
}

export type ResultatRecu =
  | { statut: 'conforme'; recu: Recu; lignesAjoutees: number }
  | { statut: 'tronque'; recu: Recu; manquantes: number }
  | { statut: 'divergent'; recu: Recu }
  | { statut: 'autre_liste'; recu: Recu }
  | { statut: 'signature_invalide'; recu: Recu }
  | { statut: 'auteur_inconnu'; recu: Recu };

/** Confronte le journal du fichier à un reçu conservé à part. */
export async function confronterRecu(liste: Liste, utilisateurs: Map<string, Utilisateur>, recu: Recu): Promise<ResultatRecu> {
  const { signature, ...corps } = recu;
  const auteur = utilisateurs.get(recu.auteur);
  if (!auteur) return { statut: 'auteur_inconnu', recu };
  if (!(await verifier(auteur.cle, jsonCanonique(corps), signature))) return { statut: 'signature_invalide', recu };
  if (liste.journal[0]?.empreinte !== recu.liste) return { statut: 'autre_liste', recu };
  if (liste.journal.length < recu.lignes) return { statut: 'tronque', recu, manquantes: recu.lignes - liste.journal.length };
  if (liste.journal[recu.lignes - 1]?.empreinte !== recu.derniere) return { statut: 'divergent', recu };
  return { statut: 'conforme', recu, lignesAjoutees: liste.journal.length - recu.lignes };
}
