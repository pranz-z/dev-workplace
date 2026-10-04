import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing} from 'remotion';
import {Video} from '@remotion/media';
import {PaperFrame} from '../components/PaperFrame';
import {SketchStroke} from '../components/SketchStroke';

const ink = '#2B2622';
const paper = '#F4EBDD';
const colors = ['#E8CA7D', '#DBA18D', '#ACBDA0', '#A9C4D6'];
type Shot = {at:number; dur:number; title:string; label?:string; file?:string; from?:number; crop?:[number,number,number,number]; kind?:string};
export const shots: Shot[] = [
  {at:0,dur:3,title:'This is just my portfolio.',label:'THE PUBLIC LAYER',file:'01-portfolio',from:1,crop:[400,120,1120,620]},
  {at:3,dur:4,title:'Real work. A living portfolio.',label:'Real project case studies',file:'01-portfolio',from:3.7,crop:[380,160,1160,760]},
  {at:7,dur:3,title:"But it’s powered by this.",label:'THE PRIVATE WORKSPACE',file:'02-workspace',from:2,crop:[380,80,1440,295]},
  {at:10,dur:4,title:'A workspace for the work.',label:'Projects, tasks, plans, and notes',file:'02-workspace',from:2,crop:[0,0,1100,380]},
  {at:14,dur:4,title:'Move work forward.',label:'Drag & drop. Saved to the database.',file:'03-kanban',from:2.6,crop:[380,210,1440,450],kind:'kanban'},
  {at:18,dur:3,title:'Plan by date.',label:'Timezone-aware calendar',file:'04-calendar',from:3.2,crop:[380,80,1440,920],kind:'calendar'},
  {at:21,dur:3,title:'Hide the noise. Find your focus.',label:'A timer that follows real time',file:'07-focus',from:5.8,crop:[270,80,1440,232]},
  {at:24,dur:2,title:'Keep GitHub close.',label:'Read-only GitHub App',file:'05-github',from:6.5,crop:[1098,922,730,157]},
  {at:26,dur:2,title:'Health, not commit counts.',label:'Track the rhythm of your projects',kind:'health'},
  {at:28,dur:4,title:'AI suggests. You approve.',label:'Attach context. Review before applying.',file:'06-workspace-ai',from:11.2,crop:[500,32,920,1015],kind:'ai'},
  {at:32,dur:3,title:'Choose what becomes public.',kind:'split'},
  {at:35,dur:3,title:'Public AI knows what you publish.',label:'A separate, recruiter-facing concierge',file:'08-public-ai',from:10.5,crop:[1455,390,455,655]},
  {at:38,dur:4,title:'Private by default.',kind:'security'},
  {at:42,dur:3,title:'Build privately. Track the work.',kind:'close'},
];

