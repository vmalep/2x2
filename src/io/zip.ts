/**
 * Lecture et écriture minimales d'archives ZIP (formats XLSX et ODS).
 * Méthodes « stockée » (0) et « deflate » (8), via les flux de compression natifs.
 */
import type { Octets } from '../crypto/encodage.ts';

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(octets: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function transformer(octets: Uint8Array<ArrayBuffer>, flux: CompressionStream | DecompressionStream): Promise<Octets> {
  const sortie = new Blob([octets]).stream().pipeThrough(flux);
  return new Uint8Array(await new Response(sortie).arrayBuffer());
}

export interface EntreeZip {
  nom: string;
  donnees: Octets;
  /** false pour stocker sans compression (obligatoire pour le fichier « mimetype » d'ODS). */
  compresser?: boolean;
}

export async function lireZip(archive: Uint8Array<ArrayBuffer>): Promise<Map<string, Octets>> {
  const vue = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  // Recherche de la fin du répertoire central, en partant de la fin.
  let fin = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 0xffff); i--) {
    if (vue.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('Archive ZIP invalide (fichier XLSX ou ODS attendu).');
  const nombre = vue.getUint16(fin + 10, true);
  let position = vue.getUint32(fin + 16, true);
  const decodeur = new TextDecoder();
  const resultat = new Map<string, Octets>();
  for (let n = 0; n < nombre; n++) {
    if (vue.getUint32(position, true) !== 0x02014b50) throw new Error('Répertoire central ZIP corrompu.');
    const methode = vue.getUint16(position + 10, true);
    const tailleCompressee = vue.getUint32(position + 20, true);
    const longueurNom = vue.getUint16(position + 28, true);
    const longueurExtra = vue.getUint16(position + 30, true);
    const longueurCommentaire = vue.getUint16(position + 32, true);
    const decalageLocal = vue.getUint32(position + 42, true);
    const nom = decodeur.decode(archive.subarray(position + 46, position + 46 + longueurNom));
    position += 46 + longueurNom + longueurExtra + longueurCommentaire;

    if (vue.getUint32(decalageLocal, true) !== 0x04034b50) throw new Error('En-tête local ZIP corrompu.');
    const debut = decalageLocal + 30 + vue.getUint16(decalageLocal + 26, true) + vue.getUint16(decalageLocal + 28, true);
    const brut = archive.slice(debut, debut + tailleCompressee);
    if (nom.endsWith('/')) continue;
    if (methode === 0) resultat.set(nom, brut);
    else if (methode === 8) resultat.set(nom, await transformer(brut, new DecompressionStream('deflate-raw')));
    else throw new Error(`Méthode de compression ZIP non prise en charge (${methode}).`);
  }
  return resultat;
}

export async function ecrireZip(entrees: EntreeZip[]): Promise<Octets> {
  const encodeur = new TextEncoder();
  const morceaux: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let decalage = 0;
  // Date DOS fixe (1er janvier 2026) : la sortie ne dépend pas de l'heure.
  const heureDos = 0;
  const dateDos = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const entree of entrees) {
    const nom = encodeur.encode(entree.nom);
    const compresser = entree.compresser !== false;
    const donnees = compresser ? await transformer(entree.donnees, new CompressionStream('deflate-raw')) : entree.donnees;
    const crc = crc32(entree.donnees);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // noms en UTF-8
    local.setUint16(8, compresser ? 8 : 0, true);
    local.setUint16(10, heureDos, true);
    local.setUint16(12, dateDos, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, donnees.length, true);
    local.setUint32(22, entree.donnees.length, true);
    local.setUint16(26, nom.length, true);
    morceaux.push(new Uint8Array(local.buffer), nom, donnees);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, compresser ? 8 : 0, true);
    cd.setUint16(12, heureDos, true);
    cd.setUint16(14, dateDos, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, donnees.length, true);
    cd.setUint32(24, entree.donnees.length, true);
    cd.setUint16(28, nom.length, true);
    cd.setUint32(42, decalage, true);
    central.push(new Uint8Array(cd.buffer), nom);
    decalage += 30 + nom.length + donnees.length;
  }

  const tailleCentral = central.reduce((s, c) => s + c.length, 0);
  const finCd = new DataView(new ArrayBuffer(22));
  finCd.setUint32(0, 0x06054b50, true);
  finCd.setUint16(8, entrees.length, true);
  finCd.setUint16(10, entrees.length, true);
  finCd.setUint32(12, tailleCentral, true);
  finCd.setUint32(16, decalage, true);

  const tout = [...morceaux, ...central, new Uint8Array(finCd.buffer)];
  const sortie = new Uint8Array(tout.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of tout) {
    sortie.set(c, p);
    p += c.length;
  }
  return sortie;
}
