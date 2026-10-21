export default {
  async scheduled(_event,env,ctx) {
    ctx.waitUntil((async()=>{
      if(!env.PUMB_CRON_TOKEN) throw new Error('PUMB cron secret is missing');
      const response=await fetch('https://evline.com.ua/api/cron/bank-incoming',{
        method:'POST',redirect:'manual',signal:AbortSignal.timeout(120000),
        headers:{authorization:`Bearer ${env.PUMB_CRON_TOKEN}`},
      });
      if(!response.ok) throw new Error(`PUMB synchronization failed: HTTP ${response.status}`);
    })());
  },
};
