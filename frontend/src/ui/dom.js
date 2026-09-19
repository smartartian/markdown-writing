export function qs(selector, context = document) {
  return context.querySelector(selector);
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function autoResizeTextarea(element) {
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = element.scrollHeight + 'px';
}
