import { describe, expect, it } from 'vitest';
import { chiffrerJson, dechiffrerJson, MotDePasseIncorrect } from '../src/crypto/chiffrement.ts';
import {
  clePubliqueEnTexte,
  deverrouillerIdentite,
  fichierClePublique,
  genererIdentite,
  lireFichierClePublique,
  signer,
  verifier,
} from '../src/crypto/cles.ts';
import { jsonCanonique } from '../src/crypto/encodage.ts';
import { sha256Hex } from '../src/crypto/empreinte.ts';
import { ITER } from './aides.ts';

describe('JSON canonique et empreintes', () => {
  it('ne dépend pas de l’ordre des clés', () => {
    expect(jsonCanonique({ b: 1, a: [2, { d: 'x', c: null }] })).toBe('{"a":[2,{"c":null,"d":"x"}],"b":1}');
    expect(jsonCanonique({ a: 1, b: 2 })).toBe(jsonCanonique({ b: 2, a: 1 }));
  });
  it('refuse les valeurs undefined', () => {
    expect(() => jsonCanonique({ a: undefined })).toThrow();
  });
  it('calcule le SHA-256 attendu', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('Chiffrement AES-GCM / PBKDF2', () => {
  const opts = { format: 'test', version: 1, iterations: ITER };
  it('chiffre et déchiffre', async () => {
    const env = await chiffrerJson({ secret: 'é' }, 'motdepasse', opts);
    expect(env.donnees).not.toContain('secret');
    expect(await dechiffrerJson(env, 'motdepasse', 'test')).toEqual({ secret: 'é' });
  });
  it('refuse un mauvais mot de passe', async () => {
    const env = await chiffrerJson({ a: 1 }, 'bon', opts);
    await expect(dechiffrerJson(env, 'mauvais', 'test')).rejects.toBeInstanceOf(MotDePasseIncorrect);
  });
  it('détecte une altération du contenu chiffré', async () => {
    const env = await chiffrerJson({ a: 1 }, 'bon', opts);
    const octets = atob(env.donnees);
    const altere = btoa(octets.slice(0, 5) + String.fromCharCode(octets.charCodeAt(5) ^ 1) + octets.slice(6));
    await expect(dechiffrerJson({ ...env, donnees: altere }, 'bon', 'test')).rejects.toBeInstanceOf(MotDePasseIncorrect);
  });
  it('détecte une altération de l’en-tête en clair', async () => {
    const env = await chiffrerJson({ a: 1 }, 'bon', { ...opts, public: { nom: 'A' } });
    await expect(dechiffrerJson({ ...env, public: { nom: 'B' } }, 'bon', 'test')).rejects.toBeInstanceOf(MotDePasseIncorrect);
  });
  it('refuse un nombre d’itérations trop faible', async () => {
    const env = await chiffrerJson({ a: 1 }, 'bon', opts);
    await expect(dechiffrerJson({ ...env, kdf: { ...env.kdf, iterations: 1000 } }, 'bon', 'test')).rejects.toThrow(/itérations/);
  });
  it('refuse un autre format', async () => {
    const env = await chiffrerJson({ a: 1 }, 'bon', opts);
    await expect(dechiffrerJson(env, 'bon', 'autre')).rejects.toThrow(/format/);
  });
});

describe('Clés personnelles et signatures', () => {
  it('génère, protège et déverrouille une identité', async () => {
    const { fichierCle, fichierPublic, identite } = await genererIdentite('  Alice  ', 'secret', ITER);
    expect(identite.nom).toBe('Alice');
    expect(JSON.stringify(fichierCle)).not.toContain('"d"'); // la clé privée JWK n'apparaît pas en clair
    const rouverte = await deverrouillerIdentite(fichierCle, 'secret');
    expect(rouverte.empreinte).toBe(fichierPublic.empreinte);
    await expect(deverrouillerIdentite(fichierCle, 'faux')).rejects.toBeInstanceOf(MotDePasseIncorrect);
  });
  it('signe et vérifie ; une autre clé ou un autre message échoue', async () => {
    const a = await genererIdentite('A', 'x', ITER);
    const b = await genererIdentite('B', 'x', ITER);
    const sig = await signer(a.identite.clePrivee, 'message');
    expect(await verifier(a.fichierPublic.cle, 'message', sig)).toBe(true);
    expect(await verifier(a.fichierPublic.cle, 'messagE', sig)).toBe(false);
    expect(await verifier(b.fichierPublic.cle, 'message', sig)).toBe(false);
  });
  it('lit un fichier de clé publique et refuse une empreinte falsifiée', async () => {
    const { fichierPublic } = await genererIdentite('A', 'x', ITER);
    expect((await lireFichierClePublique(JSON.stringify(fichierPublic))).nom).toBe('A');
    const faux = { ...fichierPublic, empreinte: '0'.repeat(64) };
    await expect(lireFichierClePublique(JSON.stringify(faux))).rejects.toThrow(/incohérente/);
  });
  it('transmet la clé publique en texte, même recoupé par une messagerie', async () => {
    const { fichierCle, fichierPublic } = await genererIdentite('Simon', 'x', ITER);
    const reconstruit = fichierClePublique(await deverrouillerIdentite(fichierCle, 'x'));
    expect(reconstruit).toEqual(fichierPublic);
    const texte = clePubliqueEnTexte(reconstruit);
    expect(texte).not.toContain('"d"');
    const coupe = texte.replace(/(2X2-CLE-1\.)(.{30})(.{30})/, '$1$2\n  $3');
    expect((await lireFichierClePublique(coupe)).empreinte).toBe(fichierPublic.empreinte);
    await expect(lireFichierClePublique(texte.slice(0, -20))).rejects.toThrow(/illisible/);
  });
});
