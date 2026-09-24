import icons from './icons-data.js?v=20260924-separate';

export function icon(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(icons[name] || []).map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([key]) => key !== 'key').map(([key, value]) => `${key}="${value}"`).join(' ')}/>`).join('')}</svg>`;
}
