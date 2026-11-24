/** Fichier de liste chiffré (.2x2) : la liste, le journal et les clés publiques. Jamais de clé privée. */
import { chiffrerJson, dechiffrerJson, type EnveloppeChiffree } from '../crypto/chiffrement.ts';
import type { Liste } from './types.ts';
import { t } from '../i18n/index.ts';

export const FORMAT_LISTE = '2x2-liste';

export async function chiffrerListe(liste: Liste, motDePasse: string, iterations?: number): Promise<string> {
  const enveloppe = await chiffrerJson(liste, motDePasse, { format: FORMAT_LISTE, version: 1, iterations });
  return JSON.stringify(enveloppe);
}

export async function dechiffrerListe(texte: string, motDePasse: string): Promise<Liste> {
  let enveloppe: EnveloppeChiffree;
  try {
    enveloppe = JSON.parse(texte);
  } catch {
    throw new Error(t('err.liste_illisible'));
  }
  const liste = await dechiffrerJson<Liste>(enveloppe, motDePasse, FORMAT_LISTE);
  if (liste.format !== '2x2-liste-contenu' || liste.version !== 1) throw new Error(t('err.liste_version'));
  return liste;
}
