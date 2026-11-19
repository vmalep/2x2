/** Outils XML minimaux : échappement et décodage des entités. */

export function echapperXml(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Caractères de contrôle interdits en XML 1.0 (sauf tabulation et retours à la ligne).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export function decoderEntites(texte: string): string {
  return texte.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    switch (e) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default:
        return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }
  });
}

/** Valeur d'un attribut dans une balise ouvrante, ou undefined. */
export function attribut(balise: string, nom: string): string | undefined {
  const m = new RegExp(`\\s${nom}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(balise);
  return m ? decoderEntites(m[2] ?? m[3]) : undefined;
}
