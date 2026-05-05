declare const marked: { parse(markdown: string): string };

export function sanitizeHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
  template.content.querySelectorAll<HTMLElement>('*').forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();

      if (name.startsWith('on') || value.startsWith('javascript:')) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return template.innerHTML;
}

export function renderMarkdown(markdown: string): string {
  return sanitizeHtml(marked.parse(markdown));
}

export function getQuestionFromResponse(response: string): string | null {
  const match = response.match(/<question>([\s\S]*?)<\/question>/i);
  return match ? match[1].trim() : null;
}

export function getPlanFromResponse(response: string): string | null {
  const match = response.match(/<plan>([\s\S]*?)<\/plan>/i);
  return match ? match[1].trim() : null;
}

export function forceScrollToBottom(container: HTMLElement) {
  container.scrollTop = container.scrollHeight;
}

export function smartScrollToBottom(container: HTMLElement) {
  const scrollThreshold = 50;
  const isNearBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + scrollThreshold;

  if (isNearBottom) {
    forceScrollToBottom(container);
  }
}

export function appendMessage(
  container: HTMLElement,
  content: string,
  role: 'user' | 'ai'
): HTMLDivElement {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${role}-message`;
  const identifier = document.createElement('div');
  identifier.className = 'message-identifier';
  identifier.textContent = role === 'user' ? 'You' : 'AI';
  const messageBody = document.createElement('div');
  messageBody.className = 'message-body';
  if (content) messageBody.innerHTML = sanitizeHtml(content);
  messageElement.appendChild(identifier);
  messageElement.appendChild(messageBody);
  container.appendChild(messageElement);
  forceScrollToBottom(container);
  return messageBody;
}

export function updateBuildStatus(container: HTMLElement, message: string, isFinal: boolean) {
  container.querySelectorAll('.build-status-message.temporary').forEach(el => el.remove());
  if (isFinal) container.querySelectorAll('.final-build-status').forEach(el => el.remove());

  if (!message) return;

  const statusElement = document.createElement('div');
  statusElement.className = 'message system-message build-status-message';
  if (!isFinal) statusElement.classList.add('temporary'); else statusElement.classList.add('final-build-status');
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-gear';
  const text = document.createElement('p');
  text.textContent = message;
  statusElement.append(icon, text);
  container.appendChild(statusElement);
  forceScrollToBottom(container);
}

export function upsertBuildLog(container: HTMLElement, stage: string, message: string) {
  const safeStage = (stage || 'build').replace(/[^\w-]/g, '') || 'build';
  let logElement = container.querySelector<HTMLDivElement>(`.build-log-message[data-stage="${safeStage}"]`);

  if (!logElement) {
    logElement = document.createElement('div');
    logElement.className = 'message system-message build-log-message';
    logElement.dataset.stage = safeStage;

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-terminal';
    const body = document.createElement('div');
    body.className = 'build-log-body';
    const title = document.createElement('p');
    title.textContent = `${safeStage.charAt(0).toUpperCase()}${safeStage.slice(1)} log`;
    const pre = document.createElement('pre');
    body.append(title, pre);
    logElement.append(icon, body);
    container.appendChild(logElement);
  }

  const pre = logElement.querySelector('pre');
  if (pre) pre.textContent = message;
  smartScrollToBottom(container);
}
