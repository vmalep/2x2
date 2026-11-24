import { beforeAll, describe, expect, it } from 'vitest';
import { calculerAlertes } from '../src/controles/controles.ts';
import { reglesParDefaut } from '../src/controles/regles.ts';
import { sha256Hex } from '../src/crypto/empreinte.ts';
import { genererDonneesFictives } from '../src/gen/fictif.ts';
import { lireXlsx } from '../src/io/xlsx.ts';
import { lireZip } from '../src/io/zip.ts';
import { ecrireOds } from '../src/io/ods.ts';
import { blocages, exporter, tableauListeFinale, verifierFichierExporte } from '../src/model/export.ts';
import { corriger, creerListe, decider, deciderAlerte, fixerParametres, signerRegles, verifierListe, type Etat } from '../src/model/journal.ts';
import { confronterRecu, creerRecu, lireRecu, recuEnTexte } from '../src/model/recu.ts';
import { CHAMP_STATUT, type Liste } from '../src/model/types.ts';
import { personne } from './aides.ts';

type P = Awaited<ReturnType<typeof personne>>;
let resp: P, a: P, b: P;
beforeAll(async () => {
  [resp, a, b] = await Promise.all([
    personne('Responsable', ['responsable', 'validation']),
    personne('A', ['correction']),
    personne('B', ['validation']),
  ]);
});

async function listeFictive(): Promise<{ liste: Liste; etat: Etat }> {
  const { tableau } = genererDonneesFictives({ menages: 60, graine: 7 });
  return creerListe(
    { nomFichier: 'fictif.xlsx', empreinteFichier: 'e'.repeat(64), colonnes: tableau.colonnes, colonneId: 'id_menage', lignes: tableau.lignes },
    resp.identite,
    [resp.utilisateur, a.utilisateur, b.utilisateur],
  );
}

describe('Exclusion d’un ménage (quatre yeux)', () => {
  it('passe par une proposition puis une validation', async () => {
    const { liste, etat } = await listeFictive();
    expect(etat.valeur('MN-0003', CHAMP_STATUT)).toBe('inclus');
    await corriger(liste, etat, a.identite, { menage: 'MN-0003', champ: CHAMP_STATUT, ancienne: 'inclus', nouvelle: 'exclu', motif: 'Fraude suspectée', commentaire: 'Ménage fictif' });
    expect(etat.estExclu('MN-0003')).toBe(false);
    await decider(liste, etat, b.identite, { correction: 1, decision: 'acceptee', commentaire: '' });
    expect(etat.estExclu('MN-0003')).toBe(true);
    expect(tableauListeFinale(etat).lignes).toHaveLength(59);
    expect((await verifierListe(liste)).valide).toBe(true);
  });
  it('refuse un statut inconnu', async () => {
    const { liste, etat } = await listeFictive();
    await expect(
      corriger(liste, etat, a.identite, { menage: 'MN-0003', champ: CHAMP_STATUT, ancienne: 'inclus', nouvelle: 'supprimé', motif: 'Doublon', commentaire: '' }),
    ).rejects.toThrow(/Statut/);
  });
});

