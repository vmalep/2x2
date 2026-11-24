import { describe, expect, it } from 'vitest';
import { calculerAlertes, lireDate } from '../src/controles/controles.ts';
import { exporterRegles, importerRegles } from '../src/controles/fichier-regles.ts';
import { detecterColonnes } from '../src/controles/parametres.ts';
import { reglesDepuisTableau, reglesParDefaut, tableauDepuisRegles, validerRegles, type Regle } from '../src/controles/regles.ts';
import { distance, nomsProches, normaliserTelephone } from '../src/controles/similarite.ts';
import { genererDonneesFictives, type Anomalie } from '../src/gen/fictif.ts';
import { lireOds } from '../src/io/ods.ts';
import { ecrireOds } from '../src/io/ods.ts';
import { Etat } from '../src/model/journal.ts';
import { CHAMP_STATUT } from '../src/model/types.ts';

const d = genererDonneesFictives();
const etat = new Etat({ nomFichier: 'f', empreinteFichier: '', colonnes: d.tableau.colonnes, colonneId: 'id_menage', lignes: d.tableau.lignes });
const regles = reglesParDefaut(d.tableau.colonnes, d.tableau.lignes);
const alertes = calculerAlertes(etat, regles);
const menages = (...noms: string[]) => [...new Set(alertes.filter((a) => noms.includes(a.controle)).flatMap((a) => a.menages))].sort();

/** Petite liste de test : colonnes et lignes libres, identifiant en première colonne. */
function petiteListe(colonnes: string[], lignes: string[][]) {
  return new Etat({ nomFichier: 'p', empreinteFichier: '', colonnes: ['id', ...colonnes], colonneId: 'id', lignes: lignes.map((l, i) => [`M${i + 1}`, ...l]) });
}
const regle = (r: Partial<Regle>): Regle => ({ nom: 'r', libelle: 'Règle', type: 'seuil', colonne: 'a', colonne2: '', min: '', max: '', liste: '', actif: true, ...r });
const signales = (e: Etat, r: Partial<Regle>) => [...new Set(calculerAlertes(e, [regle(r)]).flatMap((a) => a.menages))].sort();

describe('Outils de similarité', () => {
  it('distance de Levenshtein', () => {
    expect(distance('kitten', 'sitting')).toBe(3);
    expect(distance('abcdef', 'x', 2)).toBe(3);
  });
  it('noms proches : accents, casse, ordre des mots', () => {
    expect(nomsProches('Mbala Marie', 'MARIE MBALA', 0)).toBe(true);
    expect(nomsProches('Nzuzi Josée', 'Nzuzzi Josee', 1)).toBe(true);
    expect(nomsProches('Mbala Marie', 'Kiala Paul', 2)).toBe(false);
  });
  it('téléphones et dates', () => {
    expect(normaliserTelephone('+243 81 234 5678')).toBe(normaliserTelephone('0812345678'));
    expect(lireDate('2026-09-12T10:00:00')).toBe(Date.UTC(2026, 8, 12, 10));
    expect(lireDate('2026-09-12T10:00:00.000+01:00')).toBe(Date.UTC(2026, 8, 12, 9));
  });
});

