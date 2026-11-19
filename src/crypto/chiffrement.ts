/**
 * Chiffrement par mot de passe : PBKDF2-SHA256 pour dériver la clé, AES-GCM 256 bits pour chiffrer.
 * Uniquement les fonctions standard du navigateur (WebCrypto).
 *
 * L'en-tête de l'enveloppe (format, version, paramètres) est authentifié comme
 * « données associées » d'AES-GCM : le modifier rend le déchiffrement impossible.
 */
import { aleatoire, depuisBase64, depuisUtf8, jsonCanonique, utf8, versBase64 } from './encodage.ts';

export const ITERATIONS_PAR_DEFAUT = 600_000;

export interface EnveloppeChiffree {
  format: string;
  version: number;
  kdf: { nom: 'PBKDF2-SHA256'; iterations: number; sel: string };
  chiffre: { nom: 'AES-GCM-256'; iv: string };
  /** Champs en clair, authentifiés mais non chiffrés (ex. nom, clé publique). */
  public: Record<string, unknown>;
  donnees: string;
}

export class MotDePasseIncorrect extends Error {
  constructor() {
    super('Mot de passe incorrect, ou fichier altéré.');
    this.name = 'MotDePasseIncorrect';
  }
}

async function deriverCle(motDePasse: string, sel: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8(motDePasse.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function donneesAssociees(e: Omit<EnveloppeChiffree, 'donnees'>): Uint8Array<ArrayBuffer> {
  return utf8(jsonCanonique({ format: e.format, version: e.version, kdf: e.kdf, chiffre: e.chiffre, public: e.public }));
}

export async function chiffrerJson(
  contenu: unknown,
  motDePasse: string,
  options: { format: string; version: number; public?: Record<string, unknown>; iterations?: number },
): Promise<EnveloppeChiffree> {
  const sel = aleatoire(16);
  const iv = aleatoire(12);
  const iterations = options.iterations ?? ITERATIONS_PAR_DEFAUT;
  const entete = {
    format: options.format,
    version: options.version,
    kdf: { nom: 'PBKDF2-SHA256' as const, iterations, sel: versBase64(sel) },
    chiffre: { nom: 'AES-GCM-256' as const, iv: versBase64(iv) },
    public: options.public ?? {},
  };
  const cle = await deriverCle(motDePasse, sel, iterations);
  const chiffre = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: donneesAssociees(entete) },
    cle,
    utf8(JSON.stringify(contenu)),
  );
  return { ...entete, donnees: versBase64(new Uint8Array(chiffre)) };
}

export async function dechiffrerJson<T>(enveloppe: EnveloppeChiffree, motDePasse: string, formatAttendu: string): Promise<T> {
  if (enveloppe?.format !== formatAttendu) {
    throw new Error(`Ce fichier n'est pas au format attendu (${formatAttendu}).`);
  }
  if (enveloppe.kdf?.nom !== 'PBKDF2-SHA256' || enveloppe.chiffre?.nom !== 'AES-GCM-256') {
    throw new Error('Paramètres de chiffrement non reconnus.');
  }
  if (!(enveloppe.kdf.iterations >= 100_000)) {
    throw new Error('Nombre d’itérations PBKDF2 trop faible : fichier refusé.');
  }
  const cle = await deriverCle(motDePasse, depuisBase64(enveloppe.kdf.sel), enveloppe.kdf.iterations);
  let clair: ArrayBuffer;
  try {
    clair = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: depuisBase64(enveloppe.chiffre.iv), additionalData: donneesAssociees(enveloppe) },
      cle,
      depuisBase64(enveloppe.donnees),
    );
  } catch {
    throw new MotDePasseIncorrect();
  }
  return JSON.parse(depuisUtf8(new Uint8Array(clair))) as T;
}
