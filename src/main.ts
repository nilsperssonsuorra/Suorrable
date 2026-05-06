// src/main.ts
import {
  appendMessage as appendMessageElement,
  forceScrollToBottom as forceScrollElementToBottom,
  getPlanFromResponse,
  getQuestionFromResponse,
  renderMarkdown,
  smartScrollToBottom as smartScrollElementToBottom,
  updateBuildStatus as renderBuildStatus,
  upsertBuildLog as renderBuildLog,
} from './chatUi';
import { createDeployController } from './deployUi';
import { enforcePreviewSandbox, updatePreviewControlContrast as updatePreviewContrast } from './previewControls';
import { loadProjectList as loadProjectListIntoPanel, ProjectMetadata } from './projectListUi';

declare const hljs: { highlightAll(): void; highlightElement(element: HTMLElement): void };

const app = document.getElementById("app")!;
const logo = document.getElementById("logo")!;
const projectPickerBtn = document.getElementById("project-picker-btn") as HTMLButtonElement;
const projectPanel = document.getElementById("project-panel") as HTMLDivElement;
const projectPanelClose = document.getElementById("project-panel-close") as HTMLButtonElement;
const projectList = document.getElementById("project-list") as HTMLDivElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const sendButton = document.getElementById("send-button") as HTMLButtonElement;
const suggestionButtons = document.querySelectorAll<HTMLButtonElement>(".suggestion-btn");
const responseContainer = document.getElementById("response-container") as HTMLDivElement;
const livePreviewIframe = document.getElementById("live-preview-iframe") as HTMLIFrameElement;
const previewContainer = document.getElementById("preview-container") as HTMLDivElement;
const loaderText = document.querySelector(".loader-text") as HTMLParagraphElement;
const reloadPreviewBtn = document.getElementById("reload-preview-btn") as HTMLButtonElement;
const fullscreenBtn = document.getElementById("fullscreen-btn") as HTMLButtonElement;
const exitFullscreenBtn = document.getElementById("exit-fullscreen-btn") as HTMLButtonElement;
const codeViewer = document.getElementById("code-viewer") as HTMLDivElement;
const fixingErrorContainer = document.getElementById("fixing-error-container")!;


let chatHistory: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
let isGenerating = false;
let currentProjectId: string | null = null;
let currentPreviewPath: string | null = null;
let finalGeneratedCode: string | null = null;
const currentProjectStorageKey = 'suorrable.currentProjectId';

const forceScrollToBottom = () => {
    forceScrollElementToBottom(responseContainer);
};

const smartScrollToBottom = () => {
    smartScrollElementToBottom(responseContainer);
};

const updatePreviewControlContrast = (previewPath: string) => updatePreviewContrast(previewContainer, previewPath);

enforcePreviewSandbox(livePreviewIframe);

const setReloadPreviewEnabled = () => {
  reloadPreviewBtn.disabled = !currentPreviewPath || isGenerating;
};

const setPreviewPlaceholder = () => {
  livePreviewIframe.removeAttribute('src');
  livePreviewIframe.srcdoc = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<style>html,body{margin:0;width:100%;height:100%;background:#111111;}</style>',
    '</head>',
    '<body></body>',
    '</html>',
  ].join('');
};

setPreviewPlaceholder();
setReloadPreviewEnabled();

const loadPreview = (previewPath: string) => {
  currentPreviewPath = previewPath;
  setReloadPreviewEnabled();
  livePreviewIframe.removeAttribute('srcdoc');
  livePreviewIframe.src = `${window.location.origin}${previewPath}?v=${Date.now()}`;
  updatePreviewControlContrast(previewPath);
};

const reloadCurrentPreview = () => {
  if (!currentPreviewPath || isGenerating) return;
  loadPreview(currentPreviewPath);
};

const resetToInitialView = () => {
  if (chatHistory.length > 0 || currentProjectId) {
    if (!confirm("Start a new session? Current chat and preview will be lost.")) return;
  }
  app.classList.remove("split-view-active");
  chatHistory = [];
  isGenerating = false;
  currentProjectId = null;
  currentPreviewPath = null;
  finalGeneratedCode = null;
  deployController.reset();
  setReloadPreviewEnabled();
  localStorage.removeItem(currentProjectStorageKey);
  loaderText.textContent = "Building your preview...";
  chatInput.placeholder = "Describe what you want to create...";
  chatInput.disabled = false;
  sendButton.disabled = false;
  setTimeout(() => {
    responseContainer.innerHTML = "";
    setPreviewPlaceholder();
    livePreviewIframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    codeViewer.innerHTML = "";
    previewContainer.classList.remove('is-loading', 'is-updating', 'fullscreen-preview', 'showing-code', 'is-fixing', 'light-preview');
    setReloadPreviewEnabled();
    fullscreenBtn.style.display = 'flex';
    exitFullscreenBtn.style.display = 'none';
    deployController.update();
  }, 500);
};

