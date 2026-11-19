import { describe, expect, it } from 'vitest';
import { utf8 } from '../src/crypto/encodage.ts';
import { ecrireCsv, lireCsv } from '../src/io/csv.ts';
import { lireExport } from '../src/io/import.ts';
import { ecrireXlsx, lireXlsx } from '../src/io/xlsx.ts';
import { crc32, ecrireZip, lireZip } from '../src/io/zip.ts';

const tableau = {
  colonnes: ['id', 'nom', 'note'],
  lignes: [
    ['MN-0001', 'Mbala Marie', 'a;b, "c"'],
    ['MN-0002', 'Ngoma Élise & <fils>', 'ligne 1\nligne 2'],
    ['MN-0003', '', '  espaces  '],
  ],
};

describe('ZIP', () => {
  it('CRC-32 de référence', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
  });
  it('aller-retour avec et sans compression', async () => {
    const zip = await ecrireZip([
      { nom: 'a.txt', donnees: utf8('bonjour'.repeat(100)) },
      { nom: 'dossier/é.txt', donnees: utf8('x'), compresser: false },
    ]);
    const lu = await lireZip(zip);
    expect(new TextDecoder().decode(lu.get('a.txt'))).toBe('bonjour'.repeat(100));
    expect(new TextDecoder().decode(lu.get('dossier/é.txt'))).toBe('x');
  });
});

describe('CSV', () => {
  it('aller-retour avec guillemets, séparateurs et retours à la ligne', () => {
    expect(lireCsv(ecrireCsv(tableau))).toEqual(tableau);
    expect(lireCsv(ecrireCsv(tableau, ','))).toEqual(tableau);
  });
  it('détecte le séparateur et ignore les lignes vides', () => {
    expect(lireCsv('a;b\r\n1;2\r\n\r\n')).toEqual({ colonnes: ['a', 'b'], lignes: [['1', '2']] });
  });
  it('refuse un en-tête en double', () => {
    expect(() => lireCsv('a,a\n1,2')).toThrow(/double/);
  });
});

describe('XLSX', () => {
  it('aller-retour', async () => {
    expect(await lireXlsx(await ecrireXlsx([{ nom: 'Feuille', tableau }]))).toEqual(tableau);
  });
  it('import détecte le format par le contenu', async () => {
    expect(await lireExport(await ecrireXlsx([{ nom: 'F', tableau }]), 'export.csv')).toEqual(tableau);
    expect(await lireExport(utf8(ecrireCsv(tableau)), 'export.xlsx.txt')).toEqual(tableau);
  });
  it('lit chaînes partagées, cellules manquantes et dates numériques', async () => {
    const fichiers = {
      '[Content_Types].xml': '<Types/>',
      'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/feuille.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>id</t></si><si><r><t>da</t></r><r><t xml:space="preserve">te</t></r></si><si><t>A&amp;B</t></si></sst>',
      'xl/styles.xml': '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/feuille.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>n</t></is></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>46277</v></c></row>' +
        '<row r="4"><c r="C4"><v>3.5</v></c></row></sheetData></worksheet>',
    };
    const zip = await ecrireZip(Object.entries(fichiers).map(([nom, xml]) => ({ nom, donnees: utf8(xml) })));
    expect(await lireXlsx(zip)).toEqual({
      colonnes: ['id', 'date', 'n'],
      lignes: [
        ['A&B', '2026-09-12', ''],
        ['', '', '3.5'],
      ],
    });
  });
});
