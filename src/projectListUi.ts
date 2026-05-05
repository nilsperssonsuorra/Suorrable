export type ProjectMetadata = {
  projectId: string;
  title?: string;
  prompt?: string;
  status?: string;
  updatedAt?: string;
  previewPath?: string;
  deploymentUrl?: string;
  deploymentTarget?: 'preview' | 'production';
  deployStatus?: string;
};

type ProjectListOptions = {
  projectList: HTMLElement;
  currentProjectId: string | null;
  onDeleteProject: (project: ProjectMetadata) => Promise<void>;
  onDuplicateProject: (project: ProjectMetadata) => Promise<void>;
  onRenameProject: (project: ProjectMetadata) => Promise<void>;
  onSelectProject: (projectId: string) => Promise<void>;
};

function formatProjectTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderProjectList(
  projects: ProjectMetadata[],
  options: ProjectListOptions
) {
  const {
    currentProjectId,
    onDeleteProject,
    onDuplicateProject,
    onRenameProject,
    onSelectProject,
    projectList,
  } = options;

  projectList.textContent = '';

  if (projects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'project-list-empty';
    empty.textContent = 'No projects yet.';
    projectList.appendChild(empty);
    return;
  }

  for (const project of projects) {
    const item = document.createElement('div');
    item.className = 'project-list-item';
    if (project.projectId === currentProjectId) item.classList.add('active');

    const main = document.createElement('button');
    main.className = 'project-list-main';

    const title = document.createElement('span');
    title.className = 'project-list-title';
    title.textContent = project.title || project.prompt || project.projectId;

    const meta = document.createElement('span');
    meta.className = 'project-list-meta';
    meta.textContent = [project.status, formatProjectTime(project.updatedAt)].filter(Boolean).join(' · ');

    main.append(title, meta);
    main.addEventListener('click', async () => {
      await onSelectProject(project.projectId);
    });

    const actions = document.createElement('div');
    actions.className = 'project-list-actions';

    const renameButton = document.createElement('button');
    renameButton.className = 'project-list-action';
    renameButton.title = 'Rename project';
    renameButton.innerHTML = '<i class="fa-solid fa-pen"></i>';
    renameButton.addEventListener('click', () => onRenameProject(project));

    const duplicateButton = document.createElement('button');
    duplicateButton.className = 'project-list-action';
    duplicateButton.title = 'Duplicate project';
    duplicateButton.innerHTML = '<i class="fa-solid fa-copy"></i>';
    duplicateButton.addEventListener('click', () => onDuplicateProject(project));

    const deleteButton = document.createElement('button');
    deleteButton.className = 'project-list-action danger';
    deleteButton.title = 'Delete project';
    deleteButton.innerHTML = '<i class="fa-solid fa-trash"></i>';
    deleteButton.addEventListener('click', () => onDeleteProject(project));

    actions.append(renameButton, duplicateButton, deleteButton);
    item.append(main, actions);
    projectList.appendChild(item);
  }
}

export async function loadProjectList(options: ProjectListOptions) {
  const { projectList } = options;
  projectList.textContent = '';
  const loading = document.createElement('p');
  loading.className = 'project-list-empty';
  loading.textContent = 'Loading...';
  projectList.appendChild(loading);

  try {
    const response = await fetch('/api/projects');
    if (!response.ok) throw new Error(`Could not load projects (${response.status})`);
    const projects = await response.json() as ProjectMetadata[];
    renderProjectList(projects, options);
  } catch {
    projectList.textContent = '';
    const failed = document.createElement('p');
    failed.className = 'project-list-empty';
    failed.textContent = 'Could not load projects.';
    projectList.appendChild(failed);
  }
}