const appendMessage = (content: string, role: 'user' | 'ai'): HTMLDivElement => {
  return appendMessageElement(responseContainer, content, role);
};

const updateBuildStatus = (message: string, isFinal: boolean) => {
  renderBuildStatus(responseContainer, message, isFinal);
};

const deployController = createDeployController({
  getCurrentProjectId: () => currentProjectId,
  isBusy: () => isGenerating,
  previewContainer,
  updateBuildStatus,
});

const upsertBuildLog = (stage: string, message: string) => {
  renderBuildLog(responseContainer, stage, message);
};

const getProjectDisplayName = (project: ProjectMetadata): string => (
  project.title || project.prompt || project.projectId
);

const renameProject = async (project: ProjectMetadata) => {
  const currentName = getProjectDisplayName(project);
  const title = prompt('Rename project', currentName)?.trim();
  if (!title || title === currentName) return;

  const response = await fetch(`/api/projects/${project.projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    alert(data.error || 'Could not rename project.');
    return;
  }

  await loadProjectList();
};

const duplicateProject = async (project: ProjectMetadata) => {
  const response = await fetch(`/api/projects/${project.projectId}/duplicate`, {
    method: 'POST',
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    alert(data.error || 'Could not duplicate project.');
    return;
  }

  const duplicated = await response.json() as ProjectMetadata;
  await restoreProject(duplicated.projectId);
  await loadProjectList();
};

const deleteProject = async (project: ProjectMetadata) => {
  const name = getProjectDisplayName(project);
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

  const response = await fetch(`/api/projects/${project.projectId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    alert(data.error || 'Could not delete project.');
    return;
  }

  if (project.projectId === currentProjectId) {
    app.classList.remove("split-view-active");
    chatHistory = [];
    isGenerating = false;
    currentProjectId = null;
    currentPreviewPath = null;
    finalGeneratedCode = null;
    deployController.reset();
    localStorage.removeItem(currentProjectStorageKey);
    responseContainer.innerHTML = '';
    setPreviewPlaceholder();
    codeViewer.innerHTML = '';
    previewContainer.classList.remove('is-loading', 'is-updating', 'fullscreen-preview', 'showing-code', 'is-fixing', 'light-preview');
    setReloadPreviewEnabled();
  }

  await loadProjectList();
};

const loadProjectList = async () => {
  await loadProjectListIntoPanel({
    projectList,
    currentProjectId,
    onDeleteProject: deleteProject,
    onDuplicateProject: duplicateProject,
    onRenameProject: renameProject,
    onSelectProject: async projectId => {
      await restoreProject(projectId);
      projectPanel.hidden = true;
    },
  });
};

const restoreProject = async (projectId: string) => {
  try {
    const [metadataResponse, conversationResponse] = await Promise.all([
      fetch(`/api/projects/${projectId}`),
      fetch(`/api/projects/${projectId}/conversation`),
    ]);

    if (!metadataResponse.ok || !conversationResponse.ok) return;

    const metadata = await metadataResponse.json();
    const conversation = await conversationResponse.json();

    currentProjectId = projectId;
    deployController.restore(metadata);
    localStorage.setItem(currentProjectStorageKey, projectId);
    chatHistory = [];
    responseContainer.innerHTML = '';
    app.classList.add('split-view-active');
    chatInput.placeholder = 'Describe what you want to change...';

    for (const entry of conversation) {
      if (entry.role === 'user') {
        appendMessage(renderMarkdown(entry.content || ''), 'user');
        chatHistory.push({ role: 'user', parts: [{ text: entry.content || '' }] });
        continue;
      }

      const raw = entry.raw || entry.content || '';
      const question = entry.type === 'question' ? entry.content : getQuestionFromResponse(raw);
      const plan = getPlanFromResponse(raw);
      const body = appendMessage('', 'ai');

      if (question) {
        body.innerHTML = renderMarkdown(question);
      } else if (plan) {
        const planElement = document.createElement('div');
        planElement.className = 'ai-plan';
        planElement.innerHTML = renderMarkdown(`**Plan**\n\n${plan}`);
        body.appendChild(planElement);
      } else {
        body.textContent = 'Generated project update.';
      }

      if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
        chatHistory.push({ role: 'model', parts: [{ text: raw }] });
      }
    }

    if (conversation.length === 0) {
      const restored = appendMessage('', 'ai');
      restored.textContent = metadata.prompt
        ? `Restored project: ${metadata.prompt}`
        : 'Restored project.';
    }

    if (metadata.previewPath) {
      loadPreview(metadata.previewPath);
      previewContainer.classList.remove('is-loading', 'is-updating', 'is-fixing');
    } else {
      currentPreviewPath = null;
      setReloadPreviewEnabled();
    }
    deployController.update();
  } catch (error) {
    console.warn('Could not restore project session:', error);
  }
};

