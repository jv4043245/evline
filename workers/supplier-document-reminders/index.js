export default {
  async scheduled(controller,env,ctx) {
    const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',hour:'2-digit',hourCycle:'h23'}).format(new Date(controller.scheduledTime)));
    if (hour<9 || hour>18) return;
    ctx.waitUntil((async()=>{
      const response=await fetch('https://evline.com.ua/api/cron/supplier-documents',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),
        headers:{authorization:`Bearer ${env.SUPPLIER_DOCS_CRON_TOKEN}`},
      });
      if (!response.ok) throw new Error(`Supplier document reminders: HTTP ${response.status}`);
      const result=await response.json();
      if (result.failed) throw new Error(`Supplier document reminders: ${result.failed} need manual retry`);
    })());
  },
};
