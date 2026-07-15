import { deleteProject } from './api';
import { t } from './i18n';
import { invalidateSearchIndex } from './search-state';
import { overlay as createOverlay, button, heading } from './ui';

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
  const overlayEl = createOverlay();
  overlayEl.setAttribute('role', 'dialog');
  overlayEl.setAttribute('aria-modal', 'true');
  overlayEl.setAttribute('aria-labelledby', 'delete-dialog-title');

  const dialog = document.createElement('div');
  dialog.className = 'bg-surface border border-border rounded-lg p-6 w-full max-w-md shadow-lg flex flex-col gap-4';

  // Title
  const title = heading(t('delete.title'), 3);
  title.id = 'delete-dialog-title';
  dialog.appendChild(title);

  // Warning text
  const warning = document.createElement('p');
  warning.className = 'text-sm text-text-muted';
  warning.textContent = t('delete.warning');
  dialog.appendChild(warning);

  // Project name display
  const nameDisplay = document.createElement('p');
  nameDisplay.className = 'text-sm text-text-muted';
  nameDisplay.innerHTML = t('delete.prompt', { name: escapeHtml(projectName) });
  dialog.appendChild(nameDisplay);

  // Confirmation input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'w-full px-3 py-2.5 font-mono text-sm border border-border rounded-sm bg-surface text-text transition-all duration-180 outline-none focus:border-accent focus:ring-3 focus:ring-accent-subtle shadow-sm';
  input.placeholder = t('delete.inputPlaceholder');
  input.setAttribute('aria-label', t('delete.inputPlaceholder'));
  dialog.appendChild(input);

  // Status message area
  const statusEl = document.createElement('p');
  statusEl.className = 'text-sm text-text-muted';
  dialog.appendChild(statusEl);

  // Button row
  const buttonRow = document.createElement('div');
  buttonRow.className = 'flex gap-3 justify-end mt-4';

  const cancelBtn = button(t('delete.cancel'), 'secondary');
  cancelBtn.type = 'button';

  const confirmBtn = button(t('delete.confirm'), 'danger');
  confirmBtn.type = 'button';
  confirmBtn.disabled = true;

  buttonRow.appendChild(cancelBtn);
  buttonRow.appendChild(confirmBtn);
  dialog.appendChild(buttonRow);

  overlayEl.appendChild(dialog);
  document.body.appendChild(overlayEl);

  // Focus the input
  input.focus();

  // Enable/disable confirm button based on exact name match
  input.addEventListener('input', () => {
    const match = input.value === projectName;
    confirmBtn.disabled = !match;
  });

  // Cancel: close dialog
  cancelBtn.addEventListener('click', () => {
    closeDialog(overlayEl);
  });

  // Close on overlay click (outside dialog)
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) {
      closeDialog(overlayEl);
    }
  });

  // Close on Escape key
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      closeDialog(overlayEl);
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
    confirmBtn.textContent = t('delete.deleting');
    statusEl.className = 'text-sm text-text-muted';
    statusEl.textContent = t('delete.deleting');

    const result = await deleteProject(projectName);

    if (result.ok) {
      statusEl.className = 'text-sm text-success';
      statusEl.textContent = t('delete.success', { name: projectName });
      invalidateSearchIndex();
      // Navigate to home after a brief delay
      setTimeout(() => {
        closeDialog(overlayEl);
        document.removeEventListener('keydown', onKeyDown);
        window.location.hash = '#/projects';
      }, 1200);
    } else {
      // Show error, re-enable confirm button
      statusEl.className = 'text-sm text-error';
      statusEl.textContent = result.error;
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      input.disabled = false;
      confirmBtn.textContent = t('delete.confirm');
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
