import { readdirSync, readFileSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { calculerAlertes } from '../src/controles/controles.ts';
import { reglesParDefaut, TYPES_REGLES } from '../src/controles/regles.ts';
import { genererDonneesFictives } from '../src/gen/fictif.ts';
import { en } from '../src/i18n/en.ts';
import { fr } from '../src/i18n/fr.ts';
import { definirLangue, formater, langueInitiale, libelles, t, tl } from '../src/i18n/index.ts';
import { Etat } from '../src/model/journal.ts';
import { DECISIONS_ALERTE, LIBELLES_ROLES, MOTIFS, libelleMotif } from '../src/model/types.ts';

afterEach(() => definirLangue('fr'));

/** Paramètres d'un texte : {nom} et {nom|…|…}. */
const parametres = (s: string) => [...new Set([...s.matchAll(/\{(\w+)(?:\|[^}]*)?\}/g)].map((m) => m[1]))].sort();
/** Mise en forme : nombre de ** et de `. */
const marques = (s: string) => [(s.match(/\*\*/g) ?? []).length, (s.match(/`/g) ?? []).length];

describe('Dictionnaires', () => {
  it('le français et l’anglais ont exactement les mêmes clés', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });
  it('aucun texte vide', () => {
    for (const d of [fr, en]) for (const [k, v] of Object.entries(d)) expect(v.trim(), k).not.toBe('');
  });
  it('mêmes paramètres, même mise en forme et même nombre de lignes dans les deux langues', () => {
    for (const k of Object.keys(fr) as (keyof typeof fr)[]) {
      expect(parametres(en[k]), k).toEqual(parametres(fr[k]));
      expect(marques(en[k]), k).toEqual(marques(fr[k]));
      expect(en[k].split('\n').length, k).toBe(fr[k].split('\n').length);
    }
  });
  it('chaque clé utilisée dans le code existe (t, tr, tl et libellés)', () => {
    const fichiers = listerSources('src');
    const manquantes: string[] = [];
    for (const f of fichiers) {
      const code = readFileSync(f, 'utf8');
      for (const m of code.matchAll(/\b(?:t|tr|tl\(\w+,)\s*\(?\s*'([a-z_]+\.[a-z0-9_.]+)'/g)) if (!(m[1] in fr)) manquantes.push(`${f}: ${m[1]}`);
      for (const m of code.matchAll(/: '([a-z_]+\.[a-z0-9_.]+)'/g)) if (/^(role|motif|decision|journal|nav|nature|validation|retours|correction)\./.test(m[1]) && !(m[1] in fr)) manquantes.push(`${f}: ${m[1]}`);
    }
    expect(manquantes).toEqual([]);
  });
  it('clés construites : chaque type de règle et chaque section d’aide a ses textes', () => {
    for (const type of Object.keys(TYPES_REGLES)) for (const k of ['libelle', 'aide']) expect(`regle_type.${type}.${k}` in fr, type).toBe(true);
    const aide = readFileSync('src/ui/ecrans/aide.ts', 'utf8');
    for (const [, id] of aide.matchAll(/\{ id: '(\w+)'/g)) expect(`aide.${id}.titre` in fr, id).toBe(true);
  });
});

function listerSources(dossier: string): string[] {
  return readdirSync(dossier).flatMap((n) => {
    const c = `${dossier}/${n}`;
    return statSync(c).isDirectory() ? listerSources(c) : c.endsWith('.ts') ? [c] : [];
  });
}

describe('Traduction', () => {
  it('paramètres et pluriels selon la langue', () => {
    expect(formater('{n} ménage{n||s}', { n: 0 }, 'fr')).toBe('0 ménage');
    expect(formater('{n} household{n||s}', { n: 0 }, 'en')).toBe('0 households');
    expect(formater('{n} ménage{n||s}', { n: 2 }, 'fr')).toBe('2 ménages');
    expect(formater('{n} household{n||s}', { n: 1 }, 'en')).toBe('1 household');
    expect(formater('Bonjour {nom}', {}, 'fr')).toBe('Bonjour {nom}');
  });
  it('t() suit la langue choisie, tl() force une langue ; la mise en forme est retirée', () => {
    expect(t('nav.journal')).toBe('Journal');
    definirLangue('en');
    expect(t('nav.journal')).toBe('Log');
    expect(tl('fr', 'nav.journal')).toBe('Journal');
    expect(t('journal.derniere', { empreinte: 'ab' })).toBe('Last fingerprint: ab');
  });
  it('langue de départ : choix mémorisé, sinon navigateur, anglais pour une autre langue', () => {
    expect(langueInitiale('en', ['fr-FR'])).toBe('en');
    expect(langueInitiale(null, ['fr-BE', 'en'])).toBe('fr');
    expect(langueInitiale(null, ['de-DE', 'en-US'])).toBe('en');
    expect(langueInitiale(null, ['nl-BE'])).toBe('en');
    expect(langueInitiale('xx', [])).toBe('fr');
  });
  it('les tables de libellés sont lues dans la langue courante', () => {
    const l = libelles({ a: 'nav.journal' });
    expect(l.a).toBe('Journal');
    definirLangue('en');
    expect(l.a).toBe('Log');
    expect(LIBELLES_ROLES.responsable).toBe('Manager');
    expect(Object.keys(DECISIONS_ALERTE.integrite)).toEqual(['confirmee', 'verification_terrain', 'faux_positif']);
    expect(DECISIONS_ALERTE.integrite.confirmee).toBe('Anomaly confirmed');
  });
});

describe('Données signées : codes stables, traduits seulement à l’affichage', () => {
  it('les motifs restent les codes français du journal, chacun a un libellé dans les deux langues', () => {
    expect(MOTIFS).toContain('Erreur de saisie');
    definirLangue('en');
    expect(libelleMotif('Erreur de saisie')).toBe('Data entry error');
    for (const m of MOTIFS) expect(libelleMotif(m)).not.toBe(m);
    expect(libelleMotif('Motif inconnu')).toBe('Motif inconnu');
    definirLangue('fr');
    for (const m of MOTIFS) expect(libelleMotif(m)).toBe(m);
  });
  it('règles par défaut : libellé dans la langue choisie, mêmes noms, mêmes identifiants d’alerte', () => {
    const d = genererDonneesFictives();
    const etat = new Etat({ nomFichier: 'f', empreinteFichier: '', colonnes: d.tableau.colonnes, colonneId: 'id_menage', lignes: d.tableau.lignes });
    const rFr = reglesParDefaut(d.tableau.colonnes, d.tableau.lignes);
    const aFr = calculerAlertes(etat, etat.reglesCourantes());
    definirLangue('en');
    const rEn = reglesParDefaut(d.tableau.colonnes, d.tableau.lignes);
    const aEn = calculerAlertes(etat, etat.reglesCourantes());
    expect(rEn.map((r) => r.nom)).toEqual(rFr.map((r) => r.nom));
    expect(rEn.find((r) => r.nom === 'doublon_identifiant')!.libelle).toBe('Duplicate identity document');
    expect(rFr.find((r) => r.nom === 'doublon_identifiant')!.libelle).toBe('Pièce d’identité en double');
    expect(aEn.map((a) => a.id)).toEqual(aFr.map((a) => a.id));
    expect(aEn.find((a) => a.controle === 'doublon_identifiant')!.libelle).toBe('Duplicate identity document');
    expect(aEn.find((a) => a.controle === 'doublon_telephone')!.message).toMatch(/households share the number/);
  });
});
