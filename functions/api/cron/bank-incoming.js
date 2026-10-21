import { json } from '../../_lib/http.js';
import { hash, syncBank } from '../../_lib/bank-incoming.js';
import { bankFailure } from '../../_lib/pumb-api.js';
export async function onRequest({request,env}) {
  if(request.method!=='POST') return json({error:'Method not allowed'},{status:405});
  const token=(request.headers.get('authorization') || '').replace(/^Bearer /,'');
  if(!env.PUMB_CRON_TOKEN || !token || token.length>500 || await hash(token)!==await hash(env.PUMB_CRON_TOKEN)) return json({error:'Unauthorized'},{status:401});
  try {return json(await syncBank(env));}
  catch(error) {return json({error:bankFailure(error)},{status:503});}
}
