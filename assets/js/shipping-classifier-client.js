// Per-view async lifecycle; no order mutation, persistence, or price calculation.
export function createShippingClassifier({ request, getAuth, onResult }) {
  const slots=new Map(), cache=new Map();
  const keyFor=order=>JSON.stringify([order?.item_name || '',order?.request_text || '']);
  const cacheKey=order=>JSON.stringify([getAuth(),keyFor(order)]);
  function cancel(view) {
    const slot=slots.get(view);
    slots.delete(view);
    slot?.controller.abort();
  }
  return {
    get:order=>cache.get(cacheKey(order)),
    ensure(view, order) {
      const auth=getAuth(), key=keyFor(order), ckey=cacheKey(order);
      const previous=slots.get(view);
      if(previous?.key===key && previous.auth===auth) return previous.promise;
      cancel(view);
      if(cache.has(ckey)) return Promise.resolve(cache.get(ckey));
      const slot={key,auth,controller:new AbortController()};
      slots.set(view,slot);
      const snapshot={item_name:order.item_name,request_text:order.request_text,vin:order.vin};
      slot.promise=Promise.resolve().then(()=>request(snapshot,{signal:slot.controller.signal}))
        .catch(()=>({status:'unavailable'}))
        .then(result=>{
          if(slots.get(view)!==slot || getAuth()!==auth || slot.controller.signal.aborted) return;
          cache.set(ckey,result);
          if(cache.size>100) cache.delete(cache.keys().next().value);
          onResult(view);
          return result;
        });
      return slot.promise;
    },
    cancel,
    clear() {for(const view of slots.keys())cancel(view);cache.clear();},
  };
}
