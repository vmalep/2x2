/**
 * Écriture ODS minimale (OpenDocument, format natif de LibreOffice Calc, norme ISO/IEC 26300).
 * Toutes les cellules sont du texte, comme pour l'écriture XLSX.
 */
import { utf8, type Octets } from '../crypto/encodage.ts';
import type { FeuilleXlsx } from './xlsx.ts';
import { echapperXml } from './xml.ts';
import { ecrireZip } from './zip.ts';

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"';

/** Paragraphe ODF : les espaces multiples et en tête doivent être codés explicitement. */
function paragraphe(ligne: string): string {
  const echappe = echapperXml(ligne).replace(/\t/g, '<text:tab/>');
  return `<text:p>${echappe.replace(/(^ +| {2,})/g, (m, _g, pos: number) => {
    const n = pos === 0 ? m.length : m.length - 1;
    return (pos === 0 ? '' : ' ') + (n === 1 ? '<text:s/>' : `<text:s text:c="${n}"/>`);
  })}</text:p>`;
}

function cellule(valeur: string, entete: boolean): string {
  const style = entete ? ' table:style-name="entete"' : '';
  if (valeur === '') return `<table:table-cell${style}/>`;
  return `<table:table-cell${style} office:value-type="string">${valeur.split(/\r?\n/).map(paragraphe).join('')}</table:table-cell>`;
}

export async function ecrireOds(feuilles: FeuilleXlsx[]): Promise<Octets> {
  const tables = feuilles
    .map((f) => {
      const lignes = [f.tableau.colonnes, ...f.tableau.lignes];
      const colonnes = (f.largeurs ?? []).map((_, i) => `<table:table-column table:style-name="col${feuilles.indexOf(f)}_${i}"/>`).join('');
      return (
        `<table:table table:name="${echapperXml(f.nom.slice(0, 31))}">${colonnes || '<table:table-column/>'}` +
        lignes.map((l, r) => `<table:table-row>${l.map((v) => cellule(v, r === 0)).join('')}</table:table-row>`).join('') +
        '</table:table>'
      );
    })
    .join('');
  const stylesColonnes = feuilles
    .flatMap((f, fi) =>
      (f.largeurs ?? []).map(
        (l, i) =>
          `<style:style style:name="col${fi}_${i}" style:family="table-column"><style:table-column-properties style:column-width="${(l * 0.19).toFixed(2)}cm"/></style:style>`,
      ),
    )
    .join('');
  const contenu =
    `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:automatic-styles>` +
    `<style:style style:name="entete" style:family="table-cell"><style:text-properties fo:font-weight="bold"/></style:style>${stylesColonnes}` +
    `</office:automatic-styles><office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body></office:document-content>`;
  const manifeste =
    '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
    '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>' +
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
    '</manifest:manifest>';
  return ecrireZip([
    // Le fichier « mimetype » doit être le premier de l'archive, non compressé.
    { nom: 'mimetype', donnees: utf8('application/vnd.oasis.opendocument.spreadsheet'), compresser: false },
    { nom: 'META-INF/manifest.xml', donnees: utf8(manifeste) },
    { nom: 'content.xml', donnees: utf8(contenu) },
  ]);
}
