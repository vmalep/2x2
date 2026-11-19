import { utf8, versHex, type Octets } from './encodage.ts';

/** Empreinte SHA-256 en hexadécimal, d'octets ou d'un texte (encodé en UTF-8). */
export async function sha256Hex(donnees: Octets | string): Promise<string> {
  const octets = typeof donnees === 'string' ? utf8(donnees) : donnees;
  return versHex(new Uint8Array(await crypto.subtle.digest('SHA-256', octets)));
}

/** Présente une empreinte hexadécimale par groupes de 4 caractères, en majuscules. */
export function grouper(hex: string, groupes = 16): string {
  return (hex.toUpperCase().match(/.{1,4}/g) ?? []).slice(0, groupes).join(' ');
}