const ShotScene:React.FC<{shot:Shot}> = ({shot}) => {
  const f=useCurrentFrame(); const {width:w,height:h}=useVideoConfig();
  const portrait=h>w; const square=h===w; const margin=w*.085;
  const heading=portrait?78:square?68:82; const body=portrait?49:square?48:50;
  const entry=interpolate(f,[0,16],[70,0],{extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)});
  const zoom=interpolate(f,[0,shot.dur*30],[1,1.045],{extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)});
  const top=portrait?440:square?280:270;
  const bottom=portrait?420:square?210:165;
  const boxH=h-top-bottom;
  const browserW=w-margin*2;
  const crop=shot.crop;
  let cropW=crop?.[2]??1920, cropH=crop?.[3]??1080;
  // Preserve source geometry; alternate formats focus a smaller source region.
  const boxRatio=browserW/boxH;
  if(cropW/cropH>boxRatio) cropW=cropH*boxRatio; else cropH=cropW/boxRatio;
  let cx=(crop?.[0]??0)+((crop?.[2]??1920)-cropW)/2;
  let cy=(crop?.[1]??0)+((crop?.[3]??1080)-cropH)/2;
  if(shot.file==='02-workspace' && portrait) cx=380;
  const realCrop=(source:[number,number,number,number], y:number, height:number) => <div style={{position:'absolute',left:0,right:0,top:y,height,overflow:'hidden',background:'#292622'}}>
    <div style={{position:'absolute',width:Math.min(browserW,height*source[2]/source[3]),height:Math.min(browserW*source[3]/source[2],height),left:'50%',top:'50%',transform:'translate(-50%,-50%)',overflow:'hidden'}}>
      <div style={{position:'absolute',left:`${-source[0]/source[2]*100}%`,top:`${-source[1]/source[3]*100}%`,width:`${1920/source[2]*100}%`,height:`${1080/source[3]*100}%`}}>
        <Video src={staticFile(`render-media/${shot.file}.mp4`)} trimBefore={Math.round((shot.from??0)*30)} muted style={{width:'100%',height:'100%'}}/>
        {shot.kind==='ai' && <div style={{position:'absolute',left:'26.7%',top:'22%',width:'46.8%',height:'30.4%',background:'#292622'}}/>}
      </div>
    </div>
  </div>;
  const sketch=(text:string,i=0)=> <div style={{border:`3px solid ${ink}`,borderRadius:'18px 25px 16px 21px',background:colors[i%4],padding:square?'14px 20px':portrait?'28px 30px':'22px 36px',boxShadow:`6px 7px 0 ${ink}22`,transform:`translateY(${entry}px) rotate(${i%2?1:-1}deg)`,fontSize:body,lineHeight:1.28}}>{text}</div>;
  const graphic=shot.kind==='split'||shot.kind==='security'||shot.kind==='close'||shot.kind==='health';
  return <AbsoluteFill style={{background:paper,color:ink,fontFamily:'Arial, sans-serif',overflow:'hidden'}}>
    <div style={{position:'absolute',inset:0,opacity:.32,backgroundImage:'repeating-linear-gradient(0deg, #8c735b12 0 1px, transparent 1px 7px), repeating-linear-gradient(92deg,#8c735b08 0 1px,transparent 1px 13px)'}} />
    <div style={{position:'absolute',left:margin,top:h*.085,width:browserW,transform:`translateY(${entry}px)`}}>
      <div style={{fontSize:48,letterSpacing:5,marginBottom:12}}>DEVELOPER WORKPLACE</div>
      <div style={{fontFamily:'Caveat',fontWeight:700,fontSize:heading,lineHeight:1.05}}>{shot.title}</div>
      <div style={{height:13,marginTop:8,width:interpolate(f,[4,24],[0,browserW*.45],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),background:colors[0],transform:'rotate(-1deg)'}} />
    </div>
    {!graphic && shot.file && <PaperFrame style={{left:margin,top:top+entry,width:browserW,height:boxH}} inset={12}>
      <div style={{position:'absolute',inset:0,overflow:'hidden'}}>
        {shot.kind!=='ai' && shot.file!=='05-github' && !(portrait && shot.file==='07-focus') && <div style={{position:'absolute',left:`${-cx/cropW*100}%`,top:`${-cy/cropH*100}%`,width:`${1920/cropW*100}%`,height:`${1080/cropH*100}%`,transform:`scale(${zoom})`}}>
          <Video src={staticFile(`render-media/${shot.file}.mp4`)} trimBefore={Math.round((shot.from??0)*30)} muted style={{width:'100%',height:'100%'}} />
          {shot.file==='02-workspace' && <div style={{position:'absolute',left:0,right:0,top:'36%',bottom:0,background:paper}}/>}
          {shot.kind==='kanban' && <div style={{position:'absolute',left:0,right:0,top:'33.2%',bottom:0,background:paper}}/>}
          {shot.kind==='calendar' && <div style={{position:'absolute',left:0,right:0,top:'44%',bottom:0,background:'#292622'}}/>}
          {shot.kind==='ai' && <div style={{position:'absolute',left:'26.7%',top:'22%',width:'46.8%',height:'30.4%',background:'#292622'}}/>}
        </div>}
        {portrait && shot.file==='07-focus' && realCrop([850,155,410,145],0,boxH)}
        {shot.kind==='ai' && <>
          {realCrop([515,125,890,145],0,boxH*.44)}
          {realCrop([510,855,890,180],boxH*.44,boxH*.30)}
        </>}
        {shot.file==='05-github' && <>
          {realCrop([1105,928,720,142],0,boxH*.55)}
          <div style={{position:'absolute',left:30,right:30,top:boxH*.62,fontSize:body,lineHeight:1.5}}>Commits · PRs · Issues · Releases</div>
        </>}
        {(shot.kind==='kanban'||shot.kind==='calendar') && <div style={{position:'absolute',left:30,right:30,bottom:24,background:paper,padding:20,borderRadius:14,fontSize:body}}>
          <div style={{fontSize:48,marginBottom:18}}>WORKFLOW ILLUSTRATION</div>
          <div style={{display:'flex',gap:20,alignItems:'center',justifyContent:'center'}}>
            <div style={{padding:16,border:`2px dashed ${ink}`,flex:1,textAlign:'center'}}>{shot.kind==='kanban'?'Planned':'Today'}</div>
            <div style={{fontFamily:'Caveat',fontSize:70}}>→</div>
            <div style={{padding:16,border:`2px dashed ${ink}`,flex:1,textAlign:'center',background:colors[2]}}>{shot.kind==='kanban'?'In progress':'New date'}</div>
          </div>
        </div>}
        {shot.kind==='ai' && <div style={{position:'absolute',left:30,right:30,bottom:30,background:paper,padding:20,borderRadius:12,fontSize:body,lineHeight:1.2}}>Review → approve → apply<div style={{fontSize:48,marginTop:8}}>Workflow illustration</div></div>}
      </div>
      <div style={{position:'absolute',left:25,top:-14,width:130,height:35,background:'#e8ca7d99',transform:'rotate(-5deg)'}} />
    </PaperFrame>}
    {shot.kind==='health' && <div style={{position:'absolute',left:margin,top,width:browserW,display:'grid',gap:32}}>{sketch('Project progress',0)}{sketch('Milestones & accountability',2)}{sketch('Commit volume ≠ performance',3)}</div>}
    {shot.kind==='split' && <div style={{position:'absolute',left:margin,top,width:browserW,display:'flex',flexDirection:portrait||square?'column':'row',alignItems:'center',gap:square?14:portrait?30:26}}>
      <div style={{flex:1}}>{sketch('Private workspace',0)}<div style={{fontSize:body,marginTop:square?12:22,lineHeight:square?1.15:1.35}}>Projects · Tasks · Plans · Notes<br/>Calendar · GitHub · AI</div></div>
      <div style={{fontSize:body,textAlign:'center',flex:1}}><div style={{fontFamily:'Caveat',fontSize:square?60:90}}>{portrait||square?'↓':'→'}</div>Explicit publication<br/><span style={{background:colors[2]}}>Safe public projections</span></div>
      <div style={{flex:1}}>{sketch('Public portfolio',3)}<div style={{fontSize:body,marginTop:square?12:22,lineHeight:square?1.15:1.35}}>Profile · Experience · Projects<br/>Case studies · Skills · Resume · AI</div></div>
    </div>}
    {shot.kind==='security' && <div style={{position:'absolute',left:margin,top:portrait?530:350,width:browserW,display:'grid',gridTemplateColumns:portrait?'1fr':'1fr 1fr',gap:portrait?45:55}}>{['Row Level Security','Short-lived GitHub tokens','AI rate limits','Private by default'].map((t,i)=><div key={t} style={{opacity:f>i*10?1:0}}>{sketch('✓ '+t,i)}</div>)}</div>}
    {shot.kind==='close' && <div style={{position:'absolute',left:margin,top:portrait?590:square?410:400,width:browserW}}>
      <div style={{fontFamily:'Caveat',fontSize:portrait?100:96,lineHeight:1.15}}>Let AI help.<br/><span style={{background:colors[0]}}>Publish only what matters.</span></div>
      <div style={{fontSize:body+2,marginTop:65,overflowWrap:'anywhere'}}>frami-devplace.vercel.app</div>
      <div style={{fontSize:body,marginTop:24,lineHeight:1.4}}>Built with Next.js, Supabase, Gemini</div>
    </div>}
    {shot.label && <div style={{position:'absolute',left:margin,bottom:h*.085,width:browserW,fontSize:body,lineHeight:1.2}}>{shot.label}</div>}
    {(shot.kind==='kanban'||shot.kind==='calendar') && <svg width="72" height="90" viewBox="0 0 72 90" style={{position:'absolute',left:margin+browserW*interpolate(f,[20,65],[.27,.7],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)}),top:top+boxH-115}}>
      <path d="M 12 8 L 14 66 L 29 49 L 42 76 L 55 70 L 42 43 L 64 43 Z" fill={paper} stroke={ink} strokeWidth="4"/>
      {f>65 && f<82 && <circle cx="15" cy="15" r={(f-65)*2.4} fill="none" stroke={ink} strokeWidth="3" opacity={1-(f-65)/17}/>}
    </svg>}
    <div style={{position:'absolute',inset:0,transform:`translate(${Math.sin(Math.floor(f/3))*1.2}px,${Math.cos(Math.floor(f/3))*1.2}px)`}}>
      <SketchStroke left={w*.7} top={h*.82} width={w*.19} height={h*.075} color={ink} path="M 10 80 Q 90 20 190 35 M 160 15 L 190 35 L 165 55" viewBox="0 0 200 100" startFrame={10} duration={22}/>
    </div>
    {/* A moving paper edge reveals each shot, without crossfading UI. */}
    {f<12 && <div style={{position:'absolute',inset:0,background:paper,transform:`translateX(${interpolate(f,[0,12],[0,w],{easing:Easing.inOut(Easing.cubic)})}px)`,borderLeft:`4px solid ${ink}`,boxShadow:'-20px 0 30px #2b262222'}}/>}
  </AbsoluteFill>;
};

export const BriefShowcase:React.FC = () => <AbsoluteFill>
  <style>{`@font-face {font-family:Caveat;src:url('${staticFile('fonts/Caveat.ttf')}') format('truetype');}`}</style>
  <Audio src={staticFile('audio/sketchbook-score.wav')}/>
  {shots.map(s=><Sequence key={s.at} from={s.at*30} durationInFrames={s.dur*30} name={s.title}><ShotScene shot={s}/></Sequence>)}
</AbsoluteFill>;




