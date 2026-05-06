export function enforcePreviewSandbox(iframe: HTMLIFrameElement) {
  const desired = 'allow-scripts allow-forms allow-modals';
  const existing = iframe.getAttribute('sandbox') || '';
  if (existing.indexOf('allow-same-origin') > -1 || existing !== desired) {
    console.warn('Incorrect sandbox attribute detected. Forcing secure sandbox.');
    iframe.setAttribute('sandbox', desired);
  }
}

export async function updatePreviewControlContrast(previewContainer: HTMLElement) {
  previewContainer.classList.remove('light-preview');
}
