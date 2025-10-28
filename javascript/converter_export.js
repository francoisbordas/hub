/* converter_export.js
   Fonctions auxiliaires pour export (copier/télécharger) — les handlers principaux
   sont déjà câblés dans converter_ui.js mais on met ici quelques utilitaires
   réutilisables si tu veux étendre l'export (ZIP, choix du format, etc.)
*/

(function(){
  // retourne un blob et lance le téléchargement (utilitaire)
  function downloadText(filename, text) {
    const blob = new Blob([text], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // Expose utilitaires
  window.ConverterExport = {
    downloadText
  };
})();
