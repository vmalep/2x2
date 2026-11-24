/** Import d'un export KoboToolbox ou d'une plateforme de paiement : détection du format par le contenu, pas par l'extension. */
import { depuisUtf8, type Octets } from '../crypto/encodage.ts';
import { lireCsv } from './csv.ts';
import { lireOds } from './ods.ts';
import type { Tableau } from './tableau.ts';
import { lireXlsx } from './xlsx.ts';

export async function lireExport(octets: Octets, nomFichier: string): Promise<Tableau> {
  const estZip = octets[0] === 0x50 && octets[1] === 0x4b;
  if (estZip) {
    // ODS : l'archive commence par le fichier « mimetype » non compressé.
    const debut = new TextDecoder().decode(octets.subarray(30, 84));
    return debut.startsWith('mimetypeapplication/vnd.oasis.opendocument.spreadsheet') ? lireOds(octets) : lireXlsx(octets);
  }
  if (/\.xlsx?$/i.test(nomFichier)) throw new Error('Ce fichier n’est pas un XLSX valide (les anciens .xls ne sont pas pris en charge).');
  let texte: string;
  try {
    texte = depuisUtf8(octets);
  } catch {
    // Repli pour les CSV enregistrés en Windows-1252 par certaines versions d'Excel.
    texte = new TextDecoder('windows-1252').decode(octets);
  }
  return lireCsv(texte);
}
