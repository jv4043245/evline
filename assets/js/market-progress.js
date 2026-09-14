export function marketProgressText(data) {
  if (data?.summary?.vehicle_lookup?.status === 'pending') return 'Визначаємо модель за VIN…';
  const work = data?.summary?.work;
  if (!work) return 'Готуємо пошук…';
  return work.next >= work.total ? 'Завершуємо перевірку пропозицій…' : `Перевірки джерел: ${work.next} / ${work.total}`;
}

export async function finishMarketWork(data, requestStep, onProgress, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  const deadline = now() + 5 * 60 * 1000;
  let failures = 0;
  while (data?.run?.status === 'pending' && data.summary?.work?.version === 1) {
    if (now() > deadline) throw new Error('Пошук збережено частково. Відкрийте вкладку ще раз, щоб продовжити.');
    const until = data.summary.work.lease?.until || 0;
    if (until > now()) await sleep(Math.min(until - now() + 100, 5000));
    try {
      data = await requestStep(data.run.id);
      failures = 0;
      onProgress(data);
      if (data.summary?.vehicle_lookup?.status === 'pending') await sleep(1000);
    } catch (error) {
      // A killed Worker cannot catch its own CPU exception. Its persisted lease
      // expires and the next step records that source as failed, then continues.
      if (![500, 502, 503, 504].includes(error.status) || ++failures > 2) throw error;
      await sleep(1000);
    }
  }
  return data;
}
