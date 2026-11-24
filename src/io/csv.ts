/** Lecture et écriture CSV (RFC 4180), avec détection du séparateur et du BOM UTF-8. */
import { normaliser, type Tableau } from './tableau.ts';
import { t } from '../i18n/index.ts';

function detecterSeparateur(texte: string): string {
  const premiereLigne = texte.split(/\r?\n/, 1)[0] ?? '';
  const candidats = [';', ',', '\t'];
  let meilleur = ',';
  let max = -1;
  for (const c of candidats) {
    const n = premiereLigne.split(c).length;
    if (n > max) {
      max = n;
      meilleur = c;
    }
  }
  return meilleur;
}

export function lireCsv(texte: string, separateur?: string): Tableau {
  const source = texte.replace(/^﻿/, '');
  const sep = separateur ?? detecterSeparateur(source);
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let guillemets = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (guillemets) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          champ += '"';
          i++;
        } else guillemets = false;
      } else champ += c;
    } else if (c === '"' && champ === '') guillemets = true;
    else if (c === sep) {
      ligne.push(champ);
      champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = '';
    } else champ += c;
  }
  if (guillemets) throw new Error(t('err.csv'));
  if (champ !== '' || ligne.length) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return normaliser(lignes);
}

export function ecrireCsv(tableau: Tableau, separateur = ';', bom = true): string {
  const echapper = (v: string) => (/[";\r\n,\t]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v);
  // BOM pour qu'Excel et LibreOffice reconnaissent l'UTF-8 à l'ouverture (pas pour Kobo, qui lirait mal la 1re colonne).
  return (bom ? '\ufeff' : '') + [tableau.colonnes, ...tableau.lignes].map((l) => l.map(echapper).join(separateur)).join('\r\n') + '\r\n';
}
