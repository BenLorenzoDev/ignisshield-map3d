// Select only visible walkers' route legs that can occur within the current minute.
// The GPU still interpolates along the original leg coordinates and timestamps.
const IgnisRouteWindow = (() => {
  function select(routes, ids, minute) {
    const start=Math.floor(minute), end=start+1, offsets=[];
    for(const id of ids) {
      const route=routes.get(id); if(!route)continue;
      const {times,segments}=route;
      let lo=1,hi=times.length;
      while(lo<hi) {const mid=(lo+hi)>>>1;if(times[mid]<=start)lo=mid+1;else hi=mid;}
      for(let i=lo;i<times.length&&times[i-1]<end;i++)if(segments[i]>=0)offsets.push(segments[i]);
    }
    return offsets;
  }
  return {select};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=IgnisRouteWindow;
