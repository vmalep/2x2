import { genererIdentite, type IdentiteDeverrouillee } from '../src/crypto/cles.ts';
import type { Role, Utilisateur } from '../src/model/types.ts';

/** Itérations PBKDF2 réduites (minimum accepté) pour accélérer les tests. */
export const ITER = 100_000;

export async function personne(nom: string, roles: Role[]): Promise<{ identite: IdentiteDeverrouillee; utilisateur: Utilisateur }> {
  const { identite, fichierPublic } = await genererIdentite(nom, 'mot de passe de test', ITER);
  return { identite, utilisateur: { nom, cle: fichierPublic.cle, empreinte: fichierPublic.empreinte, roles } };
}
