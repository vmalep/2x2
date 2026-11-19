import { beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/crypto/empreinte.ts';
import { chiffrerListe, dechiffrerListe } from '../src/model/fichier-liste.ts';
import { corriger, creerListe, decider, declarerUtilisateur, verifierListe, type Etat } from '../src/model/journal.ts';
import type { ContenuCorrection, Liste, Original } from '../src/model/types.ts';
import { ITER, personne } from './aides.ts';

type P = Awaited<ReturnType<typeof personne>>;
let resp: P, a: P, b: P, intrus: P;

beforeAll(async () => {
  [resp, a, b, intrus] = await Promise.all([
    personne('Responsable', ['responsable']),
    personne('A', ['correction']),
    personne('B', ['validation', 'correction']),
    personne('Intrus', ['correction', 'validation']),
  ]);
});

const original = (): Original => ({
  nomFichier: 'export.xlsx',
  empreinteFichier: 'f'.repeat(64),
  colonnes: ['id_menage', 'nom', 'taille'],
  colonneId: 'id_menage',
  lignes: [
    ['MN-0001', 'Mbala Marie', '4'],
    ['MN-0002', 'Ngoma Paul', '7'],
    ['MN-0003', 'Kiala Esther', '2'],
  ],
});

const correction = (c: Partial<ContenuCorrection> = {}): ContenuCorrection => ({
  menage: 'MN-0002',
  champ: 'taille',
  ancienne: '7',
  nouvelle: '5',
  motif: 'Vérification terrain',
  commentaire: '',
  ...c,
});

async function scenario(): Promise<{ liste: Liste; etat: Etat }> {
  const { liste, etat } = await creerListe(original(), resp.identite, [resp.utilisateur, a.utilisateur, b.utilisateur]);
  await corriger(liste, etat, a.identite, correction()); // n=1
  await corriger(liste, etat, a.identite, correction({ menage: 'MN-0001', champ: 'nom', ancienne: 'Mbala Marie', nouvelle: 'Mbala Mariette', motif: 'Erreur de saisie' })); // n=2
  await decider(liste, etat, b.identite, { correction: 1, decision: 'acceptee', commentaire: '' }); // n=3
  await decider(liste, etat, b.identite, { correction: 2, decision: 'refusee', commentaire: 'Nom confirmé par la carte' }); // n=4
  return { liste, etat };
}

const copie = (l: Liste): Liste => structuredClone(l);

describe('Circuit normal', () => {
  it('applique les corrections acceptées sans toucher à l’original', async () => {
    const { liste, etat } = await scenario();
    expect(etat.valeur('MN-0002', 'taille')).toBe('5');
    expect(etat.valeur('MN-0001', 'nom')).toBe('Mbala Marie');
    expect(liste.original.lignes[1][2]).toBe('7');
    expect(etat.enAttente()).toHaveLength(0);
    const v = await verifierListe(liste);
    expect(v.erreurs).toEqual([]);
    expect(v.valide).toBe(true);
    expect(v.etat.valeur('MN-0002', 'taille')).toBe('5');
  });

  it('chaque ligne est chaînée à la précédente', async () => {
    const { liste } = await scenario();
    for (let i = 1; i < liste.journal.length; i++) expect(liste.journal[i].precedente).toBe(liste.journal[i - 1].empreinte);
  });

  it('survit au chiffrement du fichier de liste', async () => {
    const { liste } = await scenario();
    const fichier = await chiffrerListe(liste, 'mot de passe liste', ITER);
    expect(fichier).not.toContain('Mbala');
    const relue = await dechiffrerListe(fichier, 'mot de passe liste');
    expect((await verifierListe(relue)).valide).toBe(true);
    await expect(dechiffrerListe(fichier, 'autre')).rejects.toThrow(/Mot de passe/);
  });
});

describe('Règles à l’ajout', () => {
  it('refuse la validation de sa propre correction (quatre yeux)', async () => {
    const { liste, etat } = await creerListe(original(), resp.identite, [resp.utilisateur, a.utilisateur, b.utilisateur]);
    await corriger(liste, etat, b.identite, correction());
    await expect(decider(liste, etat, b.identite, { correction: 1, decision: 'acceptee', commentaire: '' })).rejects.toThrow(/propre correction/);
    expect(liste.journal).toHaveLength(2);
  });
  it('refuse les rôles manquants, les auteurs inconnus et les incohérences', async () => {
    const { liste, etat } = await creerListe(original(), resp.identite, [resp.utilisateur, a.utilisateur, b.utilisateur]);
    await expect(corriger(liste, etat, resp.identite, correction())).rejects.toThrow(/rôle « Correction »/);
    await expect(corriger(liste, etat, intrus.identite, correction())).rejects.toThrow(/inconnu/);
    await expect(corriger(liste, etat, a.identite, correction({ ancienne: '8' }))).rejects.toThrow(/ancienne valeur/);
    await expect(corriger(liste, etat, a.identite, correction({ champ: 'id_menage', ancienne: 'MN-0002' }))).rejects.toThrow(/identifiant/);
    await expect(corriger(liste, etat, a.identite, correction({ motif: 'Autre (préciser en commentaire)' }))).rejects.toThrow(/commentaire/);
    await corriger(liste, etat, a.identite, correction());
    await expect(corriger(liste, etat, a.identite, correction({ nouvelle: '6' }))).rejects.toThrow(/déjà en attente/);
    await expect(decider(liste, etat, a.identite, { correction: 1, decision: 'acceptee', commentaire: '' })).rejects.toThrow(/Validation/);
    await expect(decider(liste, etat, b.identite, { correction: 1, decision: 'refusee', commentaire: ' ' })).rejects.toThrow(/motivé/);
    expect(liste.journal).toHaveLength(2);
  });
  it('un utilisateur déclaré en cours de route peut ensuite agir', async () => {
    const { liste, etat } = await creerListe(original(), resp.identite, [resp.utilisateur, a.utilisateur]);
    await expect(declarerUtilisateur(liste, etat, a.identite, b.utilisateur)).rejects.toThrow(/responsable/);
    await declarerUtilisateur(liste, etat, resp.identite, b.utilisateur);
    await corriger(liste, etat, a.identite, correction());
    await decider(liste, etat, b.identite, { correction: 2, decision: 'acceptee', commentaire: '' });
    expect((await verifierListe(liste)).valide).toBe(true);
  });
  it('refuse les identifiants de ménage en double ou vides', async () => {
    const o = original();
    o.lignes[2][0] = 'MN-0001';
    await expect(creerListe(o, resp.identite, [resp.utilisateur])).rejects.toThrow(/double/);
    o.lignes[2][0] = ' ';
    await expect(creerListe(o, resp.identite, [resp.utilisateur])).rejects.toThrow(/sans identifiant/);
  });
});

describe('Détection des altérations à l’ouverture', () => {
  it('modification d’une valeur au milieu du journal', async () => {
    const { liste } = await scenario();
    const l = copie(liste);
    (l.journal[1].contenu as ContenuCorrection).nouvelle = '9';
    const v = await verifierListe(l);
    expect(v.valide).toBe(false);
    expect(v.erreurs.map((e) => e.n)).toContain(1);
  });
  it('modification recalculant l’empreinte : la signature et la chaîne échouent', async () => {
    const { liste } = await scenario();
    const l = copie(liste);
    const e = l.journal[1];
    (e.contenu as ContenuCorrection).nouvelle = '9';
    const { signature, empreinte: _e, ...signee } = e;
    const { jsonCanonique } = await import('../src/crypto/encodage.ts');
    e.empreinte = await sha256Hex(jsonCanonique({ ...signee, signature }));
    const v = await verifierListe(l);
    expect(v.erreurs.some((x) => x.n === 1 && /Signature invalide/.test(x.message))).toBe(true);
    expect(v.erreurs.some((x) => x.n === 2 && /Chaîne/.test(x.message))).toBe(true);
  });
  it('suppression d’une ligne au milieu', async () => {
    const { liste } = await scenario();
    const l = copie(liste);
    l.journal.splice(2, 1);
    expect((await verifierListe(l)).valide).toBe(false);
  });
  it('réordonnancement', async () => {
    const { liste } = await scenario();
    const l = copie(liste);
    [l.journal[3], l.journal[4]] = [l.journal[4], l.journal[3]];
    expect((await verifierListe(l)).valide).toBe(false);
  });
  it('modification de l’original', async () => {
    const { liste } = await scenario();
    const l = copie(liste);
    l.original.lignes[0][1] = 'Autre nom';
    const v = await verifierListe(l);
    expect(v.erreurs.some((e) => /original/.test(e.message))).toBe(true);
  });
  it('auto-validation fabriquée hors de l’outil, correctement signée', async () => {
    const { liste, etat } = await creerListe(original(), resp.identite, [resp.utilisateur, a.utilisateur, b.utilisateur]);
    await corriger(liste, etat, b.identite, correction());
    // Contournement des contrôles d'ajout : on signe directement une décision de B sur sa propre correction.
    const { signer } = await import('../src/crypto/cles.ts');
    const { jsonCanonique } = await import('../src/crypto/encodage.ts');
    const signee = {
      type: 'decision' as const,
      contenu: { correction: 1, decision: 'acceptee' as const, commentaire: '' },
      n: 2,
      precedente: liste.journal[1].empreinte,
      le: new Date().toISOString(),
      auteur: b.utilisateur.empreinte,
    };
    const signature = await signer(b.identite.clePrivee, jsonCanonique(signee));
    liste.journal.push({ ...signee, signature, empreinte: await sha256Hex(jsonCanonique({ ...signee, signature })) });
    const v = await verifierListe(liste);
    expect(v.valide).toBe(false);
    expect(v.erreurs[0].message).toMatch(/propre correction/);
  });
  it('limite connue : la suppression des dernières lignes laisse une chaîne valide (d’où les reçus)', async () => {
    const { liste } = await scenario();
    const l = copie(liste);
    l.journal.splice(3);
    expect((await verifierListe(l)).valide).toBe(true);
  });
});
