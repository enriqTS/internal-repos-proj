import { deleteProject } from './api';
import { invalidateSearchIndex } from './search-state';

/**
 * Show a delete confirmation dialog as a modal overlay.
 * The confirm button is disabled until the user types the exact project name (case-sensitive).
 * On confirm: disables button, shows loading, sends DELETE request.
 * On success: shows success message, navigates to #/.
 * On failure: shows API error, re-enables confirm button.
 *
 * @param projectName - The exact project name to confirm deletion
 */
export function showDeleteDialog(projectName: string): void {
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'delete-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'delete-dialog-title');

  const dialog = document.createElement('div');
  dialog.className = 'delete-dialog';

  // Title
  const title = document.createElement('h2');
  title.id = 'delete-dialog-title';
  title.className = 'delete-dialog-title';
  title.textContent = 'Delete Project';
  dialog.appendChild(title);

  // Warning text
  const warning = document.createElement('p');
  warning.className = 'delete-dialog-warning';
  warning.textContent = 'This action cannot be undone. This will permanently delete the project and all associated files.';
  dialog.appendChild(warning);

  // Project name display
  const nameDisplay = document.createElement('p');
  nameDisplay.className = 'delete-dialog-name';
  nameDisplay.innerHTML = `Please type <strong>${escapeHtml(projectName)}</strong> to confirm.`;
  dialog.appendChild(nameDisplay);

  // Confirmation input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'delete-dialog-input';
  input.placeholder = 'Type project name to confirm';
  input.setAttribute('aria-label', 'Type project name to confirm deletion');
  dialog.appendChild(input);

  // Status message area
  const statusEl = document.createElement('p');
  statusEl.className = 'delete-dialog-status';
  dialog.appendChild(statusEl);

  // Button row
  const buttonRow = document.createElement('div');
  buttonRow.className = 'delete-dialog-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'delete-dialog-cancel';
  cancelBtn.textContent = 'Cancel';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'delete-dialog-confirm';
  confirmBtn.textContent = 'Delete';
  confirmBtn.disabled = true;

  buttonRow.appendChild(cancelBtn);
  buttonRow.appendChild(confirmBtn);
  dialog.appendChild(buttonRow);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Focus the input
  input.focus();

  // Enable/disable confirm button based on exact name match
  input.addEventListener('input', () => {
    const match = input.value === projectName;
    confirmBtn.disabled = !match;
  });

  // Cancel: close dialog
  cancelBtn.addEventListener('click', () => {
    closeDialog(overlay);
  });

  // Close on overlay click (outside dialog)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeDialog(overlay);
    }
  });

  // Close on Escape key
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      closeDialog(overlay);
      document.removeEventListener('keydown', onKeyDown);
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // Confirm: send DELETE request
  confirmBtn.addEventListener('click', async () => {
    // Disable button and show loading
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    input.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    statusEl.className = 'delete-dialog-status delete-dialog-status--loading';
    statusEl.textContent = 'Deleting project…';

    const result = await deleteProject(projectName);

    if (result.ok) {
      statusEl.className = 'delete-dialog-status delete-dialog-status--success';
      statusEl.textContent = `Project "${projectName}" has been deleted.`;
      invalidateSearchIndex();
      // Navigate to home after a brief delay
      setTimeout(() => {
        closeDialog(overlay);
        document.removeEventListener('keydown', onKeyDown);
        window.location.hash = '#/projects';
      }, 1200);
    } else {
      // Show error, re-enable confirm button
      statusEl.className = 'delete-dialog-status delete-dialog-status--error';
      statusEl.textContent = result.error;
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      input.disabled = false;
      confirmBtn.textContent = 'Delete';
    }
  });
}

/**
 * Remove the dialog overlay from the DOM.
 */
function closeDialog(overlay: HTMLElement): void {
  overlay.remove();
}

/**
 * Escape HTML special characters to prevent XSS when inserting project names.
 */
function escapeHtml(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}
