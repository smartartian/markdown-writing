function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Unable to read exported file'));
    reader.readAsDataURL(blob);
  });
}

export function createExportModule({
  getCurrentMd,
  getExportName,
  renderMarkdown,
  escapeHtml,
  saveExportFile = null,
}) {
  function createExportRoot() {
    const container = document.createElement('div');
    container.className = 'export-render-root';
    container.innerHTML = renderMarkdown(getCurrentMd());
    document.body.appendChild(container);
    return container;
  }

  async function renderExportCanvas() {
    const html2canvas = (await import('html2canvas')).default;
    const container = createExportRoot();
    try {
      return await html2canvas(container, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: 900,
      });
    } finally {
      container.remove();
    }
  }

  function canvasToBlob(canvas, type = 'image/png') {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Unable to create exported file'));
      }, type);
    });
  }

  async function saveBlob(blob, filename) {
    if (typeof saveExportFile === 'function') {
      const encoded = await blobToBase64(blob);
      const path = await saveExportFile(filename, encoded, 'base64');
      if (path === null) {
        downloadBlob(blob, filename);
        return { saved: true, browser: true };
      }
      return path ? { saved: true, path } : { canceled: true };
    }
    downloadBlob(blob, filename);
    return { saved: true, browser: true };
  }

  async function saveContent(content, filename, encoding = 'utf8', mime = 'text/plain;charset=utf-8') {
    if (typeof saveExportFile === 'function') {
      const path = await saveExportFile(filename, content, encoding);
      if (path === null) {
        downloadBlob(new Blob([content], { type: mime }), filename);
        return { saved: true, browser: true };
      }
      return path ? { saved: true, path } : { canceled: true };
    }
    downloadBlob(new Blob([content], { type: mime }), filename);
    return { saved: true, browser: true };
  }

  async function exportAsTxt() {
    const text = getCurrentMd()
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/^>\s+/gm, '')
      .replace(/^-{3,}/gm, '')
      .replace(/\n{3,}/g, '\n\n');
    return saveContent(text, getExportName('txt'), 'utf8', 'text/plain;charset=utf-8');
  }

  async function exportAsPng() {
    const canvas = await renderExportCanvas();
    const blob = await canvasToBlob(canvas);
    return saveBlob(blob, getExportName('png'));
  }

  async function exportAsPdf() {
    const [{ jsPDF }, canvas] = await Promise.all([
      import('jspdf'),
      renderExportCanvas(),
    ]);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const renderWidth = pageWidth - margin * 2;
    const renderHeight = canvas.height * renderWidth / canvas.width;
    const image = canvas.toDataURL('image/png', 0.95);
    let remainingHeight = renderHeight;
    let position = margin;

    pdf.addImage(image, 'PNG', margin, position, renderWidth, renderHeight);
    remainingHeight -= pageHeight - margin * 2;
    while (remainingHeight > 0) {
      position = margin - (renderHeight - remainingHeight);
      pdf.addPage();
      pdf.addImage(image, 'PNG', margin, position, renderWidth, renderHeight);
      remainingHeight -= pageHeight - margin * 2;
    }

    return saveBlob(pdf.output('blob'), getExportName('pdf'));
  }

  async function exportAsWordDocument() {
    const html = renderMarkdown(getCurrentMd());
    const name = getExportName('doc');
    const docHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
      <style>
        body { font-family: 'PingFang SC','Songti SC',Georgia,serif; font-size: 14px; line-height: 1.8; color: #2c2e33; padding: 40px 60px; }
        h1 { font-size: 22px; } h2 { font-size: 18px; } h3 { font-size: 16px; }
        pre { background: #f5f5f8; padding: 10px 14px; border: 1px solid #e2e2e6; }
        code { font-family: 'SF Mono',Menlo,monospace; }
        blockquote { border-left: 3px solid #5c89f2; padding-left: 14px; color: #5a5c62; }
        table { border-collapse: collapse; } th,td { border: 1px solid #e2e2e6; padding: 6px 10px; }
      </style></head>
      <body>${html}</body></html>`;
    return saveContent(docHtml, name, 'utf8', 'application/msword;charset=utf-8');
  }

  async function handleExport(format) {
    switch (format) {
      case 'txt': return exportAsTxt();
      case 'png': return exportAsPng();
      case 'pdf': return exportAsPdf();
      case 'docx': return exportAsWordDocument();
      default: throw new Error(`Unsupported export format: ${format}`);
    }
  }

  return { handleExport };
}
