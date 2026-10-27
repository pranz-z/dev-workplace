export * from './matrix-utils.mjs';
import {navigate as interactiveNavigate} from './matrix-utils.mjs';
export async function navigate(page,key,label){
 if(!await page.evaluate(()=>window.phase7Baseline===true))return interactiveNavigate(page,key,label);
 // Supplemental old-source render only: old rail clipping must not be
 // mistaken for a successful pointer/keyboard journey or fixed with CSS.
 await page.locator(`.workspace-rail [data-section="${key}"]`).dispatchEvent('click');
 await page.locator('.workspace-header h1').filter({hasText:new RegExp(`^${label}$`,'i')}).waitFor();
 await page.evaluate(key=>{(window.phase7BaselineNavigation??=[]).push({key,method:'existing React nav handler; programmatic fixture activation, not reachability proof'});},key);
}

import {selectSurface as realSelect} from './matrix-utils.mjs';
export async function selectSurface(page,surface){
 if(!await page.evaluate(()=>window.phase7Baseline===true))return realSelect(page,surface);
 const names={projects:'Projects',tasks:'Tasks',files:'Files',settings:'Settings',calendar:'Calendar',plans:'Plans',notes:'Notes',accountability:'Accountability',tech:'Tech Stack',portfolio:'Portfolio',github:'GitHub',today:'Today'};
 if(names[surface])return navigate(page,surface,names[surface]);
 return realSelect(page,surface);
}
