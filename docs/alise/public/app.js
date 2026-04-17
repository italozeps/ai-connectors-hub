const fileInput = document.getElementById('fileInput');
const fileLabel = document.getElementById('fileLabel');
const fileName = document.getElementById('fileName');
const readBtn = document.getElementById('readBtn');
const status = document.getElementById('status');
const audioPlayer = document.getElementById('audioPlayer');
const downloadBtn = document.getElementById('downloadBtn');

// Faila izvēle
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) {
    fileName.textContent = file.name;
    fileLabel.classList.add('has-file');
    readBtn.disabled = false;
    hideStatus();
    audioPlayer.classList.add('hidden');
    downloadBtn.classList.add('hidden');
  }
});

// Lasīšanas poga
readBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  setStatus('Apstrādā failu...', 'info');
  readBtn.disabled = true;
  readBtn.classList.add('loading');
  readBtn.textContent = '⏳ Apstrādā...';
  audioPlayer.classList.add('hidden');

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/read', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Nezināma kļūda');
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);

    audioPlayer.src = audioUrl;
    audioPlayer.classList.remove('hidden');
    audioPlayer.play();

    downloadBtn.href = audioUrl;
    downloadBtn.download = `alise-${file.name.replace(/\.[^.]+$/, '')}.mp3`;
    downloadBtn.classList.remove('hidden');

    setStatus('Alise lasa...', 'success');
  } catch (err) {
    setStatus(`Kļūda: ${err.message}`, 'error');
  } finally {
    readBtn.disabled = false;
    readBtn.classList.remove('loading');
    readBtn.textContent = '▶ Lasīt';
  }
});

function setStatus(msg, type) {
  status.textContent = msg;
  status.className = `status ${type}`;
}

function hideStatus() {
  status.className = 'status hidden';
}