describe('Règles par défaut', () => {
  it('détectent les colonnes Kobo, y compris dans les groupes', () => {
    expect(detecterColonnes(['identification/carte_electeur', 'identification/nom_chef_menage'])).toEqual({
      identifiant: 'identification/carte_electeur',
      nom: 'identification/nom_chef_menage',
    });
    expect(validerRegles(regles, d.tableau.colonnes)).toEqual([]);
    expect(regles.map((r) => r.nom)).toEqual([
      'duree_courte', 'duree_longue', 'fin_avant_debut', 'soumission_avant_fin', 'enqueteur_atypique', 'doublon_telephone', 'doublon_identifiant', 'doublon_nom',
      'gps_proches', 'gps_groupes', 'gps_hors_zone', 'lien_hote', 'hote_sans_heberge', 'heberge_sans_hote',
    ]);
  });
  const cas: [string[], Anomalie][] = [
    [['duree_courte'], 'entretien_court'],
    [['duree_longue', 'fin_avant_debut', 'soumission_avant_fin'], 'horodatage_incoherent'],
    [['doublon_telephone'], 'doublon_telephone'],
    [['doublon_nom'], 'doublon_nom'],
    [['doublon_identifiant'], 'doublon_identifiant'],
    [['gps_groupes'], 'gps_groupe'],
    [['gps_hors_zone'], 'gps_hors_zone'],
  ];
  for (const [noms, anomalie] of cas) {
    it(`${noms.join(' + ')} retrouvent exactement les ménages plantés`, () => {
      expect(menages(...noms)).toEqual(d.verite[anomalie]);
    });
  }
  it('GPS : les ménages trop proches sont parmi les entretiens groupés', () => {
    const proches = menages('gps_proches');
    expect(proches.length).toBeGreaterThan(0);
    expect(proches.every((m) => d.verite.gps_groupe.includes(m))).toBe(true);
  });
  it('liens hébergé → hôte : anomalies plantées retrouvées', () => {
    // Sans hôte valable : pas de code saisi, ou un code introuvable. Le lien saisi par l'hôte seul suffit.
    const sansHote = alertes.filter((a) => a.controle === 'heberge_sans_hote').map((a) => a.menages[0]).sort();
    expect(sansHote).toEqual([...d.verite.heberge_sans_hote, ...d.verite.lien_hote_introuvable].sort());
    for (const m of d.verite.lien_saisi_par_hote) expect(sansHote).not.toContain(m);
    expect(d.verite.lien_saisi_par_hote).toHaveLength(2);
    expect(alertes.filter((a) => a.controle === 'hote_sans_heberge').map((a) => a.menages[0]).sort()).toEqual(d.verite.hote_sans_heberge);
    const liens = alertes.filter((a) => a.controle === 'lien_hote' && !a.id.includes(':trop:'));
    const signalesLien = new Set(liens.map((a) => a.menages[0]));
    for (const m of [...d.verite.lien_hote_introuvable, ...d.verite.lien_hote_non_accueil, ...d.verite.lien_hote_eloigne]) expect(signalesLien.has(m)).toBe(true);
    // Autres signalements admis : ceux qui touchent un ménage dont le GPS est lui-même une anomalie plantée.
    const plantes = new Set([...d.verite.lien_hote_introuvable, ...d.verite.lien_hote_non_accueil, ...d.verite.lien_hote_eloigne]);
    const gps = new Set([...d.verite.gps_groupe, ...d.verite.gps_hors_zone]);
    expect(liens.every((a) => plantes.has(a.menages[0]) || a.menages.some((m) => gps.has(m)))).toBe(true);
  });
  it('signalent les enquêteurs suspects, et eux seuls', () => {
    const e = alertes.filter((a) => a.controle === 'enqueteur_atypique').map((a) => a.id.split(':')[1]);
    expect(e.sort()).toEqual([...d.enqueteursSuspects].sort());
  });
  it('identifiants d’alerte stables et uniques ; une règle inactive ne produit rien', () => {
    expect(new Set(alertes.map((a) => a.id)).size).toBe(alertes.length);
    const sansTel = calculerAlertes(etat, regles.map((r) => (r.nom === 'doublon_telephone' ? { ...r, actif: false } : r)));
    expect(sansTel.some((a) => a.controle === 'doublon_telephone')).toBe(false);
  });
});

