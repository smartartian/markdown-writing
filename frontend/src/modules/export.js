function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function createExportModule({ getCurrentMd, getExportName, renderMarkdown, escapeHtml }) {
  function exportAsMd() {
    const blob = new Blob([getCurrentMd()], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, getExportName('md'));
  }

  function exportAsTxt() {
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
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, getExportName('txt'));
  }

  async function exportAsPng() {
    const html = renderMarkdown(getCurrentMd());
    const container = document.createElement('div');
    container.innerHTML = html;
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;padding:48px;background:#fff;color:#2c2e33;font-family:Georgia,serif;font-size:16px;line-height:1.8;';
    document.body.appendChild(container);

    const height = Math.max(container.scrollHeight, 600);
    const svgData = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="' + height + '">'
      + '<foreignObject width="100%" height="100%">'
      + '<div xmlns="http://www.w3.org/1999/xhtml">' + container.innerHTML + '</div>'
      + '</foreignObject></svg>';
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        downloadBlob(blob, getExportName('png'));
        URL.revokeObjectURL(svgUrl);
        document.body.removeChild(container);
      }, 'image/png');
    };
    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      document.body.removeChild(container);
      alert('图片导出失败，请尝试其他格式');
    };
    image.src = svgUrl;
  }

  function exportAsPdf() {
    const html = renderMarkdown(getCurrentMd());
    const name = getExportName('pdf');
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('请允许弹出窗口以导出 PDF');
      return;
    }
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
      <style>
        body { font-family: 'PingFang SC','Songti SC',Georgia,serif; font-size: 16px; line-height: 1.8; color: #2c2e33; padding: 40px 60px; max-width: 780px; margin: 0 auto; }
        h1,h2,h3,h4,h5,h6 { color: #1a1c20; margin-top: 1.2em; margin-bottom: .5em; }
        pre { background: #f5f5f8; padding: 12px 16px; border-radius: 4px; overflow-x: auto; font-size: 13px; }
        code { font-family: 'SF Mono',Menlo,monospace; font-size: 13px; }
        blockquote { border-left: 3px solid #5c89f2; padding-left: 16px; color: #5a5c62; margin: 12px 0; }
        img { max-width: 100%; }
        table { border-collapse: collapse; width: 100%; margin: 12px 0; }
        th,td { border: 1px solid #e2e2e6; padding: 8px 12px; text-align: left; }
        @media print { body { padding: 0; } }
      </style></head>
      <body>${html}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 300);
  }

  function exportAsWordDocument() {
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
    downloadBlob(new Blob([docHtml], { type: 'application/msword;charset=utf-8' }), name);
  }

  function handleExport(format) {
    switch (format) {
      case 'md': exportAsMd(); break;
      case 'txt': exportAsTxt(); break;
      case 'png': void exportAsPng(); break;
      case 'pdf': exportAsPdf(); break;
      case 'docx': exportAsWordDocument(); break;
    }
  }

  return { handleExport };
}