describe('Paramètres et décisions d’alerte', () => {
  it('seul un responsable signe des règles ; elles sont contrôlées à l’ajout et à l’ouverture', async () => {
    const { liste, etat } = await listeFictive();
    const regles = reglesParDefaut(liste.original.colonnes);
    const source = { nomFichier: 'regles.xlsx', empreinteFichier: 'a'.repeat(64) };
    await expect(signerRegles(liste, etat, a.identite, { regles, source })).rejects.toThrow(/responsable/);
    const fausses = regles.map((r) => (r.nom === 'duree_courte' ? { ...r, colonne: 'inexistante' } : r));
    await expect(signerRegles(liste, etat, resp.identite, { regles: fausses, source })).rejects.toThrow(/inconnue/);
    const plusStrictes = regles.map((r) => (r.nom === 'duree_courte' ? { ...r, min: '8' } : r));
    await signerRegles(liste, etat, resp.identite, { regles: plusStrictes, source });
    const v = await verifierListe(liste);
    expect(v.valide).toBe(true);
    expect(v.etat.reglesCourantes().find((r) => r.nom === 'duree_courte')?.min).toBe('8');
    expect(calculerAlertes(v.etat, v.etat.reglesCourantes()).filter((x) => x.controle === 'duree_courte').length).toBeGreaterThanOrEqual(
      calculerAlertes(etat, regles).filter((x) => x.controle === 'duree_courte').length,
    );
  });
  it('les anciens paramètres des listes existantes sont convertis en règles équivalentes', async () => {
    const { liste, etat } = await listeFictive();
    const anciens = {
      colonnes: { debut: 'start', fin: 'end', enqueteur: 'enqueteur', telephone: 'telephone' },
      seuilDureeMinutes: 7,
      dureeMaxHeures: 3,
      partCourtsEnqueteur: 0.2,
      minEntretiensEnqueteur: 5,
      distanceNoms: 2,
    };
    await fixerParametres(liste, etat, resp.identite, anciens);
    const v = await verifierListe(liste);
    expect(v.valide).toBe(true);
    const regles = v.etat.reglesCourantes();
    expect(regles.find((r) => r.nom === 'duree_courte')?.min).toBe('7');
    expect(regles.some((r) => r.nom === 'doublon_nom')).toBe(false);
  });
  it('décision signée, révisable, avec règles de rôle et de commentaire', async () => {
    const { liste, etat } = await listeFictive();
    const alertes = calculerAlertes(etat, reglesParDefaut(liste.original.colonnes));
    const al = alertes.find((x) => x.categorie === 'integrite')!;
    const base = { alerte: al.id, categorie: al.categorie, menages: al.menages, commentaire: '' };
    await expect(deciderAlerte(liste, etat, a.identite, { ...base, decision: 'faux_positif' })).rejects.toThrow(/rôle/);
    await expect(deciderAlerte(liste, etat, b.identite, { ...base, decision: 'orientee' })).rejects.toThrow(/non reconnue/);
    await expect(deciderAlerte(liste, etat, b.identite, { ...base, decision: 'faux_positif' })).rejects.toThrow(/motivé/);
    await deciderAlerte(liste, etat, b.identite, { ...base, decision: 'verification_terrain' });
    await deciderAlerte(liste, etat, b.identite, { ...base, decision: 'confirmee', commentaire: 'Confirmé sur place' });
    expect(etat.decisionsAlertes.get(al.id)?.contenu.decision).toBe('confirmee');
    expect((await verifierListe(liste)).valide).toBe(true);
  });
});

describe('Export', () => {
  it('liste finale verrouillée tant qu’il reste des corrections ou des alertes sans décision', async () => {
    const { liste, etat } = await listeFictive();
    let alertes = calculerAlertes(etat, reglesParDefaut(liste.original.colonnes));
    expect(alertes.length).toBeGreaterThan(0);
    await expect(exporter(liste, etat, alertes, resp.identite, 'liste', 'csv')).rejects.toThrow(/alerte/);
    // Le rapport, lui, reste disponible.
    await exporter(liste, etat, alertes, resp.identite, 'rapport', 'xlsx');

    for (const al of alertes) {
      await deciderAlerte(liste, etat, b.identite, { alerte: al.id, categorie: al.categorie, menages: al.menages, decision: 'verification_terrain', commentaire: '' });
    }
    await corriger(liste, etat, a.identite, { menage: 'MN-0001', champ: 'taille_menage', ancienne: etat.valeur('MN-0001', 'taille_menage')!, nouvelle: '99', motif: 'Erreur de saisie', commentaire: '' });
    alertes = calculerAlertes(etat, reglesParDefaut(liste.original.colonnes));
    expect(blocages(etat, alertes)).toEqual({ correctionsEnAttente: 1, alertesSansDecision: 0 });
    await expect(exporter(liste, etat, alertes, resp.identite, 'liste', 'csv')).rejects.toThrow(/en attente/);
    await expect(exporter(liste, etat, alertes, a.identite, 'rapport', 'xlsx')).rejects.toThrow(/responsable/);
    await decider(liste, etat, b.identite, { correction: liste.journal.length - 1, decision: 'acceptee', commentaire: '' });

    const n = liste.journal.length;
    const derniere = liste.journal.at(-1)!.empreinte;
    const f = await exporter(liste, etat, alertes, resp.identite, 'liste', 'xlsx');
    const entree = liste.journal.at(-1)!;
    expect(entree.type).toBe('export');
    if (entree.type !== 'export') return;
    expect(entree.contenu.lignesJournal).toBe(n);
    expect(entree.contenu.empreinteJournal).toBe(derniere);
    expect(entree.contenu.empreinteFichier).toBe(await sha256Hex(f.octets));

    const lu = await lireXlsx(f.octets);
    expect(lu.lignes).toHaveLength(60);
    expect(lu.lignes[0][lu.colonnes.indexOf('taille_menage')]).toBe('99');

    expect((await verifierFichierExporte(etat, f.octets)).entree?.n).toBe(entree.n);
    const retouche = f.octets.slice();
    retouche[retouche.length - 30] ^= 1;
    expect((await verifierFichierExporte(etat, retouche)).entree).toBeUndefined();

    const v = await verifierListe(liste);
    expect(v.erreurs).toEqual([]);
    expect(v.etat.exports).toHaveLength(2);
  });

  it('ODS : archive valide (mimetype en premier, non compressé) et contenu échappé', async () => {
    const ods = await ecrireOds([{ nom: 'Feuille <1>', tableau: { colonnes: ['a', 'b'], lignes: [['x & y', '  deux  espaces\nligne 2'], ['', 'z']] } }]);
    expect(new TextDecoder().decode(ods.slice(30, 38))).toBe('mimetype');
    expect(new TextDecoder().decode(ods.slice(38, 84))).toBe('application/vnd.oasis.opendocument.spreadsheet');
    const fichiers = await lireZip(ods);
    const contenu = new TextDecoder().decode(fichiers.get('content.xml'));
    expect(contenu).toContain('table:name="Feuille &lt;1&gt;"');
    expect(contenu).toContain('<text:p>x &amp; y</text:p>');
    expect(contenu).toContain('<text:p><text:s text:c="2"/>deux <text:s/>espaces</text:p><text:p>ligne 2</text:p>');
    expect(fichiers.has('META-INF/manifest.xml')).toBe(true);
  });
});