describe('Chaque type de règle', () => {
  const e = petiteListe(
    ['a', 'debut', 'fin', 'statut', 'tel', 'piece', 'nom', 'village'],
    [
      ['5', '2026-09-01T10:00:00Z', '2026-09-01T10:03:00Z', 'deplace', '+243810000001', 'AB-12', 'Mbala Marie', 'V1'],
      ['abc', '2026-09-01T10:00:00Z', '2026-09-01T09:00:00Z', 'Déplacé', '0810000001', 'ab 12', 'Marie Mbala', 'V1'],
      ['50', '2026-10-15T10:00:00Z', '2026-10-15T10:30:00Z', '', '0999', '', 'Mbala Mariee', 'V2'],
      ['', '2026-09-20T10:00:00Z', '2026-09-20T10:20:00Z', 'famille_accueil', '+243820000000', 'CD-34', 'Kiala Paul', 'V1'],
    ],
  );
  it('seuil, obligatoire, valeurs, format', () => {
    expect(signales(e, { type: 'seuil', colonne: 'a', min: '10', max: '40' })).toEqual(['M1', 'M2', 'M3']);
    expect(signales(e, { type: 'obligatoire', colonne: 'statut' })).toEqual(['M3']);
    expect(signales(e, { type: 'valeurs', colonne: 'statut', liste: 'deplace ; famille_accueil' })).toEqual(['M2']);
    expect(signales(e, { type: 'format', colonne: 'tel', liste: '^\\+243[0-9]{9}$' })).toEqual(['M2', 'M3']);
  });
  it('durée, ordre des dates, période', () => {
    expect(signales(e, { type: 'duree', colonne: 'debut', colonne2: 'fin', min: '6' })).toEqual(['M1']);
    expect(signales(e, { type: 'duree', colonne: 'debut', colonne2: 'fin', max: '25' })).toEqual(['M3']);
    expect(signales(e, { type: 'ordre_dates', colonne: 'debut', colonne2: 'fin' })).toEqual(['M2']);
    expect(signales(e, { type: 'periode', colonne: 'debut', min: '2026-09-01', max: '2026-09-30' })).toEqual(['M3']);
  });
  it('lien, ménage sans ménage rattaché, valeur obligatoire sous condition', () => {
    const e = petiteListe(['statut', 'hote'], [
      ['accueil', ''], // M1 : hôte de M2 et M3
      ['deplace', 'M1'],
      ['deplace', 'M1'],
      ['accueil', ''], // M4 : n'héberge personne
      ['deplace', ''], // M5 : sans hôte
      ['deplace', 'M9'], // M6 : hôte introuvable
      ['deplace', 'M2'], // M7 : désigne un ménage qui n'est pas hôte
      ['deplace', 'M8'], // M8 : se désigne lui-même
    ]);
    expect(signales(e, { type: 'obligatoire_si', colonne: 'hote', liste: 'statut=deplace' })).toEqual(['M5']);
    expect(signales(e, { type: 'lien_requis', colonne: 'hote', liste: 'statut=accueil' })).toEqual(['M4']);
    expect(signales(e, { type: 'lien', colonne: 'hote', liste: 'statut=accueil' })).toEqual(['M2', 'M6', 'M7', 'M8']);
    // M1 désigné par 2 ménages : au-delà de min = 1, alerte sur M1.
    expect(signales(e, { type: 'lien', colonne: 'hote', min: '1' })).toContain('M1');
    // Les deux ménages hébergés par M1 sont exclus : M1 n'héberge plus personne de retenu.
    e.modifications.set('M2', new Map([[CHAMP_STATUT, 'exclu']]));
    e.modifications.set('M3', new Map([[CHAMP_STATUT, 'exclu']]));
    const requis = calculerAlertes(e, [regle({ type: 'lien_requis', colonne: 'hote', liste: 'statut=accueil' })]);
    expect(requis.map((a) => a.menages[0]).sort()).toEqual(['M1', 'M4']);
    expect(requis.find((a) => a.menages[0] === 'M1')!.message).toMatch(/2 ménages rattachés exclus/);
  });
  it('lien saisi dans un sens ou dans l’autre ; codes sans casse ni tiret ; contradictions', () => {
    const e = new Etat({
      nomFichier: 'p', empreinteFichier: '', colonneId: 'code',
      colonnes: ['code', 'statut', 'hote', 'heberges'],
      lignes: [
        ['K7M3-4FQA', 'accueil', '', '2cde-h9km 3DEF5HKM'], // hôte qui saisit ses hébergés (minuscules, sans tiret)
        ['2CDE-H9KM', 'heberge', '', ''], // hébergé : lien saisi seulement par l’hôte
        ['3DEF-5HKM', 'heberge', 'K7M3-4FQA', ''], // saisi des deux côtés
        ['4EFH-6KMA', 'heberge', '', ''], // aucun lien
        ['5FHK-7MAC', 'heberge', 'K7M3-4FQA', ''], // rattaché à deux hôtes : contradiction
        ['6HKM-8ACD', 'accueil', '', '5fhk-7mac XXXX-YYYY'], // code inconnu dans sa liste
      ],
    });
    const requis = (cond: string) => calculerAlertes(e, [regle({ type: 'lien_requis', colonne: 'hote', colonne2: 'heberges', liste: cond })]).map((a) => a.menages[0]);
    expect(requis('statut=heberge')).toEqual(['4EFH-6KMA']);
    const lien = calculerAlertes(e, [regle({ type: 'lien', colonne: 'hote', colonne2: 'heberges' })]);
    expect(lien.find((a) => a.menages[0] === '5FHK-7MAC')?.message).toMatch(/plusieurs ménages hôtes|plusieurs ménages/);
    expect(lien.find((a) => a.menages[0] === '6HKM-8ACD')?.message).toMatch(/« XXXX-YYYY » \(heberges\) est introuvable/);
  });
  it('refuse une condition mal écrite', () => {
    expect(validerRegles([regle({ type: 'lien_requis', colonne: 'a', liste: 'statut' })], ['id', 'a']).join()).toMatch(/condition colonne=valeur/);
    expect(validerRegles([regle({ type: 'obligatoire_si', colonne: 'a', liste: 'inconnue=x' })], ['id', 'a']).join()).toMatch(/colonne inconnue « inconnue »/);
  });
  it('doublons, téléphones, noms proches par groupe', () => {
    expect(signales(e, { type: 'doublon', colonne: 'piece' })).toEqual(['M1', 'M2']);
    expect(signales(e, { type: 'doublon_telephone', colonne: 'tel' })).toEqual(['M1', 'M2']);
    expect(signales(e, { type: 'noms_proches', colonne: 'nom', colonne2: 'village', max: '1' })).toEqual(['M1', 'M2']);
    expect(signales(e, { type: 'noms_proches', colonne: 'nom', max: '1' })).toEqual(['M1', 'M2', 'M3']);
  });
});

