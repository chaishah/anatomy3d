const controls = {
  bone: document.querySelector('#bonesToggle'),
  artery: document.querySelector('#arteriesToggle'),
  vein: document.querySelector('#veinsToggle'),
};

const buttons = [...document.querySelectorAll('[data-mobile-layer]')];

function sync() {
  for (const button of buttons) {
    const input = controls[button.dataset.mobileLayer];
    button.classList.toggle('active', Boolean(input?.checked));
    button.setAttribute('aria-pressed', String(Boolean(input?.checked)));
  }
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    const input = controls[button.dataset.mobileLayer];
    if (!input) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
  });
}

Object.values(controls).forEach((input) => input?.addEventListener('change', sync));
sync();
