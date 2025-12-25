(() => {
  const state = {
    files: [], // {id, file, processed, rowEl}
    mode: 'shrink',
    targetKB: 500,
  };

  const qs = (sel) => document.querySelector(sel);
  const fileListEl = qs('#fileList');
  const dropZone = qs('#dropZone');
  const fileInput = qs('#fileInput');
  const sizeSlider = qs('#sizeSlider');
  const sizeNumber = qs('#sizeNumber');
  const sizeUnit = qs('.unit');
  const modeShrinkBtn = qs('#modeShrink');
  const modeBoostBtn = qs('#modeBoost');
  const processBtn = qs('#processBtn');
  const downloadBtn = qs('#downloadBtn');
  const resetBtn = qs('#resetBtn');
  const progressBar = qs('#progressBar');
  const progressText = qs('#progressText');
  const statsCard = qs('#statsCard');
  const originalTotalEl = qs('#originalTotal');
  const processedTotalEl = qs('#processedTotal');
  const changeValueEl = qs('#changeValue');
  const originalPreview = qs('#originalPreview');
  const processedPreview = qs('#processedPreview');
  const originalMeta = qs('#originalMeta');
  const processedMeta = qs('#processedMeta');
  const badge = qs('#fileBadge');
  const themeToggle = qs('#themeToggle');
  let attentionTimeout = null;

  const startProcessAttention = (durationMs = 8000) => {
    if (attentionTimeout) clearTimeout(attentionTimeout);
    processBtn.classList.add('attention');
    attentionTimeout = setTimeout(() => {
      processBtn.classList.remove('attention');
      attentionTimeout = null;
    }, durationMs);
  };

  const stopProcessAttention = () => {
    if (attentionTimeout) {
      clearTimeout(attentionTimeout);
      attentionTimeout = null;
    }
    processBtn.classList.remove('attention');
  };

  const fileRowTemplate = document.getElementById('fileRowTemplate');

  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
  const getRangeConfig = (mode) => {
    if (mode === 'boost') {
      return { minKB: 1024, maxKB: 1048576, stepKB: 1024, unitLabel: 'KB (1MB-1GB)' };
    }
    return { minKB: 1, maxKB: 1024, stepKB: 1, unitLabel: 'KB (1-1024 KB)' };
  };
  const formatBytes = (bytes) => {
    if (!bytes) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const size = bytes / Math.pow(1024, exponent);
    return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[exponent]}`;
  };

  const resetPreviews = () => {
    originalPreview.innerHTML = '<div class="placeholder">No file yet</div>';
    processedPreview.innerHTML = '<div class="placeholder">Process to view</div>';
    originalMeta.textContent = '—';
    processedMeta.textContent = '—';
    badge.textContent = 'No file';
  };

  const updateMode = (mode) => {
    state.mode = mode;
    modeShrinkBtn.classList.toggle('active', mode === 'shrink');
    modeBoostBtn.classList.toggle('active', mode === 'boost');
    modeShrinkBtn.setAttribute('aria-pressed', mode === 'shrink');
    modeBoostBtn.setAttribute('aria-pressed', mode === 'boost');
    configureRangeForMode(mode);
  };

  const updateTarget = (kb, rangeOverride) => {
    const { minKB, maxKB } = rangeOverride || getRangeConfig(state.mode);
    const clamped = clamp(kb, minKB, maxKB);
    state.targetKB = clamped;
    sizeSlider.value = clamped;
    sizeNumber.value = clamped;
  };

  const configureRangeForMode = (mode) => {
    const cfg = getRangeConfig(mode);
    sizeSlider.min = cfg.minKB;
    sizeSlider.max = cfg.maxKB;
    sizeSlider.step = cfg.stepKB;
    sizeNumber.min = cfg.minKB;
    sizeNumber.max = cfg.maxKB;
    sizeUnit.textContent = cfg.unitLabel;
    updateTarget(state.targetKB, cfg);
  };

  const clearState = () => {
    state.files.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    state.files = [];
    fileListEl.innerHTML = '';
    progressBar.style.width = '0%';
    progressText.textContent = 'Waiting to start';
    downloadBtn.disabled = true;
    statsCard.hidden = true;
    resetPreviews();
    stopProcessAttention();
  };

  const renderFileRow = (entry) => {
    const clone = fileRowTemplate.content.firstElementChild.cloneNode(true);
    clone.dataset.id = entry.id;
    clone.querySelector('[data-type]').textContent = entry.file.type.split('/')[1]?.toUpperCase() || 'FILE';
    clone.querySelector('[data-name]').textContent = entry.file.name;
    clone.querySelector('[data-meta]').textContent = `${formatBytes(entry.file.size)} • ${entry.file.type || 'unknown'}`;
    clone.querySelector('[data-status]').textContent = 'Waiting';
    const downloadBtn = clone.querySelector('[data-download]');
    downloadBtn.addEventListener('click', () => triggerDownload(entry));
    const cancelBtn = clone.querySelector('[data-cancel]');
    cancelBtn.addEventListener('click', () => cancelEntry(entry.id));
    entry.rowEl = clone;
    fileListEl.appendChild(clone);
  };

  const setRowStatus = (entry, text) => {
    const statusEl = entry.rowEl?.querySelector('[data-status]');
    if (statusEl) statusEl.textContent = text;
  };

  const setRowDownloadable = (entry, enabled) => {
    const btn = entry.rowEl?.querySelector('[data-download]');
    if (btn) btn.disabled = !enabled;
  };

  const cancelEntry = (id) => {
    const idx = state.files.findIndex((f) => f.id === id);
    if (idx === -1) return;
    const entry = state.files[idx];
    entry.cancelled = true;
    setRowStatus(entry, 'Cancelled');
    entry.rowEl?.remove();
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    state.files.splice(idx, 1);

    if (!state.files.length) {
      stopProcessAttention();
      resetPreviews();
      statsCard.hidden = true;
      downloadBtn.disabled = true;
      progressText.textContent = 'Waiting to start';
      progressBar.style.width = '0%';
    } else {
      // If the first item was removed, update preview badge/meta to the new first.
      renderOriginalPreview(state.files[0].file);
    }
  };

  const renderOriginalPreview = (file) => {
    badge.textContent = file.name;
    originalPreview.innerHTML = '';
    const url = URL.createObjectURL(file);
    const type = file.type || '';
    let node;
    if (type.startsWith('image/')) {
      node = document.createElement('img');
      node.src = url;
      node.alt = 'Original image preview';
    } else if (type.startsWith('video/')) {
      node = document.createElement('video');
      node.src = url;
      node.controls = true;
    } else if (type.startsWith('audio/')) {
      node = document.createElement('audio');
      node.src = url;
      node.controls = true;
    } else if (type === 'application/pdf') {
      node = document.createElement('iframe');
      node.src = url;
      node.title = 'PDF preview';
    } else {
      node = document.createElement('div');
      node.className = 'placeholder';
      node.textContent = 'Preview not available';
    }
    originalPreview.appendChild(node);
    originalMeta.textContent = `${file.type || 'unknown'} • ${formatBytes(file.size)}`;
    return url;
  };

  const renderProcessedPreview = (entry) => {
    processedPreview.innerHTML = '';
    if (!entry.processed) {
      processedPreview.innerHTML = '<div class="placeholder">Process to view</div>';
      processedMeta.textContent = '—';
      return;
    }
    const { blob, previewUrl } = entry.processed;
    const type = blob.type || entry.file.type || '';
    let node;
    if (type.startsWith('image/')) {
      node = document.createElement('img');
      node.src = previewUrl;
      node.alt = 'Processed image preview';
    } else if (type.startsWith('video/')) {
      node = document.createElement('video');
      node.src = previewUrl;
      node.controls = true;
    } else if (type.startsWith('audio/')) {
      node = document.createElement('audio');
      node.src = previewUrl;
      node.controls = true;
    } else if (type === 'application/pdf') {
      node = document.createElement('iframe');
      node.src = previewUrl;
      node.title = 'Processed PDF preview';
    } else {
      node = document.createElement('div');
      node.className = 'placeholder';
      node.textContent = 'Preview not available';
    }
    processedPreview.appendChild(node);
    processedMeta.textContent = `${type || 'unknown'} • ${formatBytes(blob.size)}`;
  };

  const updateStats = () => {
    if (!state.files.length) {
      statsCard.hidden = true;
      return;
    }
    const originalSum = state.files.reduce((acc, f) => acc + f.file.size, 0);
    const processedSum = state.files.reduce((acc, f) => acc + (f.processed?.blob.size || 0), 0);
    if (!processedSum) {
      statsCard.hidden = true;
      return;
    }
    statsCard.hidden = false;
    originalTotalEl.textContent = formatBytes(originalSum);
    processedTotalEl.textContent = formatBytes(processedSum);
    const delta = processedSum - originalSum;
    const percent = ((delta) / originalSum) * 100;
    const sign = percent >= 0 ? '+' : '';
    changeValueEl.textContent = `${sign}${percent.toFixed(1)}%`;
  };

  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!state.files.length && files.length) resetPreviews();
    files.forEach((file) => {
      const entry = { id: crypto.randomUUID(), file, processed: null, previewUrl: null };
      state.files.push(entry);
      renderFileRow(entry);
    });
    renderOriginalPreview(state.files[0].file);
    // Nudge the user toward processing after files arrive.
    startProcessAttention();
  };

  const loadImageBitmap = (file) => new Promise((resolve, reject) => {
    createImageBitmap(file).then(resolve).catch(reject);
  });

  const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Failed to create blob'));
      else resolve(blob);
    }, type, quality);
  });

  // Image optimization with binary search on quality and optional scale adjustments.
  const optimizeImage = async (file, targetBytes, mode) => {
    const bitmap = await loadImageBitmap(file);
    const maxDim = 2400;
    const clampDim = (value) => Math.min(value, maxDim);

    const baseScale = () => {
      if (mode === 'shrink' && targetBytes < file.size) {
        return clamp(Math.sqrt(targetBytes / file.size) * 1.05, 0.25, 1);
      }
      if (mode === 'boost' && targetBytes > file.size) {
        return clamp(Math.sqrt(targetBytes / file.size), 0.8, 1.6);
      }
      return 1;
    };

    let scale = baseScale();
    let lastBlob = file;
    let lastQuality = 0.9;

    for (let attempt = 0; attempt < 6; attempt++) {
      const width = clampDim(Math.round(bitmap.width * scale));
      const height = clampDim(Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, width, height);

      let low = 0.25;
      let high = 0.95;
      let blob = null;
      let qualityUsed = high;

      for (let i = 0; i < 8; i++) {
        const mid = (low + high) / 2;
        const candidate = await canvasToBlob(canvas, 'image/webp', mid);
        if (candidate.size > targetBytes * 1.05) {
          high = mid;
        } else {
          low = mid;
        }
        blob = candidate;
        qualityUsed = mid;
      }

      lastBlob = blob;
      lastQuality = qualityUsed;
      const withinTarget = Math.abs(blob.size - targetBytes) / targetBytes < 0.08;
      if (withinTarget) break;
      if (blob.size > targetBytes && scale > 0.35) {
        scale *= 0.88;
      } else if (blob.size < targetBytes && mode === 'boost' && scale < 1.6) {
        scale *= 1.1;
      } else {
        break;
      }
    }

    // Optional padding to hit target when boosting.
    let finalBlob = lastBlob;
    if (mode === 'boost' && targetBytes > finalBlob.size) {
      const pad = targetBytes - finalBlob.size;
      const padding = new Uint8Array(pad).fill(0);
      finalBlob = new Blob([finalBlob, padding], { type: finalBlob.type || 'image/webp' });
    }

    const previewUrl = URL.createObjectURL(finalBlob);
    return { blob: finalBlob, detail: `Scale ${(scale * 100).toFixed(0)}% • q${lastQuality.toFixed(2)}`, previewUrl };
  };

  const gzipIfAvailable = async (file) => {
    if (!('CompressionStream' in window)) return null;
    const compressed = file.stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(compressed).blob();
  };

  const optimizeBinary = async (file, targetBytes, mode) => {
    if (mode === 'shrink') {
      const gz = await gzipIfAvailable(file);
      if (gz) {
        const sized = gz.size > targetBytes ? gz.slice(0, targetBytes) : gz;
        return { blob: sized, detail: 'Gzip in-browser', previewUrl: URL.createObjectURL(sized) };
      }
      const sliced = file.size > targetBytes ? file.slice(0, targetBytes) : file;
      return { blob: sliced, detail: 'Trim fallback', previewUrl: URL.createObjectURL(sliced) };
    }
    // Boosting non-images: pad to target size to hit requested weight.
    if (targetBytes > file.size) {
      const pad = targetBytes - file.size;
      const padding = new Uint8Array(pad).fill(0);
      const padded = new Blob([file, padding], { type: file.type || 'application/octet-stream' });
      return { blob: padded, detail: 'Padded to target', previewUrl: URL.createObjectURL(padded) };
    }
    return { blob: file, detail: 'Original retained', previewUrl: URL.createObjectURL(file) };
  };

  const processEntry = async (entry, index, total) => {
    setRowStatus(entry, 'Processing…');
    const targetBytes = state.targetKB * 1024;
    progressText.textContent = `Processing ${index + 1}/${total}: ${entry.file.name}`;

    try {
      if (entry.cancelled) {
        setRowStatus(entry, 'Cancelled');
        return;
      }
      let result;
      if (entry.file.type.startsWith('image/')) {
        result = await optimizeImage(entry.file, targetBytes, state.mode);
      } else {
        result = await optimizeBinary(entry.file, targetBytes, state.mode);
      }
      if (entry.cancelled) {
        setRowStatus(entry, 'Cancelled');
        return;
      }
      entry.processed = result;
      setRowStatus(entry, `Done • ${formatBytes(result.blob.size)}`);
      setRowDownloadable(entry, true);
      // Refresh preview for the first file only for clarity.
      if (state.files[0].id === entry.id) {
        renderProcessedPreview(entry);
      }
    } catch (err) {
      console.error(err);
      setRowStatus(entry, 'Failed');
    }
  };

  const processAll = async () => {
    if (!state.files.length) {
      progressText.textContent = 'Add files first.';
      return;
    }
    downloadBtn.disabled = true;
    progressBar.style.width = '4%';
    const entries = [...state.files];
    for (let i = 0; i < entries.length; i++) {
      await processEntry(entries[i], i, entries.length);
      const pct = Math.round(((i + 1) / state.files.length) * 100);
      progressBar.style.width = `${pct}%`;
    }
    progressText.textContent = 'Processing complete';
    downloadBtn.disabled = false;
    updateStats();
  };

  const triggerDownload = (entry) => {
    if (!entry.processed) return;
    const { blob } = entry.processed;
    const a = document.createElement('a');
    const ext = blob.type.startsWith('image/') ? '.webp' : entry.file.name.endsWith('.gz') ? '' : (state.mode === 'shrink' && !blob.type.startsWith('image/')) ? '.gz' : '';
    a.download = entry.file.name + ext;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const downloadAll = () => {
    if (!state.files.length) return;
    state.files.forEach((entry, idx) => {
      if (!entry.processed) return;
      setTimeout(() => triggerDownload(entry), idx * 150);
    });
  };

  const handleThemeToggle = () => {
    const isDark = document.body.classList.toggle('theme-dark');
    themeToggle.querySelector('.icon').textContent = isDark ? '🌙' : '🌗';
  };

  // Event wiring
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('active');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('active');
    handleFiles(e.dataTransfer.files);
  });

  document.addEventListener('paste', (e) => {
    if (e.clipboardData?.files?.length) {
      handleFiles(e.clipboardData.files);
    }
  });

  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

  sizeSlider.addEventListener('input', (e) => updateTarget(Number(e.target.value)));
  sizeNumber.addEventListener('input', (e) => updateTarget(Number(e.target.value)));

  modeShrinkBtn.addEventListener('click', () => updateMode('shrink'));
  modeBoostBtn.addEventListener('click', () => updateMode('boost'));

  processBtn.addEventListener('click', () => { stopProcessAttention(); processAll(); });
  downloadBtn.addEventListener('click', downloadAll);
  resetBtn.addEventListener('click', clearState);
  themeToggle.addEventListener('click', handleThemeToggle);

  // Initial state
  updateMode('shrink');
  updateTarget(state.targetKB);
})();