const sendMessage = async () => {
  if (isGenerating) return;
  const message = chatInput.value;
  if (message.trim() === "") return;

  isGenerating = true;
  sendButton.disabled = true;
  setReloadPreviewEnabled();
  previewContainer.classList.remove('showing-code');

  if (!app.classList.contains("split-view-active")) {
    app.classList.add("split-view-active");
  }

  if (!currentProjectId) {
    loaderText.textContent = "Creating plan...";
    previewContainer.classList.add('is-loading');
    chatInput.placeholder = "Describe what you want to change...";
  } else {
    previewContainer.classList.add('is-updating');
  }

  appendMessage(renderMarkdown(message), 'user');
  chatInput.value = "";

  updateBuildStatus("Connecting to AI...", false);

  let aiMessageBody: HTMLDivElement | null = null;
  let fullResponseText = "";
  let planRendered = false;
  let progressBarSetup = false;
  let totalLines = 0;
  let linesWritten = 0;
  let planElement: HTMLDivElement | null = null;
  let progressWrapper: HTMLDivElement | null = null;
  let finalResponseForHistory: string | null = null;

  try {
    const response = await fetch(`${window.location.origin}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: message, history: chatHistory, projectId: currentProjectId }),
    });
    if (!response.body) throw new Error("Response body is null");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        const data = part.slice(6);
        try {
          const parsedData = JSON.parse(data);

          if (parsedData.stream) {
            fullResponseText += parsedData.stream;

            if (!planRendered) {
              const startTag = '<plan>';
              const endTag = '</plan>';
              const startPos = fullResponseText.indexOf(startTag);

              if (startPos !== -1) {
                if (!aiMessageBody) {
                  aiMessageBody = appendMessage('', 'ai');
                  updateBuildStatus("", false); 
                }
                
                if (!planElement) {
                  planElement = document.createElement('div');
                  planElement.className = 'ai-plan';
                  aiMessageBody.appendChild(planElement);
                }

                const endPos = fullResponseText.indexOf(endTag, startPos);
                let planContent;

                if (endPos !== -1) {
                  planContent = fullResponseText.substring(startPos + startTag.length, endPos);
                  planRendered = true;
                  loaderText.textContent = "Writing code...";
                } else {
                  planContent = fullResponseText.substring(startPos + startTag.length);
                }
                
                planElement.innerHTML = renderMarkdown(`**Plan**\n\n${planContent}`);
                smartScrollToBottom();
              }
            }

            if (planRendered && !progressBarSetup) {
              const endOfLoc = fullResponseText.indexOf('</loc>');
              if (endOfLoc !== -1) {
                const startOfLoc = fullResponseText.indexOf('<loc>');
                const locContent = fullResponseText.substring(startOfLoc + 5, endOfLoc);
                totalLines = parseInt(locContent, 10) || 0;
                progressWrapper = document.createElement('div');
                progressWrapper.className = 'code-progress-wrapper';
                const progressLabel = document.createElement('div');
                progressLabel.className = 'code-progress-label';
                progressLabel.textContent = `0 / ${totalLines} lines written`;
                const progressContainer = document.createElement('div');
                progressContainer.className = 'code-progress-container';
                const progressBar = document.createElement('div');
                progressBar.className = 'code-progress-bar';
                progressBar.style.width = '0%';
                progressContainer.appendChild(progressBar);
                progressWrapper.append(progressLabel, progressContainer);
                if(aiMessageBody) aiMessageBody.appendChild(progressWrapper);
                progressBarSetup = true;
                forceScrollToBottom();
              }
            }
            
            if (progressBarSetup && progressWrapper) {
              const codeStartIndex = fullResponseText.indexOf('</loc>');
              if (codeStartIndex !== -1) {
                const codeContent = fullResponseText.substring(codeStartIndex + 6);
                linesWritten = (codeContent.match(/\n/g) || []).length;
                const safe = Math.min(linesWritten, totalLines);
                const pct = totalLines > 0 ? (safe / totalLines) * 100 : 100;
                const label = progressWrapper.querySelector('.code-progress-label') as HTMLElement;
                const bar = progressWrapper.querySelector('.code-progress-bar') as HTMLElement;
                if (label) label.textContent = `${safe} / ${totalLines} lines written`;
                if (bar) bar.style.width = `${pct}%`;
                
                smartScrollToBottom();
              }
            }
          } else if (parsedData.event === 'code-generated') {
            if (!aiMessageBody) {
              aiMessageBody = appendMessage('', 'ai');
            }
            if (progressWrapper) progressWrapper.remove();

            const finalResponse = parsedData.fullResponse;
            const finalCode = finalResponse
              .replace(/<plan>[\s\S]*?<\/plan>/, '')
              .replace(/<loc>[\s\S]*?<\/loc>/, '')
              .trim();

            finalGeneratedCode = finalCode;
            finalResponseForHistory = finalResponse;

            let showCodeToggleButton = aiMessageBody?.querySelector<HTMLButtonElement>('.show-code-toggle-btn') || null;
            if (!showCodeToggleButton) {
              showCodeToggleButton = document.createElement('button');
              showCodeToggleButton.className = 'show-code-toggle-btn';
              showCodeToggleButton.textContent = 'Show Generated Code';
              if(aiMessageBody) aiMessageBody.appendChild(showCodeToggleButton);

              showCodeToggleButton.addEventListener('click', () => {
                const isShowingCode = previewContainer.classList.toggle('showing-code');
                if (showCodeToggleButton) {
                  showCodeToggleButton.textContent = isShowingCode ? 'Hide Generated Code' : 'Show Generated Code';
                }
              });
            }

            codeViewer.innerHTML = '';
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.className = 'language-javascript';
            code.textContent = finalGeneratedCode;
            pre.appendChild(code);
            codeViewer.appendChild(pre);
            hljs.highlightElement(code);

          } else if (parsedData.status) {
            loaderText.textContent = parsedData.message;
            const isFinalStatus = parsedData.status === 'complete';
            updateBuildStatus(parsedData.message, isFinalStatus);

          } else if (parsedData.event === 'build-log') {
            upsertBuildLog(parsedData.stage, parsedData.message);

          } else if (parsedData.event === 'question') {
            updateBuildStatus("", false);
            currentProjectId = parsedData.projectId || currentProjectId;
            if (currentProjectId) localStorage.setItem(currentProjectStorageKey, currentProjectId);
            const question = parsedData.question || 'Can you clarify what you want to build?';
            if (!aiMessageBody) {
              aiMessageBody = appendMessage('', 'ai');
            }
            aiMessageBody.innerHTML = renderMarkdown(question);
            chatHistory.push({ role: 'user', parts: [{ text: message }] });
            chatHistory.push({ role: 'model', parts: [{ text: parsedData.fullResponse || `<question>${question}</question>` }] });
            setPreviewPlaceholder();
            previewContainer.classList.remove('is-loading', 'is-updating', 'is-fixing');
            loaderText.textContent = "Building your preview...";
            isGenerating = false;
            sendButton.disabled = false;
            chatInput.placeholder = "Answer the question...";
            chatInput.focus();
          
          } else if (parsedData.event === 'fixing-start') {
              previewContainer.classList.add('is-fixing');
              const fixingText = document.querySelector<HTMLParagraphElement>('.fixing-error-text');
              if (fixingText) fixingText.textContent = parsedData.message;
              updateBuildStatus(parsedData.message, false);
          } else if (parsedData.event === 'fixing-code-received') {
              previewContainer.classList.remove('is-fixing');
              updateBuildStatus(parsedData.message, false);
          
          } else if (parsedData.event === 'done') {
            currentProjectId = parsedData.projectId;
            currentPreviewPath = null;
            deployController.clearDeployment();
            localStorage.setItem(currentProjectStorageKey, currentProjectId);
            if (finalResponseForHistory) {
              chatHistory.push({ role: 'user', parts: [{ text: message }] });
              chatHistory.push({ role: 'model', parts: [{ text: finalResponseForHistory }] });
            }
            const previewPath = parsedData.previewPath;
            const previewUrl = `${window.location.origin}${previewPath}?v=${Date.now()}`;

            console.log(`[CLIENT DEBUG] Build complete. Received preview path: ${previewPath}`);
            console.log(`[CLIENT DEBUG] Performing pre-flight check on URL: ${previewUrl}`);

            try {
              const response = await fetch(previewUrl, { method: 'HEAD' });

              if (!response.ok) {
                throw new Error(`Server responded with status ${response.status} (${response.statusText}).`);
              }

              console.log(`[CLIENT DEBUG] Pre-flight check successful (Status: ${response.status}). Loading iframe.`);

              livePreviewIframe.onload = () => {
                console.log(`Iframe content for project ${currentProjectId} loaded successfully.`);
                previewContainer.classList.remove('is-loading', 'is-updating', 'is-fixing');
              };

              livePreviewIframe.onerror = (e) => {
                console.error("CRITICAL: The preview iframe failed to load during the final rendering stage.", e);
                alert("An unexpected error occurred while rendering the preview iframe. Check the console.");
              };

              loadPreview(previewPath);

            } catch (error) {
              console.error("CRITICAL: Preview pre-flight check failed.", error);
              const errorMsg = `The application build finished, but the preview failed to load. This is often caused by a build error on the server that prevented the final files from being created.\n\nDetails: ${error.message}\n\nPlease check the server's console logs for [SERVER DEBUG] messages to see the exact cause.`;
              alert(errorMsg);
              previewContainer.classList.remove('is-loading', 'is-updating', 'is-fixing');
              loaderText.textContent = "Preview failed.";
            }

            isGenerating = false;
            sendButton.disabled = false;
            setReloadPreviewEnabled();
            deployController.update();
            chatInput.focus();

          } else if (parsedData.event === 'error') {
            previewContainer.classList.remove('is-fixing');
            throw new Error(parsedData.message);
          }

        } catch (e) {
          console.error("Failed to parse JSON chunk:", e, data);
        }
      }
    }
  } catch (error) {
    updateBuildStatus("", false);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    if (!aiMessageBody) {
        aiMessageBody = appendMessage('', 'ai');
    }
    aiMessageBody.textContent = '';
    const errorText = document.createElement('p');
    errorText.style.color = '#f87171';
    errorText.textContent = `Error: ${errorMessage}`;
    aiMessageBody.appendChild(errorText);
    forceScrollToBottom();
    previewContainer.classList.remove('is-loading', 'is-updating', 'is-fixing');
    isGenerating = false;
    sendButton.disabled = false;
    setReloadPreviewEnabled();
    chatInput.focus();
  }
};

reloadPreviewBtn.addEventListener('click', reloadCurrentPreview);
sendButton.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
suggestionButtons.forEach(button => {
  button.addEventListener("click", () => {
    const promptText = button.dataset.prompt;
    if (promptText && !isGenerating) {
      chatInput.value = promptText;
      chatInput.focus();
      sendMessage();
    }
  });
});
logo.addEventListener("click", resetToInitialView);
projectPickerBtn.addEventListener('click', () => {
  projectPanel.hidden = !projectPanel.hidden;
  if (!projectPanel.hidden) {
    loadProjectList();
  }
});
projectPanelClose.addEventListener('click', () => {
  projectPanel.hidden = true;
});

fullscreenBtn.addEventListener('click', () => {
  previewContainer.classList.add('fullscreen-preview');
  fullscreenBtn.style.display = 'none';
  exitFullscreenBtn.style.display = 'flex';
});
exitFullscreenBtn.addEventListener('click', () => {
  previewContainer.classList.remove('fullscreen-preview');
  fullscreenBtn.style.display = 'flex';
  exitFullscreenBtn.style.display = 'none';
});

const initialProjectId = new URLSearchParams(window.location.search).get('projectId');
if (initialProjectId) {
  restoreProject(initialProjectId);
}
