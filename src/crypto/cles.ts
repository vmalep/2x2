/**
 * Clés personnelles : chaque utilisateur génère sa paire ECDSA P-256 sur son poste.
 * La clé privée est chiffrée par son mot de passe dans un « fichier de clé » qui ne circule jamais.
 * Seule la clé publique (et son empreinte) est communiquée au responsable.
 */
import { chiffrerJson, dechiffrerJson, type EnveloppeChiffree } from './chiffrement.ts';
import { depuisBase64, depuisUtf8, jsonCanonique, utf8, versBase64 } from './encodage.ts';
import { grouper, sha256Hex } from './empreinte.ts';
import { t } from '../i18n/index.ts';

export const FORMAT_CLE = '2x2-cle-personnelle';
export const FORMAT_CLE_PUBLIQUE = '2x2-cle-publique';
const ALGO = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** Clé publique au format JWK réduit aux seuls champs utiles, pour une empreinte stable. */
export interface ClePubliqueJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface FichierClePublique {
  format: typeof FORMAT_CLE_PUBLIQUE;
  version: 1;
  nom: string;
  cle: ClePubliqueJwk;
  empreinte: string;
  creeLe: string;
}

export interface IdentiteDeverrouillee {
  nom: string;
  creeLe: string;
  clePublique: ClePubliqueJwk;
  empreinte: string;
  clePrivee: CryptoKey;
}

function reduire(jwk: JsonWebKey): ClePubliqueJwk {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error(t('err.cle_invalide'));
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

/** Empreinte d'une clé publique : SHA-256 du JWK canonique, en hexadécimal. */
export function empreinteCle(cle: ClePubliqueJwk): Promise<string> {
  return sha256Hex(jsonCanonique(reduire(cle as JsonWebKey)));
}

export async function genererIdentite(
  nom: string,
  motDePasse: string,
  iterations?: number,
): Promise<{ fichierCle: EnveloppeChiffree; fichierPublic: FichierClePublique; identite: IdentiteDeverrouillee }> {
  const nomPropre = nom.trim();
  if (!nomPropre) throw new Error(t('err.nom_obligatoire'));
  const paire = (await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify'])) as CryptoKeyPair;
  const clePublique = reduire(await crypto.subtle.exportKey('jwk', paire.publicKey));
  const clePriveeJwk = await crypto.subtle.exportKey('jwk', paire.privateKey);
  const empreinte = await empreinteCle(clePublique);
  const creeLe = new Date().toISOString();
  const fichierCle = await chiffrerJson({ clePrivee: clePriveeJwk }, motDePasse, {
    format: FORMAT_CLE,
    version: 1,
    public: { nom: nomPropre, clePublique, empreinte, creeLe },
    iterations,
  });
  const fichierPublic: FichierClePublique = {
    format: FORMAT_CLE_PUBLIQUE,
    version: 1,
    nom: nomPropre,
    cle: clePublique,
    empreinte,
    creeLe,
  };
  // La clé privée utilisée pendant la séance est réimportée comme non exportable.
  const clePrivee = await crypto.subtle.importKey('jwk', clePriveeJwk, ALGO, false, ['sign']);
  return { fichierCle, fichierPublic, identite: { nom: nomPropre, creeLe, clePublique, empreinte, clePrivee } };
}

export async function deverrouillerIdentite(fichierCle: EnveloppeChiffree, motDePasse: string): Promise<IdentiteDeverrouillee> {
  const { clePrivee: jwk } = await dechiffrerJson<{ clePrivee: JsonWebKey }>(fichierCle, motDePasse, FORMAT_CLE);
  const pub = fichierCle.public as { nom: string; clePublique: ClePubliqueJwk; empreinte: string; creeLe?: string };
  const clePublique = reduire(pub.clePublique as JsonWebKey);
  // Vérifie que la clé privée correspond bien à la clé publique annoncée.
  if (jwk.x !== clePublique.x || jwk.y !== clePublique.y) throw new Error(t('err.cle_incoherente'));
  const empreinte = await empreinteCle(clePublique);
  const clePrivee = await crypto.subtle.importKey('jwk', jwk, ALGO, false, ['sign']);
  return { nom: pub.nom, creeLe: pub.creeLe ?? '', clePublique, empreinte, clePrivee };
}

/** Fichier de clé publique, reconstruit depuis l'identité déverrouillée : on peut le transmettre à tout moment. */
export function fichierClePublique(identite: IdentiteDeverrouillee): FichierClePublique {
  return {
    format: FORMAT_CLE_PUBLIQUE,
    version: 1,
    nom: identite.nom,
    cle: identite.clePublique,
    empreinte: identite.empreinte,
    creeLe: identite.creeLe,
  };
}

const PREFIXE_CLE = '2X2-CLE-1.';

/** Clé publique sous forme de texte, à coller dans un message. La ligne « Code » fait foi. */
export function clePubliqueEnTexte(f: FichierClePublique): string {
  return [
    `Clé publique 2x2 de ${f.nom}`,
    `Empreinte : ${grouper(f.empreinte, 8)}`,
    `Code : ${PREFIXE_CLE}${versBase64(utf8(JSON.stringify(f)))}`,
  ].join('\n');
}

/** Lit une clé publique : fichier JSON, ou texte contenant le code « 2X2-CLE-1. » (même coupé sur plusieurs lignes). */
export async function lireFichierClePublique(texte: string): Promise<FichierClePublique> {
  let donnees: FichierClePublique;
  try {
    const debut = texte.indexOf(PREFIXE_CLE);
    if (debut >= 0) {
      const code = /^[A-Za-z0-9+/=]+/.exec(texte.slice(debut + PREFIXE_CLE.length).replace(/\s+/g, ''))?.[0] ?? '';
      donnees = JSON.parse(depuisUtf8(depuisBase64(code)));
    } else donnees = JSON.parse(texte);
  } catch {
    throw new Error(t('err.cle_illisible'));
  }
  if (donnees?.format !== FORMAT_CLE_PUBLIQUE) throw new Error(t('err.pas_cle'));
  const cle = reduire(donnees.cle as JsonWebKey);
  const empreinte = await empreinteCle(cle);
  if (empreinte !== donnees.empreinte) throw new Error(t('err.empreinte_cle'));
  if (typeof donnees.nom !== 'string' || !donnees.nom.trim()) throw new Error(t('err.nom_manquant'));
  return { ...donnees, cle, empreinte };
}

const cacheImport = new Map<string, Promise<CryptoKey>>();
function importerPublique(cle: ClePubliqueJwk): Promise<CryptoKey> {
  const id = `${cle.x}.${cle.y}`;
  let promesse = cacheImport.get(id);
  if (!promesse) {
    promesse = crypto.subtle.importKey('jwk', { ...cle, ext: true }, ALGO, false, ['verify']);
    cacheImport.set(id, promesse);
  }
  return promesse;
}

export async function signer(clePrivee: CryptoKey, message: string): Promise<string> {
  return versBase64(new Uint8Array(await crypto.subtle.sign(SIGNATURE, clePrivee, utf8(message))));
}

export async function verifier(cle: ClePubliqueJwk, message: string, signature: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify(SIGNATURE, await importerPublique(cle), depuisBase64(signature), utf8(message));
  } catch {
    return false;
  }
}
