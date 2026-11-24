import { describe, expect, it } from 'vitest';
import { CHAMP_STATUT, MOTIFS, MOTIFS_CORRECTION, MOTIFS_EXCLUSION, MOTIFS_REINTEGRATION, motifsPour } from '../src/model/types.ts';

describe('motifs', () => {
  it('propose des motifs propres à chaque type de changement', () => {
    expect(motifsPour('taille_menage', '5')).toBe(MOTIFS_CORRECTION);
    expect(motifsPour(CHAMP_STATUT, 'inclus')).toBe(MOTIFS_EXCLUSION);
    expect(motifsPour(CHAMP_STATUT, 'exclu')).toBe(MOTIFS_REINTEGRATION);
  });

  it('n’exclut pas pour une simple vérification ou une suspicion', () => {
    expect(MOTIFS_EXCLUSION).not.toContain('Vérification terrain');
    expect(MOTIFS_EXCLUSION).not.toContain('Fraude suspectée');
    expect(MOTIFS_EXCLUSION).toContain('Fraude avérée');
  });

  it('accepte toujours les motifs des listes existantes', () => {
    for (const m of ['Erreur de saisie', 'Vérification terrain', 'Doublon', 'Fraude suspectée', 'Changement de situation', 'Autre (préciser en commentaire)']) {
      expect(MOTIFS).toContain(m);
    }
  });
});
