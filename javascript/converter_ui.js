/* converter_ui.js
   Gestion de l'UI : génération des paires de ports, drag&drop, paste, boutons
*/
document.addEventListener('DOMContentLoaded', () => {
  const inputType = document.getElementById('inputType');
  const portPairSelect = document.getElementById('portPairSelect');
  const btnParse = document.getElementById('btnParse');
  const btnClear = document.getElementById('btnClear');
  const inputLeft = document.getElementById('inputLeft');
  const previewBox = document.getElementById('previewBox');
  const outputBox = document.getElementById('outputBox');
  const status = document.getElementById('status');
  const btnCopy = document.getElementById('btnCopy');
  const btnDownload = document.getElementById('btnDownload');

  // Remplir les paires de ports au démarrage et à chaque changement du type d'entrée
  function populatePortPairs() {
    const val = inputType.value; // ex: 's7p'
    const n = parseInt(val.replace(/\D/g, ''), 10) || 2;
    portPairSelect.innerHTML = '';

    // Générer paires ordonnées (i -> j). Affiche "1 → 2"
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= n; j++) {
        if (i === j) continue;
        const opt = document.createElement('option');
        opt.value = `${i}-${j}`;
        opt.textContent = `${i} → ${j}`;
        portPairSelect.appendChild(opt);
      }
    }
  }

  populatePortPairs();
  inputType.addEventListener('change', populatePortPairs);

  // Drag & Drop sur la textarea
  ['dragenter','dragover'].forEach(ev => {
    inputLeft.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      inputLeft.classList.add('dragover');
    });
  });
  ['dragleave','drop'].forEach(ev => {
    inputLeft.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      inputLeft.classList.remove('dragover');
    });
  });

  inputLeft.addEventListener('drop', async (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length) {
      const f = files[0];
      const text = await f.text();
      inputLeft.value = text;
      status.textContent = `Fichier collé : ${f.name}`;
    }
  });

  // Coller via clipboard (Ctrl+V)
  inputLeft.addEventListener('paste', (e) => {
    status.textContent = 'Collage détecté';
    // Le contenu sera déjà dans la textarea par le navigateur
  });

  // Clear button
  btnClear.addEventListener('click', () => {
    inputLeft.value = '';
    previewBox.innerHTML = '<div class="empty small-muted">Aucun fichier analysé</div>';
    outputBox.innerHTML = '<div class="empty small-muted">Aucun fichier converti</div>';
    status.textContent = '— prêt —';
  });

  // Convertir
  btnParse.addEventListener('click', () => {
    const raw = inputLeft.value.trim();
    if (!raw) {
      status.textContent = 'Erreur : aucune donnée en entrée.';
      return;
    }
    status.textContent = 'Conversion en cours...';
    try {
      const nPorts = parseInt(inputType.value.replace(/\D/g,''), 10) || 2;
      const pair = portPairSelect.value; // ex: '3-5'
      const [aStr,bStr] = pair.split('-');
      const a = parseInt(aStr,10);
      const b = parseInt(bStr,10);
      // Appel au coeur de conversion
      const result = window.ConverterCore.convertTouchstoneToS2P(raw, nPorts, a, b);
      // Afficher aperçu (quelques lignes) et sortie complète
      previewBox.innerHTML = `<pre>${result.previewText}</pre>`;
      outputBox.innerHTML = `<pre id="outputPre">${result.s2pText}</pre>`;
      status.textContent = `Conversion terminée — ${result.dataPoints} points`;
    } catch (err) {
      console.error(err);
      status.textContent = `Erreur : ${err.message || err}`;
      previewBox.innerHTML = `<div class="empty small-muted">Erreur lors de l'analyse</div>`;
      outputBox.innerHTML = `<div class="empty small-muted">Aucun fichier converti</div>`;
    }
  });

  // Copier le s2p dans le presse-papier
  btnCopy.addEventListener('click', async () => {
    const pre = document.getElementById('outputPre');
    if (!pre) {
      status.textContent = 'Rien à copier.';
      return;
    }
    const text = pre.textContent;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copié dans le presse-papier ✔';
    } catch (e) {
      console.warn('clipboard failed', e);
      // fallback : sélectionner et prompt
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        status.textContent = 'Copié (fallback)';
      } catch (ex) {
        status.textContent = 'Échec du copier — ouvre une boîte pour récupérer le texte.';
        window.prompt('Copier le texte ci-dessous (Ctrl+C puis Entrée)', text);
      }
      document.body.removeChild(ta);
    }
  });

  // Télécharger .s2p
  btnDownload.addEventListener('click', () => {
    const pre = document.getElementById('outputPre');
    if (!pre) {
      status.textContent = 'Rien à télécharger.';
      return;
    }
    const text = pre.textContent;
    const blob = new Blob([text], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const filename = `converted_${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}.s2p`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.textContent = `Téléchargement lancé (${filename})`;
  });

  // Exposer quelques fonctions globales utiles pour debug/test
  window.ConverterUI = {
    populatePortPairs,
  };
});
