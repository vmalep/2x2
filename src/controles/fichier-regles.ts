/** Fichier de règles : export (XLSX, ODS ou CSV) pour édition dans un tableur, puis import et contrôle. */
import type { Octets } from '../crypto/encodage.ts';
import { sha256Hex } from '../crypto/empreinte.ts';
import { ecrireCsv } from '../io/csv.ts';
import { lireExport } from '../io/import.ts';
import { ecrireOds } from '../io/ods.ts';
import { ecrireXlsx, type FeuilleXlsx } from '../io/xlsx.ts';
import { reglesDepuisTableau, tableauAide, tableauDepuisRegles, validerRegles, type Regle } from './regles.ts';
import { t } from '../i18n/index.ts';

export type FormatRegles = 'xlsx' | 'ods' | 'csv';

export async function exporterRegles(regles: Regle[], colonnesListe: string[], format: FormatRegles): Promise<{ octets: Octets; type: string }> {
  const feuilles: FeuilleXlsx[] = [
    { nom: t('fichier.feuille_regles'), tableau: tableauDepuisRegles(regles), largeurs: [7, 24, 40, 18, 26, 26, 10, 10, 30] },
    { nom: t('fichier.feuille_aide'), tableau: tableauAide(colonnesListe), largeurs: [22, 34, 110] },
  ];
  if (format === 'csv') return { octets: new TextEncoder().encode(ecrireCsv(feuilles[0].tableau)) as Octets, type: 'text/csv' };
  if (format === 'ods') return { octets: await ecrireOds(feuilles), type: 'application/vnd.oasis.opendocument.spreadsheet' };
  return { octets: await ecrireXlsx(feuilles), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

export interface ReglesImportees {
  regles: Regle[];
  erreurs: string[];
  nomFichier: string;
  empreinteFichier: string;
}

/** Lit et contrôle un fichier de règles contre les colonnes de la liste ; n'applique rien. */
export async function importerRegles(octets: Octets, nomFichier: string, colonnesListe: string[]): Promise<ReglesImportees> {
  const empreinteFichier = await sha256Hex(octets);
  let lu;
  try {
    lu = reglesDepuisTableau(await lireExport(octets, nomFichier));
  } catch (e) {
    return { regles: [], erreurs: [(e as Error).message], nomFichier, empreinteFichier };
  }
  const erreurs = [...lu.erreurs, ...validerRegles(lu.regles, colonnesListe)];
  if (!lu.regles.length) erreurs.push(t('regles.err_vide'));
  return { regles: lu.regles, erreurs, nomFichier, empreinteFichier };
}
