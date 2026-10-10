// The Romanian page has an organic-search brief; the UA/RU versions remain
// ads-only. Apply after translation so a rebuild cannot restore noindex or
// inherit the unrelated Kyiv AutoRepair location from the layout source.
export function applyRomanianZeekrSeo(document) {
  const url = 'https://evline.com.ua/ro/zeekr-9x-8x/';
  const image = 'https://evline.com.ua/assets/images/zeekr-9x-8x/9x-interior.webp';
  const title = 'Programare Zeekr 9X și 8X pentru România | EVLine';
  const description = 'Programare software și configurare Zeekr 9X și 8X pentru clienți din România: aplicații, Waze, Google Maps, SIM și aplicația Zeekr. Verificăm compatibilitatea.';
  const meta = (attribute, key, value) => {
    let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
    if (!element) { element = document.createElement('meta'); element.setAttribute(attribute, key); document.head.append(element); }
    element.setAttribute('content', value);
  };
  document.title = title;
  meta('name', 'description', description);
  meta('name', 'robots', 'index,follow,max-image-preview:large');
  document.querySelector('link[rel="canonical"]').setAttribute('href', url);
  // Do not advertise deliberately noindexed siblings as search alternates.
  // Human language-menu links are kept untouched on all three pages.
  document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach(link => {
    if (link.previousSibling?.nodeType === 3 && !link.previousSibling.textContent.trim()) link.previousSibling.remove();
    link.remove();
  });
  for (const language of ['ro', 'ro-RO']) {
    const link = document.createElement('link');
    link.setAttribute('rel', 'alternate'); link.setAttribute('hreflang', language); link.setAttribute('href', url);
    document.head.append(link);
  }
  for (const [key, value] of Object.entries({
    'og:type': 'website', 'og:locale': 'ro_RO', 'og:site_name': 'EVLine',
    'og:title': title, 'og:description': description, 'og:url': url,
    'og:image': image, 'og:image:width': '1920', 'og:image:height': '1080',
    'og:image:alt': 'Interior Zeekr 9X cu ecranul multimedia original',
  })) meta('property', key, value);
  for (const [key, value] of Object.entries({
    'twitter:card': 'summary_large_image', 'twitter:title': title,
    'twitter:description': description, 'twitter:image': image,
    'twitter:image:alt': 'Interior Zeekr 9X cu ecranul multimedia original',
  })) meta('name', key, value);

  document.querySelector('#page-title').textContent = 'Programare software Zeekr 9X / 8X';
  document.querySelector('.hero .eyebrow').textContent = 'EVLine · pentru clienți din România';
  document.querySelector('.hero-lead').textContent = 'Aplicații, navigație și conectivitate pentru Zeekr-ul tău.';
  document.querySelector('#services-title').textContent = 'Configurare software și aplicații Zeekr';
  const services = document.querySelector('#services .section-heading');
  const introduction = document.createElement('p');
  introduction.textContent = 'Pentru proprietarii de Zeekr 9X și 8X din România: verificăm versiunea software și opțiunile compatibile, apoi stabilim serviciile și costul.';
  services.append(introduction);
  const cards = [...document.querySelectorAll('.service')];
  cards[0].querySelector('h3').textContent = 'Instalare aplicații Zeekr';
  cards[0].querySelector('p').textContent = 'Instalăm aplicații și magazinul de aplicații pe ecranul original. Verificăm compatibilitatea cu Waze, Google Maps, YouTube și Chrome.';
  cards[1].querySelector('h3').textContent = 'SIM și internet în mașină';
  cards[3].querySelector('h3').textContent = 'Configurare aplicație Zeekr';
  // MA/FA remains visible in the original description and CRM option values.
  document.querySelector('#models-title').textContent = 'Programare Zeekr 9X și Zeekr 8X';
  const faq = document.querySelector('.faq-list');
  for (const [question, answer] of [
    ['Ce include programarea software Zeekr 9X și 8X?', 'Pe această pagină, programarea înseamnă configurarea sistemului multimedia, instalarea aplicațiilor și conectarea serviciilor disponibile. Lucrările depind de model, versiunea software și compatibilitate; nu promitem aceleași funcții pentru toate mașinile.'],
    ['Cum solicit configurarea unui Zeekr din România?', 'Trimite modelul, versiunea software, dacă o cunoști, și funcțiile dorite. Verificăm opțiunile, apoi stabilim modul de efectuare a lucrărilor și prețul înainte de începere. Nu trimite parole sau coduri de autentificare.'],
  ]) {
    const details = document.createElement('details'), summary = document.createElement('summary'), paragraph = document.createElement('p');
    summary.textContent = question; paragraph.textContent = answer; details.append(summary, paragraph); faq.append(details);
  }
  document.querySelector('input[name="contact"]').setAttribute('placeholder', '+40…');

  const serviceId = `${url}#service`;
  const schema = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: title, description,
        inLanguage: 'ro-RO', primaryImageOfPage: { '@type': 'ImageObject', url: image }, mainEntity: { '@id': serviceId } },
      { '@type': 'Service', '@id': serviceId, url: `${url}#services`,
        name: 'Programare software și configurare Zeekr 9X și 8X',
        serviceType: 'Configurare multimedia, instalare aplicații și conectivitate auto',
        description: 'Configurare software pentru Zeekr 9X și 8X: aplicații, SIM și internet, protecție regională disponibilă și aplicația Zeekr prin MA/FA. Compatibilitatea se verifică înainte de lucrări.',
        areaServed: { '@type': 'Country', name: 'Romania' },
        provider: { '@type': 'Organization', name: 'EVLine', url, telephone: '+380630630304' },
        mainEntityOfPage: { '@id': `${url}#webpage` } },
    ],
  };
  document.querySelector('script[type="application/ld+json"]').textContent = JSON.stringify(schema);
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = '/assets/css/zeekr-9x-8x-ro.css?v=20261010-seo';
  document.head.append(stylesheet);
}
