import { json } from '../../_lib/http.js';
import { internalSupportAuthorized, readSupportStatus } from '../../_lib/slavik-support.js';

export async function onRequest({request,env}) {
  if (!await internalSupportAuthorized(request,env)) return json({error:'Unauthorized'},{status:401});
  if (request.method!=='GET') return json({error:'Method not allowed'},{status:405,headers:{allow:'GET'}});
  if ([...new URL(request.url).searchParams].length) return json({error:'Invalid request'},{status:400});
  try {return json(await readSupportStatus(env));}
  catch {return json({error:'Support status unavailable'},{status:503});}
}