describe('Reçus de validation', () => {
  it('conforme, puis lignes ajoutées depuis', async () => {
    const { liste, etat } = await listeFictive();
    const recu = lireRecu(recuEnTexte(await creerRecu(liste, b.identite)));
    expect(await confronterRecu(liste, etat.utilisateurs, recu)).toMatchObject({ statut: 'conforme', lignesAjoutees: 0 });
    await corriger(liste, etat, a.identite, { menage: 'MN-0001', champ: 'village', ancienne: etat.valeur('MN-0001', 'village')!, nouvelle: 'X', motif: 'Erreur de saisie', commentaire: '' });
    expect(await confronterRecu(liste, etat.utilisateurs, recu)).toMatchObject({ statut: 'conforme', lignesAjoutees: 1 });
  });
  it('détecte la suppression des dernières lignes (limite de la chaîne seule)', async () => {
    const { liste, etat } = await listeFictive();
    await corriger(liste, etat, a.identite, { menage: 'MN-0001', champ: 'village', ancienne: etat.valeur('MN-0001', 'village')!, nouvelle: 'X', motif: 'Erreur de saisie', commentaire: '' });
    await decider(liste, etat, b.identite, { correction: 1, decision: 'refusee', commentaire: 'Non' });
    const recu = await creerRecu(liste, b.identite);
    const tronquee = structuredClone(liste);
    tronquee.journal.splice(2);
    expect((await verifierListe(tronquee)).valide).toBe(true); // la chaîne seule ne voit rien…
    expect(await confronterRecu(tronquee, etat.utilisateurs, recu)).toMatchObject({ statut: 'tronque', manquantes: 1 }); // …le reçu, si.
  });
  it('détecte un journal divergent, une autre liste, un reçu falsifié ou d’un inconnu', async () => {
    const { liste, etat } = await listeFictive();
    const recu = await creerRecu(liste, b.identite);
    expect((await confronterRecu(liste, etat.utilisateurs, { ...recu, lignes: 2 })).statut).toBe('signature_invalide');
    const autre = await listeFictive();
    expect((await confronterRecu(autre.liste, etat.utilisateurs, recu)).statut).toBe('autre_liste');
    const divergente = structuredClone(liste);
    divergente.journal[0] = { ...divergente.journal[0] };
    const recuMilieu = await creerRecu(liste, b.identite);
    await corriger(liste, etat, a.identite, { menage: 'MN-0002', champ: 'village', ancienne: etat.valeur('MN-0002', 'village')!, nouvelle: 'Y', motif: 'Erreur de saisie', commentaire: '' });
    const recuApres = await creerRecu(liste, b.identite);
    const branche = structuredClone(liste);
    branche.journal[1] = { ...branche.journal[1], empreinte: 'f'.repeat(64) };
    expect((await confronterRecu(branche, etat.utilisateurs, recuApres)).statut).toBe('divergent');
    expect((await confronterRecu(liste, etat.utilisateurs, recuMilieu)).statut).toBe('conforme');
    const inconnu = await personne('Inconnu', ['validation']);
    expect((await confronterRecu(liste, etat.utilisateurs, await creerRecu(liste, inconnu.identite))).statut).toBe('auteur_inconnu');
  });
  it('lit un code coupé sur plusieurs lignes par une messagerie', async () => {
    const { liste } = await listeFictive();
    const texte = recuEnTexte(await creerRecu(liste, b.identite));
    const coupe = texte.replace(/(Code : 2X2-RECU-1\.)(.{40})(.{40})/, '$1$2\n$3 ');
    expect(lireRecu(coupe)).toEqual(lireRecu(texte));
    expect(() => lireRecu('bonjour')).toThrow(/Aucun code/);
  });
});
