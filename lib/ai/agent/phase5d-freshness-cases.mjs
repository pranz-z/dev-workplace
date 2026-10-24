// Test-only clock replacement in disposable databases. The actual dispatch RPC is never rewritten.
// Rename the native function temporarily: replacing its catalog body keeps the built-in OID fast path.
export const dispatchTestClock = `alter function pg_catalog.clock_timestamp() rename to phase5d_original_clock_timestamp;
  create function pg_catalog.clock_timestamp() returns timestamptz
  language sql volatile set search_path='' as $$select pg_catalog.current_setting('phase5d.test_tick')::timestamptz$$`;
export const restoreDispatchTestClock = `drop function pg_catalog.clock_timestamp();
  alter function pg_catalog.phase5d_original_clock_timestamp() rename to clock_timestamp`;

export function dispatchFreshnessCases() {
  const cases = [];
  for (const fraction of ['000000','500000','999999']) {
    for (const [name,seconds,accepted] of [['age600',-600,true],['age601',-601,false],['future60',60,true],['future61',61,false]]) {
      cases.push({name:`${name} at .${fraction}`,fraction,seconds,accepted});
    }
  }
  cases.push({name:'fractional issued .001',fraction:'500000',seconds:0,issuedFraction:'001000',accepted:false});
  cases.push({name:'fractional issued .999999',fraction:'500000',seconds:0,issuedFraction:'999999',accepted:false});
  cases.push({name:'whole-second issued at fractional now',fraction:'999999',seconds:0,accepted:true});
  return cases.map((item,index) => {
    const base = Date.UTC(2026,9,16,8)+index*14_400_000;
    return {...item,slot:new Date(base).toISOString(),tick:new Date(base).toISOString().replace('.000Z','.'+item.fraction+'Z'),
      issued:new Date(base+item.seconds*1000).toISOString().replace('.000Z','.'+(item.issuedFraction??'000000')+'Z')};
  });
}
