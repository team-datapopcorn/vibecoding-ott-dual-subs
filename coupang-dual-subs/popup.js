const toggle = document.getElementById('enableToggle');
const status = document.getElementById('status');

// Load saved state
chrome.storage.local.get(['dualSubEnabled'], (result) => {
  toggle.checked = result.dualSubEnabled !== false;
  updateStatus(toggle.checked);
});

// Toggle handler
toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ dualSubEnabled: enabled });
  updateStatus(enabled);
});

function updateStatus(enabled) {
  if (enabled) {
    status.textContent = '이중자막 ON';
    status.className = 'status active';
  } else {
    status.textContent = '이중자막 OFF';
    status.className = 'status';
  }
}