describe('Validation et fichier de règles', () => {
  const cols = d.tableau.colonnes;
  it('refuse noms, types, colonnes, nombres et motifs invalides', () => {
    const erreurs = validerRegles(
      [
        regle({ nom: 'Mauvais Nom', colonne: 'start' }),
        regle({ nom: 'x', type: 'inconnu' as never, colonne: 'start' }),
        regle({ nom: 'y', type: 'duree', colonne: 'start', colonne2: '', min: 'six' }),
        regle({ nom: 'z', type: 'format', colonne: 'telephone', liste: '([' }),
        regle({ nom: 'z', type: 'part_enqueteur', colonne: 'enqueteur', min: '0.2', liste: 'absente' }),
        regle({ nom: 'w', type: 'seuil', colonne: 'pas_une_colonne', min: '1' }),
      ],
      cols,
    );
    expect(erreurs.join('\n')).toMatch(/minuscules/);
    expect(erreurs.join('\n')).toMatch(/type inconnu/);
    expect(erreurs.join('\n')).toMatch(/colonne_2/);
    expect(erreurs.join('\n')).toMatch(/doit être un nombre/);
    expect(erreurs.join('\n')).toMatch(/motif invalide/);
    expect(erreurs.join('\n')).toMatch(/déjà utilisé/);
    expect(erreurs.join('\n')).toMatch(/autre règle/);
    expect(erreurs.join('\n')).toMatch(/colonne inconnue/);
  });
  it('aller-retour tableau ; en-têtes tolérants ; virgule décimale et pourcentage', () => {
    expect(reglesDepuisTableau(tableauDepuisRegles(regles)).regles).toEqual(regles);
    const lu = reglesDepuisTableau({
      colonnes: ['Actif', 'Nom', 'Libellé', 'Type', 'Colonne', 'Colonne 2', 'Min', 'Max', 'Liste'],
      lignes: [['non', 'taille', 'Taille', 'seuil', 'taille_menage', '', '1', '12,5', ''], ['', '', '', '', '', '', '', '', '']],
    });
    expect(lu.regles).toHaveLength(1);
    expect(lu.regles[0]).toMatchObject({ actif: false, libelle: 'Taille', max: '12,5' });
    expect(validerRegles(lu.regles, cols)).toEqual([]);
  });
  for (const format of ['xlsx', 'ods', 'csv'] as const) {
    it(`export puis import du fichier de règles (${format.toUpperCase()})`, async () => {
      const f = await exporterRegles(regles, cols, format);
      const lu = await importerRegles(f.octets, `regles.${format}`, cols);
      expect(lu.erreurs).toEqual([]);
      expect(lu.regles).toEqual(regles);
      expect(lu.empreinteFichier).toMatch(/^[0-9a-f]{64}$/);
    });
  }
  it('un fichier sans les colonnes attendues est refusé avec un message clair', async () => {
    const ods = await ecrireOds([{ nom: 'X', tableau: { colonnes: ['foo'], lignes: [['bar']] } }]);
    const lu = await importerRegles(ods, 'x.ods', cols);
    expect(lu.erreurs[0]).toMatch(/Colonne\(s\) manquante\(s\)/);
  });
  it('lecteur ODS : cellules répétées, espaces et retours à la ligne', async () => {
    const t = { colonnes: ['a', 'b', 'c'], lignes: [['x', '', 'z'], ['  deux  espaces', 'l1\nl2', '']] };
    expect(await lireOds(await ecrireOds([{ nom: 'F', tableau: t }]))).toEqual(t);
  });
});
