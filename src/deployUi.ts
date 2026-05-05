export type DeploymentTarget = 'preview' | 'production';

export type ProjectDeploymentMetadata = {
  deploymentUrl?: string;
  deploymentTarget?: DeploymentTarget;
  prompt?: string;
  projectId?: string;
  title?: string;
  vercelProjectName?: string;
};

type DeployConfig = {
  provider: 'vercel';
  projectNameHint?: string;
  tokenConfigured: boolean;
  scope: string | null;
};

type DeployControllerOptions = {
  getCurrentProjectId: () => string | null;
  isBusy: () => boolean;
  previewContainer: HTMLDivElement;
  updateBuildStatus: (message: string, isFinal: boolean) => void;
};

type DeployStreamEvent = {
  event?: 'status' | 'deploy-log' | 'done' | 'error';
  stage?: string;
  stream?: string;
  message?: string;
  deploymentUrl?: string;
  production?: boolean;
};

const deployStepOrder = ['prepare', 'linking', 'deploying', 'ready'];

export function createDeployController(options: DeployControllerOptions) {
  const deployProductionToggle = document.getElementById('deploy-production-toggle') as HTMLInputElement;
  const deploySettingsBtn = document.getElementById('deploy-settings-btn') as HTMLButtonElement;
  const deployTargetLabel = document.getElementById('deploy-target-label') as HTMLSpanElement;
  const deploySettingsPanel = document.getElementById('deploy-settings-panel') as HTMLDivElement;
  const deploySettingsClose = document.getElementById('deploy-settings-close') as HTMLButtonElement;
  const deployTargetPreviewBtn = document.getElementById('deploy-target-preview') as HTMLButtonElement;
  const deployTargetProductionBtn = document.getElementById('deploy-target-production') as HTMLButtonElement;
  const deployTokenStatus = document.getElementById('deploy-token-status') as HTMLElement;
  const deployScopeStatus = document.getElementById('deploy-scope-status') as HTMLElement;
  const deployNameStatus = document.getElementById('deploy-name-status') as HTMLElement;
  const deployBtn = document.getElementById('deploy-btn') as HTMLButtonElement;
  const deployPanel = document.getElementById('deploy-panel') as HTMLDivElement;
  const deployPanelTitle = document.getElementById('deploy-panel-title') as HTMLParagraphElement;
  const deployPanelMeta = document.getElementById('deploy-panel-meta') as HTMLParagraphElement;
  const deployPanelClose = document.getElementById('deploy-panel-close') as HTMLButtonElement;
  const deployLogOutput = document.getElementById('deploy-log-output') as HTMLPreElement;
  const deployOpenBtn = document.getElementById('deploy-open-btn') as HTMLButtonElement;
  const deployAgainBtn = document.getElementById('deploy-again-btn') as HTMLButtonElement;
  const deploySteps = Array.from(document.querySelectorAll<HTMLElement>('[data-deploy-step]'));

  let currentDeploymentUrl: string | null = null;
  let currentDeploymentTarget: DeploymentTarget = 'preview';
  let isDeploying = false;
  let deployLogText = '';
  let deployConfigLoaded = false;
  let currentProjectName = 'From project title';
  let deployPanelDrag = {
    active: false,
    offsetX: 0,
    offsetY: 0,
  };

  const selectedTarget = (): DeploymentTarget => deployProductionToggle.checked ? 'production' : 'preview';

  const createProjectNamePreview = (metadata: ProjectDeploymentMetadata = {}): string => {
    const source = String(
      metadata.vercelProjectName ||
      metadata.title ||
      metadata.prompt ||
      `suorrable-${String(metadata.projectId || '').slice(0, 8)}`
    );
    const slug = source
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 52)
      .replace(/-+$/g, '');

    return slug || 'From project title';
  };

  const updateTargetUi = () => {
    const target = selectedTarget();
    deployTargetLabel.textContent = target === 'production' ? 'Production' : 'Preview';
    deployTargetPreviewBtn.classList.toggle('active', target === 'preview');
    deployTargetProductionBtn.classList.toggle('active', target === 'production');
  };

  const updateButton = () => {
    const currentProjectId = options.getCurrentProjectId();

    if (!currentProjectId) {
      deployBtn.disabled = true;
      deploySettingsBtn.disabled = true;
      deployTargetPreviewBtn.disabled = true;
      deployTargetProductionBtn.disabled = true;
      deployBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i><span>Deploy</span>';
      updateTargetUi();
      return;
    }

    const busy = options.isBusy() || isDeploying;
    deploySettingsBtn.disabled = busy;
    deployTargetPreviewBtn.disabled = busy;
    deployTargetProductionBtn.disabled = busy;
    deployBtn.disabled = isDeploying;
    updateTargetUi();

    if (isDeploying) {
      deployBtn.innerHTML = '<i class="fa-solid fa-spinner"></i><span>Deploying</span>';
      return;
    }

    const requestedTarget = selectedTarget();
    deployBtn.innerHTML = currentDeploymentUrl && requestedTarget === currentDeploymentTarget
      ? '<i class="fa-solid fa-arrow-up-right-from-square"></i><span>Open</span>'
      : '<i class="fa-solid fa-cloud-arrow-up"></i><span>Deploy</span>';
  };

  const setTarget = (target: DeploymentTarget) => {
    deployProductionToggle.checked = target === 'production';
    updateTargetUi();
    updateButton();
  };

  const loadDeployConfig = async () => {
    if (deployConfigLoaded) return;

    try {
      const response = await fetch('/api/deploy/config');
      if (!response.ok) throw new Error(`Could not load deploy config (${response.status})`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Deploy config endpoint did not return JSON.');
      }
      const config = await response.json() as DeployConfig;
      deployTokenStatus.textContent = config.tokenConfigured ? 'Connected' : 'Missing';
      deployTokenStatus.classList.toggle('good', config.tokenConfigured);
      deployTokenStatus.classList.toggle('warning', !config.tokenConfigured);
      deployScopeStatus.textContent = config.scope || 'Default account';
      deployScopeStatus.title = config.scope || 'Uses the default Vercel account for the token.';
      deployNameStatus.textContent = currentProjectName;
      deployNameStatus.title = config.projectNameHint || 'Used when the project is first linked to Vercel.';
      deployConfigLoaded = true;
    } catch (error) {
      console.warn('Could not load deployment config:', error);
      deployTokenStatus.textContent = 'Restart server';
      deployTokenStatus.classList.add('warning');
      deployScopeStatus.textContent = 'Unavailable';
    }
  };

  const formatDeploymentTarget = (production: boolean): string => (
    production ? 'Production target' : 'Preview target'
  );

  const setDeployStep = (step: 'prepare' | 'linking' | 'deploying' | 'ready', failed = false) => {
    const activeIndex = deployStepOrder.indexOf(step);
    for (const stepElement of deploySteps) {
      const stepName = stepElement.dataset.deployStep || '';
      const stepIndex = deployStepOrder.indexOf(stepName);
      stepElement.classList.remove('active', 'complete', 'failed');

      if (failed && stepName === step) {
        stepElement.classList.add('failed');
      } else if (stepIndex < activeIndex || step === 'ready') {
        stepElement.classList.add('complete');
      } else if (stepIndex === activeIndex) {
        stepElement.classList.add('active');
      }
    }
  };

  const setDeployPanelState = (
    state: 'idle' | 'deploying' | 'deployed' | 'failed',
    title: string,
    meta: string
  ) => {
    deployPanel.hidden = false;
    deployPanel.classList.remove('idle', 'deploying', 'deployed', 'failed');
    deployPanel.classList.add(state);
    deployPanelTitle.textContent = title;
    deployPanelMeta.textContent = meta;
  };

  const appendDeployLog = (message: string) => {
    if (!message) return;
    deployLogText = `${deployLogText}${message}`;
    const maxLogLength = 20000;
    if (deployLogText.length > maxLogLength) {
      deployLogText = deployLogText.slice(deployLogText.length - maxLogLength);
    }
    deployLogOutput.textContent = deployLogText.trimStart();
    deployLogOutput.scrollTop = deployLogOutput.scrollHeight;
  };

  const resetDeployPanel = (production: boolean) => {
    deployLogText = '';
    deployLogOutput.textContent = '';
    deployOpenBtn.disabled = true;
    deployAgainBtn.disabled = true;
    deployPanel.style.left = '1rem';
    deployPanel.style.top = '';
    deployPanel.style.bottom = '1rem';
    setDeployStep('prepare');
    setDeployPanelState('deploying', 'Vercel deployment', formatDeploymentTarget(production));
    appendDeployLog(`> Starting ${production ? 'production' : 'preview'} deployment...\n`);
    appendDeployLog('> Preparing generated project for Vercel.\n');
  };

  const moveDeployPanel = (clientX: number, clientY: number) => {
    const containerRect = options.previewContainer.getBoundingClientRect();
    const panelRect = deployPanel.getBoundingClientRect();
    const padding = 12;
    const maxLeft = Math.max(padding, containerRect.width - panelRect.width - padding);
    const maxTop = Math.max(padding, containerRect.height - panelRect.height - padding);
    const nextLeft = Math.min(Math.max(clientX - containerRect.left - deployPanelDrag.offsetX, padding), maxLeft);
    const nextTop = Math.min(Math.max(clientY - containerRect.top - deployPanelDrag.offsetY, padding), maxTop);

    deployPanel.style.left = `${nextLeft}px`;
    deployPanel.style.top = `${nextTop}px`;
    deployPanel.style.bottom = 'auto';
  };

  const handleDeployStreamEvent = (parsedData: DeployStreamEvent, production: boolean) => {
    if (parsedData.event === 'status') {
      const stage = parsedData.stage === 'linking' || parsedData.stage === 'deploying'
        ? parsedData.stage
        : 'prepare';
      setDeployStep(stage);
      setDeployPanelState('deploying', parsedData.message || 'Deploying to Vercel...', formatDeploymentTarget(production));
      appendDeployLog(`\n> ${parsedData.message || parsedData.stage || 'Deploying'}\n`);
      options.updateBuildStatus(parsedData.message || 'Deploying to Vercel...', false);
      return;
    }

    if (parsedData.event === 'deploy-log') {
      appendDeployLog(parsedData.message || '');
      return;
    }

    if (parsedData.event === 'done') {
      currentDeploymentUrl = parsedData.deploymentUrl || null;
      currentDeploymentTarget = parsedData.production ? 'production' : 'preview';
      setTarget(currentDeploymentTarget);
      appendDeployLog(`\n> Deployment ready: ${currentDeploymentUrl}\n`);
      setDeployStep('ready');
      setDeployPanelState('deployed', 'Deployment ready', `${formatDeploymentTarget(Boolean(parsedData.production))} · ${currentDeploymentUrl}`);
      deployOpenBtn.disabled = !currentDeploymentUrl;
      deployAgainBtn.disabled = false;
      options.updateBuildStatus(`Deployed: ${currentDeploymentUrl}`, true);
      return;
    }

    if (parsedData.event === 'error') {
      const message = parsedData.message || 'Deployment failed.';
      appendDeployLog(`\n> Error: ${message}\n`);
      setDeployStep('deploying', true);
      setDeployPanelState('failed', 'Deployment failed', formatDeploymentTarget(production));
      deployAgainBtn.disabled = false;
      options.updateBuildStatus(`Deploy failed: ${message}`, true);
    }
  };

  const deployCurrentProject = async (forceDeploy = false) => {
    const currentProjectId = options.getCurrentProjectId();
    if (!currentProjectId || deployBtn.disabled) return;

    const production = selectedTarget() === 'production';
    const requestedTarget = production ? 'production' : 'preview';

    if (!forceDeploy && currentDeploymentUrl && requestedTarget === currentDeploymentTarget) {
      window.open(currentDeploymentUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    isDeploying = true;
    resetDeployPanel(production);
    updateButton();
    options.updateBuildStatus(
      production ? 'Deploying production to Vercel...' : 'Deploying preview to Vercel...',
      false
    );

    try {
      const response = await fetch(`/api/projects/${currentProjectId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ production }),
      });
      if (!response.body) throw new Error('Deployment response stream was empty.');

      if (!response.ok) {
        throw new Error(`Deploy failed (${response.status})`);
      }

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
            handleDeployStreamEvent(JSON.parse(data), production);
          } catch (error) {
            console.warn('Failed to parse deploy event:', error);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deployment failed.';
      appendDeployLog(`\n> Error: ${message}\n`);
      setDeployStep('deploying', true);
      setDeployPanelState('failed', 'Deployment failed', formatDeploymentTarget(production));
      deployAgainBtn.disabled = false;
      options.updateBuildStatus(`Deploy failed: ${message}`, true);
    } finally {
      isDeploying = false;
      updateButton();
    }
  };

  deployBtn.addEventListener('click', () => deployCurrentProject());
  deploySettingsBtn.addEventListener('click', () => {
    deploySettingsPanel.hidden = !deploySettingsPanel.hidden;
    if (!deploySettingsPanel.hidden) {
      loadDeployConfig();
    }
  });
  deploySettingsClose.addEventListener('click', () => {
    deploySettingsPanel.hidden = true;
  });
  deployTargetPreviewBtn.addEventListener('click', () => {
    setTarget('preview');
  });
  deployTargetProductionBtn.addEventListener('click', () => {
    setTarget('production');
  });
  deployPanelClose.addEventListener('click', () => {
    deployPanel.hidden = true;
  });
  deployPanel.addEventListener('pointerdown', event => {
    const target = event.target as HTMLElement;
    const header = target.closest('.deploy-panel-header');
    if (!header || target.closest('button')) return;

    const panelRect = deployPanel.getBoundingClientRect();
    deployPanelDrag = {
      active: true,
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
    };
    deployPanel.classList.add('dragging');
    deployPanel.setPointerCapture(event.pointerId);
  });
  deployPanel.addEventListener('pointermove', event => {
    if (!deployPanelDrag.active) return;
    moveDeployPanel(event.clientX, event.clientY);
  });
  deployPanel.addEventListener('pointerup', event => {
    if (!deployPanelDrag.active) return;
    deployPanelDrag.active = false;
    deployPanel.classList.remove('dragging');
    deployPanel.releasePointerCapture(event.pointerId);
  });
  deployPanel.addEventListener('pointercancel', event => {
    if (!deployPanelDrag.active) return;
    deployPanelDrag.active = false;
    deployPanel.classList.remove('dragging');
    deployPanel.releasePointerCapture(event.pointerId);
  });
  deployOpenBtn.addEventListener('click', () => {
    if (currentDeploymentUrl) {
      window.open(currentDeploymentUrl, '_blank', 'noopener,noreferrer');
    }
  });
  deployAgainBtn.addEventListener('click', () => {
    deployCurrentProject(true);
  });

  updateTargetUi();
  updateButton();

  return {
    clearDeployment() {
      currentDeploymentUrl = null;
      currentDeploymentTarget = 'preview';
      setTarget('preview');
    },
    reset() {
      currentDeploymentUrl = null;
      currentDeploymentTarget = 'preview';
      currentProjectName = 'From project title';
      deployNameStatus.textContent = currentProjectName;
      setTarget('preview');
      deployPanel.hidden = true;
      deploySettingsPanel.hidden = true;
    },
    restore(metadata: ProjectDeploymentMetadata) {
      currentDeploymentUrl = metadata.deploymentUrl || null;
      currentDeploymentTarget = metadata.deploymentTarget || 'preview';
      currentProjectName = createProjectNamePreview(metadata);
      deployNameStatus.textContent = currentProjectName;
      setTarget(currentDeploymentTarget);
    },
    update: updateButton,
  };
}
