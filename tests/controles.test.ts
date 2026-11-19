import { describe, expect, it } from 'vitest';
import { calculerAlertes, lireDate, type Controle } from '../src/controles/controles.ts';
import { detecterColonnes, parametresParDefaut } from '../src/controles/parametres.ts';
import { distance, nomsProches, normaliserTelephone } from '../src/controles/similarite.ts';
import { genererDonneesFictives, type Anomalie } from '../src/gen/fictif.ts';
import { Etat } from '../src/model/journal.ts';

const d = genererDonneesFictives();
const etat = new Etat({ nomFichier: 'f', empreinteFichier: '', colonnes: d.tableau.colonnes, colonneId: 'id_menage', lignes: d.tableau.lignes });
const p = parametresParDefaut(d.tableau.colonnes);
const alertes = calculerAlertes(etat, p);
const menages = (c: Controle) => [...new Set(alertes.filter((a) => a.controle === c).flatMap((a) => a.menages))].sort();

describe('Outils de similarité', () => {
  it('distance de Levenshtein', () => {
    expect(distance('kitten', 'sitting')).toBe(3);
    expect(distance('abc', 'abc')).toBe(0);
    expect(distance('abcdef', 'x', 2)).toBe(3);
  });
  it('noms proches : accents, casse, ordre des mots', () => {
    expect(nomsProches('Mbala Marie', 'MARIE MBALA', 0)).toBe(true);
    expect(nomsProches('Nzuzi Josée', 'Nzuzzi Josee', 1)).toBe(true);
    expect(nomsProches('Mbala Marie', 'Kiala Paul', 2)).toBe(false);
  });
  it('téléphones : 9 derniers chiffres', () => {
    expect(normaliserTelephone('+243 81 234 5678')).toBe(normaliserTelephone('0812345678'));
    expect(normaliserTelephone('123')).toBe('');
  });
  it('dates sans fuseau lues en UTC', () => {
    expect(lireDate('2026-09-12T10:00:00')).toBe(Date.UTC(2026, 8, 12, 10));
    expect(lireDate('2026-09-12T10:00:00.000+01:00')).toBe(Date.UTC(2026, 8, 12, 9));
    expect(lireDate('')).toBeUndefined();
  });
});

describe('Détection des colonnes Kobo', () => {
  it('retrouve les colonnes du jeu fictif', () => {
    expect(detecterColonnes(d.tableau.colonnes)).toEqual({
      debut: 'start',
      fin: 'end',
      soumission: '_submission_time',
      enqueteur: 'enqueteur',
      telephone: 'telephone',
      nom: 'nom_chef_menage',
      village: 'village',
      enfantNonAccompagne: 'enfant_non_accompagne',
      ageChef: 'age_chef_menage',
    });
  });
  it('lit le dernier segment des groupes Kobo', () => {
    expect(detecterColonnes(['identification/age_chef', 'identification/nom_chef_menage', 'menage/taille_menage'])).toEqual({
      ageChef: 'identification/age_chef',
      nom: 'identification/nom_chef_menage',
    });
  });
});

describe('Contrôles sur les anomalies plantées (rappel et précision)', () => {
  const cas: [Controle, Anomalie][] = [
    ['duree_courte', 'entretien_court'],
    ['horodatage', 'horodatage_incoherent'],
    ['doublon_telephone', 'doublon_telephone'],
    ['doublon_nom', 'doublon_nom'],
    ['enfant_non_accompagne', 'enfant_non_accompagne'],
  ];
  for (const [controle, anomalie] of cas) {
    it(`${controle} retrouve exactement les ménages plantés`, () => {
      expect(menages(controle)).toEqual(d.verite[anomalie]);
    });
  }
  it('les doublons sont regroupés par paires', () => {
    expect(alertes.filter((a) => a.controle === 'doublon_telephone').every((a) => a.menages.length === 2)).toBe(true);
  });
  it('signale les enquêteurs suspects, et eux seuls', () => {
    const signales = alertes.filter((a) => a.controle === 'enqueteur_atypique').map((a) => a.id.split(':')[1]);
    expect(signales.sort()).toEqual([...d.enqueteursSuspects].sort());
  });
  it('chef de ménage mineur : uniquement parmi les cas de protection plantés', () => {
    const mineurs = menages('chef_mineur');
    expect(mineurs.length).toBeGreaterThan(0);
    expect(mineurs.every((m) => d.verite.enfant_non_accompagne.includes(m))).toBe(true);
    expect(alertes.filter((a) => a.controle === 'chef_mineur').every((a) => a.categorie === 'protection')).toBe(true);
  });
  it('les identifiants d’alerte sont stables et uniques', () => {
    expect(new Set(alertes.map((a) => a.id)).size).toBe(alertes.length);
    expect(calculerAlertes(etat, p).map((a) => a.id)).toEqual(alertes.map((a) => a.id));
  });
  it('le seuil de durée est paramétrable', () => {
    const plusStrict = calculerAlertes(etat, { ...p, seuilDureeMinutes: 13 });
    expect(plusStrict.filter((a) => a.controle === 'duree_courte').length).toBeGreaterThan(menages('duree_courte').length);
  });
  it('une colonne non renseignée désactive le contrôle', () => {
    const sansTel = calculerAlertes(etat, { ...p, colonnes: { ...p.colonnes, telephone: undefined } });
    expect(sansTel.some((a) => a.controle === 'doublon_telephone')).toBe(false);
  });
});
