function getColorBrightness(value: string): number | null {
  const color = value.trim().toLowerCase();
  const namedColors: Record<string, number> = {
    black: 0,
    white: 255,
    transparent: 255,
  };
  if (color in namedColors) return namedColors[color];

  const shortHex = color.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split('').map(part => parseInt(part + part, 16));
    return (r * 299 + g * 587 + b * 114) / 1000;
  }

  const longHex = color.match(/^#([0-9a-f]{6})$/i);
  if (longHex) {
    const hex = longHex[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }

  const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) {
    const [, r, g, b] = rgb;
    return (Number(r) * 299 + Number(g) * 587 + Number(b) * 114) / 1000;
  }

  return null;
}

function scorePreviewBrightness(source: string): number {
  let score = 0;
  const backgroundMatches = source.matchAll(/background(?:-color)?\s*:\s*([^;}{]+)/gi);

  for (const match of backgroundMatches) {
    const colors = match[1].match(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)|\b(?:white|black|transparent)\b/gi) || [];
    for (const color of colors) {
      const brightness = getColorBrightness(color);
      if (brightness === null) continue;
      if (brightness >= 185) score += 1;
      if (brightness <= 95) score -= 1;
    }
  }

  return score;
}

export function enforcePreviewSandbox(iframe: HTMLIFrameElement) {
  const desired = 'allow-scripts allow-forms allow-modals allow-popups';
  const existing = iframe.getAttribute('sandbox') || '';
  if (existing.indexOf('allow-same-origin') > -1 || existing !== desired) {
    console.warn('Incorrect sandbox attribute detected. Forcing secure sandbox.');
    iframe.setAttribute('sandbox', desired);
  }
}

export async function updatePreviewControlContrast(previewContainer: HTMLElement, previewPath: string) {
  previewContainer.classList.remove('light-preview');

  try {
    const previewUrl = new URL(previewPath, window.location.origin);
    const htmlResponse = await fetch(previewUrl);
    if (!htmlResponse.ok) return;

    const html = await htmlResponse.text();
    let score = scorePreviewBrightness(html);
    const cssHrefs = Array.from(html.matchAll(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi))
      .map(match => match[1])
      .slice(0, 6);

    await Promise.all(cssHrefs.map(async href => {
      try {
        const cssUrl = new URL(href, previewUrl);
        const cssResponse = await fetch(cssUrl);
        if (!cssResponse.ok) return;
        score += scorePreviewBrightness(await cssResponse.text());
      } catch {
        // Ignore unreadable generated assets; this is only a contrast hint.
      }
    }));

    previewContainer.classList.toggle('light-preview', score > 0);
  } catch {
    previewContainer.classList.remove('light-preview');
  }
}
