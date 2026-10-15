import { adminUser, unauthorized } from '../../_lib/auth.js';
import { json } from '../../_lib/http.js';
import { supportAvailable, boundedSupportJSON, requestSlavikSupport } from '../../_lib/slavik-support.js';

export async function onRequest({request,env}) {
  const user=adminUser(request,env);
  if (!user) return unauthorized();
  if (user.id!=='andrii') return json({error:'Підтримка доступна лише Андрію.'},{status:403});
  if (!supportAvailable(env,user.id)) return json({error:'Підтримка Славика ще не налаштована.'},{status:503});
  const url=new URL(request.url);
  try {
    if (request.method==='GET') {
      if ([...url.searchParams].length) return json({error:'Некоректний запит.'},{status:400});
      return json(await requestSlavikSupport(env,'status'));
    }
    if (request.method!=='POST') return json({error:'Method not allowed'},{status:405,headers:{allow:'GET, POST'}});
    const entries=[...url.searchParams];
    if (entries.length!==1 || entries[0][0]!=='action' || !['connect','confirm','close'].includes(entries[0][1])) return json({error:'Некоректна дія підтримки.'},{status:400});
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return json({error:'Потрібен запит JSON.'},{status:415});
    const data=await boundedSupportJSON(request);
    return json(await requestSlavikSupport(env,entries[0][1],data));
  } catch(error) {
    return json({error:error.publicMessage || 'Не вдалося перевірити підтримку Славика.'},{status:error.status || 502});
  }
}
