/** Fonctions d'encodage de base : UTF-8, base64, hexadécimal, JSON canonique. */

export type Octets = Uint8Array<ArrayBuffer>;

const encodeur = new TextEncoder();
const decodeur = new TextDecoder('utf-8', { fatal: true });

export function utf8(texte: string): Octets {
  return encodeur.encode(texte) as Octets;
}

export function depuisUtf8(octets: Uint8Array): string {
  return decodeur.decode(octets);
}

export function versBase64(octets: Uint8Array): string {
  let binaire = '';
  const bloc = 0x8000;
  for (let i = 0; i < octets.length; i += bloc) {
    binaire += String.fromCharCode(...octets.subarray(i, i + bloc));
  }
  return btoa(binaire);
}

export function depuisBase64(texte: string): Octets {
  const binaire = atob(texte);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

export function versHex(octets: Uint8Array): string {
  return Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('');
}

/**
 * JSON canonique : clés d'objet triées, aucun espace.
 * Sert à signer et à calculer les empreintes de façon reproductible.
 * Les valeurs undefined sont refusées pour éviter toute ambiguïté.
 */
export function jsonCanonique(valeur: unknown): string {
  if (valeur === null) return 'null';
  switch (typeof valeur) {
    case 'string':
    case 'boolean':
      return JSON.stringify(valeur);
    case 'number':
      if (!Number.isFinite(valeur)) throw new Error('Nombre non fini dans le JSON canonique');
      return JSON.stringify(valeur);
    case 'object': {
      if (Array.isArray(valeur)) return `[${valeur.map(jsonCanonique).join(',')}]`;
      const objet = valeur as Record<string, unknown>;
      const cles = Object.keys(objet).sort();
      return `{${cles
        .map((cle) => {
          if (objet[cle] === undefined) throw new Error(`Valeur undefined pour la clé « ${cle} »`);
          return `${JSON.stringify(cle)}:${jsonCanonique(objet[cle])}`;
        })
        .join(',')}}`;
    }
    default:
      throw new Error(`Type non pris en charge dans le JSON canonique : ${typeof valeur}`);
  }
}

export function aleatoire(taille: number): Octets {
  return crypto.getRandomValues(new Uint8Array(taille));
}
