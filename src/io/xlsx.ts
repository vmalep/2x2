/**
 * Lecture et écriture XLSX minimales (Office Open XML, ISO/IEC 29500).
 * Le format est ouvert : LibreOffice Calc le lit et l'écrit nativement.
 * Lecture : première feuille, valeurs texte et nombres ; les dates stockées
 * comme nombres sont converties en date ISO quand leur style est un format de date.
 */
import { utf8, type Octets } from '../crypto/encodage.ts';
import { attribut, decoderEntites, echapperXml } from './xml.ts';
import { ecrireZip, lireZip } from './zip.ts';
import { normaliser, type Tableau } from './tableau.ts';
import { t } from '../i18n/index.ts';

function texte(octets: Octets | undefined): string {
  return octets ? new TextDecoder().decode(octets) : '';
}

/** Texte d'un élément <si> ou <is> : concaténation de tous les <t>, hors annotations phonétiques. */
function texteRiche(xml: string): string {
  const sansPhonetique = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  return [...sansPhonetique.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)].map((m) => decoderEntites(m[1] ?? '')).join('');
}

function indexColonne(reference: string): number {
  const lettres = /^[A-Z]+/.exec(reference)?.[0] ?? 'A';
  let n = 0;
  for (const l of lettres) n = n * 26 + (l.charCodeAt(0) - 64);
  return n - 1;
}

function lettresColonne(index: number): string {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const FORMATS_DATE_INTEGRES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function stylesDate(stylesXml: string): Set<number> {
  const personnalises = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attribut(m[0], 'numFmtId'));
    personnalises.set(id, attribut(m[0], 'formatCode') ?? '');
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  const resultat = new Set<number>();
  [...xfs.matchAll(/<xf\b[^>]*>/g)].forEach((m, i) => {
    const id = Number(attribut(m[0], 'numFmtId') ?? 0);
    const code = (personnalises.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
    if (FORMATS_DATE_INTEGRES.has(id) || /[dy]|h{1,2}:m/i.test(code)) resultat.add(i);
  });
  return resultat;
}

function serieVersIso(serie: number): string {
  const ms = Math.round((serie - 25569) * 86400 * 1000);
  const iso = new Date(ms).toISOString();
  return Number.isInteger(serie) ? iso.slice(0, 10) : iso.slice(0, 19);
}

export async function lireXlsx(octets: Octets): Promise<Tableau> {
  const fichiers = await lireZip(octets);
  const classeur = texte(fichiers.get('xl/workbook.xml'));
  if (!classeur) throw new Error(t('err.xlsx'));
  const premiereFeuille = /<sheet\b[^>]*>/.exec(classeur)?.[0];
  const idRelation = premiereFeuille && (attribut(premiereFeuille, 'r:id') ?? attribut(premiereFeuille, 'id'));
  let chemin = 'xl/worksheets/sheet1.xml';
  const relations = texte(fichiers.get('xl/_rels/workbook.xml.rels'));
  for (const m of relations.matchAll(/<Relationship\b[^>]*>/g)) {
    if (attribut(m[0], 'Id') === idRelation) {
      const cible = attribut(m[0], 'Target') ?? '';
      chemin = cible.startsWith('/') ? cible.slice(1) : `xl/${cible}`;
    }
  }
  const feuille = texte(fichiers.get(chemin));
  if (!feuille) throw new Error(t('err.xlsx_feuille'));

  const partages = [...texte(fichiers.get('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texteRiche(m[1]));
  const dates = stylesDate(texte(fichiers.get('xl/styles.xml')));

  const lignes: string[][] = [];
  for (const mLigne of feuille.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const numero = Number(attribut(`<row ${mLigne[1]}>`, 'r') ?? lignes.length + 1) - 1;
    const ligne: string[] = [];
    let colonne = 0;
    for (const mCellule of mLigne[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const balise = `<c ${mCellule[1]}>`;
      const ref = attribut(balise, 'r');
      if (ref) colonne = indexColonne(ref);
      const type = attribut(balise, 't') ?? 'n';
      const contenu = mCellule[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(contenu)?.[1];
      let valeur = '';
      if (type === 's' && v !== undefined) valeur = partages[Number(v)] ?? '';
      else if (type === 'inlineStr') valeur = texteRiche(/<is>([\s\S]*?)<\/is>/.exec(contenu)?.[1] ?? '');
      else if (type === 'b' && v !== undefined) valeur = v === '1' ? 'VRAI' : 'FAUX';
      else if (v !== undefined) {
        valeur = decoderEntites(v);
        const style = Number(attribut(balise, 's') ?? -1);
        if (type === 'n' && dates.has(style) && valeur !== '') valeur = serieVersIso(Number(valeur));
      }
      ligne[colonne] = valeur;
      colonne++;
    }
    lignes[numero] = Array.from(ligne, (c) => c ?? '');
  }
  return normaliser(Array.from(lignes, (l) => l ?? []));
}

export interface FeuilleXlsx {
  nom: string;
  tableau: Tableau;
  /** Largeurs de colonnes en caractères (facultatif). */
  largeurs?: number[];
}

/** Écrit un classeur XLSX où toutes les valeurs sont du texte (aucune interprétation automatique). */
export async function ecrireXlsx(feuilles: FeuilleXlsx[]): Promise<Octets> {
  const fichiers = [
    {
      nom: '[Content_Types].xml',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${feuilles
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    },
    {
      nom: '_rels/.rels',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nom: 'xl/workbook.xml',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${feuilles
        .map((f, i) => `<sheet name="${echapperXml(f.nom.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      nom: 'xl/_rels/workbook.xml.rels',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${feuilles
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${feuilles.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      nom: 'xl/styles.xml',
      // Style 0 : texte ; style 1 : en-tête en gras.
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" applyFont="1" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    },
    ...feuilles.map((f, i) => {
      const lignes = [f.tableau.colonnes, ...f.tableau.lignes];
      const cols = f.largeurs?.length
        ? `<cols>${f.largeurs.map((l, j) => `<col min="${j + 1}" max="${j + 1}" width="${l}" customWidth="1"/>`).join('')}</cols>`
        : '';
      const donnees = lignes
        .map(
          (l, r) =>
            `<row r="${r + 1}">${l
              .map((v, c) => `<c r="${lettresColonne(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${echapperXml(v)}</t></is></c>`)
              .join('')}</row>`,
        )
        .join('');
      return {
        nom: `xl/worksheets/sheet${i + 1}.xml`,
        xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${donnees}</sheetData><autoFilter ref="A1:${lettresColonne(Math.max(0, f.tableau.colonnes.length - 1))}${lignes.length}"/></worksheet>`,
      };
    }),
  ];
  return ecrireZip(fichiers.map((f) => ({ nom: f.nom, donnees: utf8(f.xml) })));
}
