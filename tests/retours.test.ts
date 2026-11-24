import { describe, expect, it } from 'vitest';
import { calculerAlertes } from '../src/controles/controles.ts';
import { reglesParDefaut } from '../src/controles/regles.ts';
import { genererDonneesFictives } from '../src/gen/fictif.ts';
import { lireXlsx } from '../src/io/xlsx.ts';
import { ecrireXlsx } from '../src/io/xlsx.ts';
import { Etat } from '../src/model/journal.ts';
import { formulaireRevisite, lireRetours } from '../src/model/retours.ts';
import { nomKobo, tableauPrechargementKobo } from '../src/model/visite.ts';

const d = genererDonneesFictives();
const etat = new Etat({ nomFichier: 'f', empreinteFichier: '', colonnes: d.tableau.colonnes, colonneId: 'id_menage', lignes: d.tableau.lignes });
const alertes = calculerAlertes(etat, reglesParDefaut(d.tableau.colonnes));
const gps = (id: string) => etat.valeur(id, 'gps') ?? '';
const [court1, court2, court3, court4] = d.verite.entretien_court;

describe('Retours du terrain', () => {
  it('le formulaire de revisite est un XLSForm complet', async () => {
    const f = formulaireRevisite(['taille_menage', 'telephone']);
    expect(f.map((x) => x.nom)).toEqual(['survey', 'choices', 'settings']);
    const survey = f[0].tableau;
    const calcul = survey.colonnes.indexOf('calculation');
    expect(survey.lignes.find((l) => l[1] === 'menage')![0]).toBe('select_one_from_file menages_a_revoir.csv');
    expect(survey.lignes.find((l) => l[1] === 'a_verifier')![calcul]).toContain("pulldata('menages_a_revoir'");
    expect(survey.lignes.find((l) => l[1] === 'infos')![calcul]).toContain("'infos', 'name'");
    expect(f[1].tableau.lignes.filter((l) => l[0] === 'champs').map((l) => l[1])).toEqual(['taille_menage', 'telephone']);
    const relu = await lireXlsx(await ecrireXlsx(f));
    expect(relu.colonnes[0]).toBe('type');
  });

  it('formulaire multilingue : libellés, aides et choix en français et en anglais', () => {
    const [survey, choices, settings] = formulaireRevisite(['taille_menage']);
    expect(survey.tableau.colonnes).toEqual(['type', 'name', 'label::Français (fr)', 'label::English (en)', 'hint::Français (fr)', 'hint::English (en)', 'required', 'relevant', 'appearance', 'calculation']);
    expect(survey.tableau.lignes.find((l) => l[1] === 'trouve')!.slice(2, 4)).toEqual(['Le ménage a-t-il été trouvé ?', 'Was the household found?']);
    expect(survey.tableau.lignes.find((l) => l[1] === 'gps_visite')![5]).toMatch(/dwelling/);
    expect(choices.tableau.colonnes).toEqual(['list_name', 'name', 'label::Français (fr)', 'label::English (en)']);
    expect(choices.tableau.lignes.find((l) => l[1] === 'menage_parti_ou_dissous')).toEqual(['motif_exclusion', 'menage_parti_ou_dissous', 'Ménage parti ou dissous', 'Household moved away or dissolved']);
    expect(settings.tableau.lignes[0][3]).toBe('Français (fr)');
    // Aucune cellule de libellé vide pour les questions affichées.
    for (const l of survey.tableau.lignes) if (!['start', 'end', 'today', 'calculate'].includes(l[0])) expect(l[2] && l[3], l[1]).toBeTruthy();
  });

  it('lit un export Kobo « avec libellés » en anglais', () => {
    const colonnes = ['today', 'Household to revisit', 'Was the household found?', 'Result of the check', 'Field to correct', 'Observed value', 'Reason for the exclusion', 'Finding (what was seen or said)', 'Position of the visit', '_Position of the visit_latitude', 'Name of the visiting person'];
    const lignes = [
      ['2026-11-23', court1, 'No (not found or non-existent)', '', '', '', '', 'Unknown', gps(court1), '', 'Peter'],
      ['2026-11-23', court2, 'Yes', 'The household must be excluded', '', '', 'Household moved away or dissolved', 'Left', gps(court2), '', 'Peter'],
      ['2026-11-23', court3, 'Yes', 'A piece of data is wrong (to correct)', 'taille_menage', '8', '', 'Counted', gps(court3), '', 'Peter'],
    ];
    const r = lireRetours({ colonnes, lignes }, etat, alertes, 'gps');
    expect(r.erreurs).toEqual([]);
    expect(r.actions.find((a) => a.menage === court1 && a.nature === 'exclusion')?.motif).toBe('Ménage introuvable ou inexistant');
    expect(r.actions.find((a) => a.menage === court2 && a.nature === 'exclusion')?.motif).toBe('Ménage parti ou dissous');
    expect(r.actions.find((a) => a.menage === court3 && a.nature === 'correction')).toMatchObject({ champ: 'taille_menage', nouvelle: '8' });
  });

  it('préchargement : nom, étiquette, colonnes choisies', () => {
    const t = tableauPrechargementKobo(etat, { ids: [court1], colonnes: ['nom_chef_menage', 'village'], aVerifier: new Map([[court1, 'Entretien court']]) });
    expect(t.colonnes).toEqual(['name', 'label', 'infos', 'nom_chef_menage', 'village', 'a_verifier']);
    expect(t.lignes[0][0]).toBe(court1);
    // L'étiquette permet de reconnaître le ménage dans la liste de choix.
    expect(t.lignes[0][1]).toBe(`${court1} – ${etat.valeur(court1, 'nom_chef_menage')} – ${etat.valeur(court1, 'village')}`);
    expect(t.lignes[0][2]).toBe(`nom_chef_menage : ${etat.valeur(court1, 'nom_chef_menage')} · village : ${etat.valeur(court1, 'village')}`);
    expect(nomKobo('Âge du chef')).toBe('age_du_chef');
  });

  it('lit aussi un export Kobo « avec libellés » (choix par défaut de Kobo)', () => {
    const colonnes = ['today', 'Ménage à revoir', 'Le ménage a-t-il été trouvé ?', 'Résultat de la vérification', 'Champ à corriger', 'Valeur constatée', 'Motif de l’exclusion', 'Constat (ce qui a été vu ou dit)', 'Position de la visite', '_Position de la visite_latitude', 'Nom de la personne qui visite'];
    const lignes = [
      ['2026-11-23', court1, 'Non (introuvable ou inexistant)', '', '', '', '', 'Inconnu', gps(court1), '', 'Pierre'],
      ['2026-11-23', court2, 'Oui', 'Le ménage doit être exclu', '', '', 'Ménage parti ou dissous', 'Parti', gps(court2), '', 'Pierre'],
      ['2026-11-23', court3, 'Oui', 'Une donnée est fausse (à corriger)', 'taille_menage', '8', '', 'Compté', gps(court3), '', 'Pierre'],
    ];
    const r = lireRetours({ colonnes, lignes }, etat, alertes, 'gps');
    expect(r.erreurs).toEqual([]);
    expect(r.actions.find((a) => a.menage === court1 && a.nature === 'exclusion')?.motif).toBe('Ménage introuvable ou inexistant');
    expect(r.actions.find((a) => a.menage === court2 && a.nature === 'exclusion')?.motif).toBe('Ménage parti ou dissous');
    expect(r.actions.find((a) => a.menage === court3 && a.nature === 'correction')).toMatchObject({ champ: 'taille_menage', nouvelle: '8' });
  });

  it('refuse une liste de visite remplie à la main, avec une explication', () => {
    const r = lireRetours({ colonnes: ['id_menage', 'nom_chef_menage', 'À vérifier', 'Ménage trouvé (oui/non)', 'Constat'], lignes: [[court1, 'X', '…', 'oui', 'valide']] }, etat, alertes, 'gps');
    expect(r.actions).toEqual([]);
    expect(r.erreurs[0]).toMatch(/liste de visite.*ne se réimporte pas/);
  });

  it('étiquette Kobo choisie : colonnes dans l’ordre demandé', () => {
    const t = tableauPrechargementKobo(etat, { ids: [court1], colonnes: ['telephone', 'territoire'], etiquette: ['territoire', 'telephone'], aVerifier: new Map() });
    expect(t.lignes[0][1]).toBe(`${court1} – ${etat.valeur(court1, 'territoire')} – ${etat.valeur(court1, 'telephone')}`);
  });

  it('liste Kobo triée selon les colonnes de l’étiquette, dans l’ordre choisi', () => {
    const ids = d.verite.entretien_court;
    const t = tableauPrechargementKobo(etat, { ids, colonnes: ['village', 'nom_chef_menage'], etiquette: ['village', 'nom_chef_menage'], aVerifier: new Map() });
    const cles = t.lignes.map((l) => `${etat.valeur(l[0], 'village')}|${etat.valeur(l[0], 'nom_chef_menage')}`);
    expect(cles).toEqual([...cles].sort(new Intl.Collator('fr', { numeric: true, sensitivity: 'base' }).compare));
    expect(t.lignes).toHaveLength(ids.length);
  });

  it('propose les actions correspondant aux réponses', () => {
    const colonnes = ['today', 'grp/menage', 'trouve', 'resultat', 'champ', 'valeur', 'motif_exclusion', 'constat', 'gps_visite', 'visiteur'];
    const lignes = [
      ['2026-10-02', court1, 'oui', 'conforme', '', '', '', 'Entretien bien fait, ménage confirmé', gps(court1), 'Agent A'],
      ['2026-10-02', court2, 'oui', 'donnee_fausse', 'taille_menage', '99', '', 'Compté sur place', gps(court2), 'Agent A'],
      ['2026-10-02', court3, 'non', '', '', '', '', 'Personne ne connaît ce ménage', gps(court3), 'Agent B'],
      ['2026-10-02', court4, 'oui', 'a_exclure', '', '', 'menage_parti_ou_dissous', 'Parti en septembre', '-4.9 18.9 0 5', 'Agent B'],
      ['2026-10-02', 'XX-0000', 'oui', 'conforme', '', '', '', '', '', ''],
    ];
    const r = lireRetours({ colonnes, lignes }, etat, alertes, 'gps');
    expect(r.reponses).toBe(5);
    expect(r.erreurs.join()).toMatch(/XX-0000.*inconnu/);
    const pour = (m: string) => r.actions.filter((a) => a.menage === m);
    expect(pour(court1).every((a) => a.nature === 'decision' && a.decision === 'faux_positif')).toBe(true);
    expect(pour(court1)[0].commentaire).toMatch(/Visite terrain du 2026-10-02 \(Agent A\)/);
    expect(pour(court2).find((a) => a.nature === 'correction')).toMatchObject({ champ: 'taille_menage', nouvelle: '99', motif: 'Vérification terrain' });
    expect(pour(court3).find((a) => a.nature === 'exclusion')).toMatchObject({ nouvelle: 'exclu', motif: 'Ménage introuvable ou inexistant' });
    const exclu4 = pour(court4).find((a) => a.nature === 'exclusion')!;
    expect(exclu4.motif).toBe('Ménage parti ou dissous');
    // Visite enregistrée loin du ménage : à vérifier avant de la retenir.
    expect(exclu4.avertissement).toMatch(/km du ménage/);
    expect(pour(court1)[0].avertissement).toBeUndefined();
  });
});
