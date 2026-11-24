import { describe, expect, it } from 'vitest';
import { COLONNES_KOBO, genererDonneesFictives, PROPORTIONS_PAR_DEFAUT } from '../src/gen/fictif.ts';

describe('Générateur de données fictives', () => {
  const d = genererDonneesFictives();
  const col = (c: string) => COLONNES_KOBO.indexOf(c as (typeof COLONNES_KOBO)[number]);
  const ligne = (id: string) => d.tableau.lignes.find((l) => l[col('id_menage')] === id)!;
  const duree = (l: string[]) => (Date.parse(l[col('end')]) - Date.parse(l[col('start')])) / 60000;

  it('est déterministe pour une graine donnée', () => {
    expect(genererDonneesFictives()).toEqual(d);
    expect(genererDonneesFictives({ graine: 1 })).not.toEqual(d);
  });
  it('produit 300 ménages MN-xxxx uniques, marqués fictifs', () => {
    const ids = d.tableau.lignes.map((l) => l[col('id_menage')]);
    expect(ids).toHaveLength(300);
    expect(new Set(ids).size).toBe(300);
    expect(ids.every((id) => /^MN-\d{4}$/.test(id))).toBe(true);
    expect(d.tableau.lignes.every((l) => l[col('donnees_fictives')] === 'OUI')).toBe(true);
    expect(new Set(d.tableau.lignes.map((l) => l[col('territoire')]))).toEqual(new Set(['Territoire Nord', 'Territoire Sud']));
  });
  it('plante les anomalies dans les proportions demandées', () => {
    for (const [a, p] of Object.entries(PROPORTIONS_PAR_DEFAUT)) {
      expect(Math.abs(d.verite[a as keyof typeof d.verite].length - 300 * p)).toBeLessThanOrEqual(1);
    }
  });
  it('les anomalies plantées sont bien présentes dans les données', () => {
    for (const id of d.verite.entretien_court) expect(duree(ligne(id))).toBeLessThan(6);
    const normaux = d.tableau.lignes.filter((l) => !Object.values(d.verite).flat().includes(l[col('id_menage')]));
    expect(normaux.every((l) => duree(l) >= 6)).toBe(true);
    const pieces = d.verite.doublon_identifiant;
    const norm = (x: string) => x.replace(/[^A-Z0-9]/gi, '');
    for (let k = 0; k < pieces.length; k += 2) {
      expect(norm(ligne(pieces[k])[col('numero_piece_identite')])).toBe(norm(ligne(pieces[k + 1])[col('numero_piece_identite')]));
    }
    const tel = d.verite.doublon_telephone;
    for (let k = 0; k < tel.length; k += 2) expect(ligne(tel[k])[col('telephone')]).toBe(ligne(tel[k + 1])[col('telephone')]);
    const noms = d.verite.doublon_nom;
    for (let k = 0; k < noms.length; k += 2) {
      expect(ligne(noms[k])[col('village')]).toBe(ligne(noms[k + 1])[col('village')]);
      expect(ligne(noms[k])[col('nom_chef_menage')]).not.toBe(ligne(noms[k + 1])[col('nom_chef_menage')]);
    }
  });
  it('concentre les entretiens courts sur les enquêteurs suspects', () => {
    const parSuspects = d.verite.entretien_court.filter((id) => d.enqueteursSuspects.includes(ligne(id)[col('enqueteur')]));
    expect(parSuspects.length / d.verite.entretien_court.length).toBeGreaterThan(0.5);
  });
});
