import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Pause, Play } from 'lucide-react';
import { createOnboardingScene } from '../lib/onboarding-scene';
import { createIntroductionDesigns, introductionPhase, ONBOARDING_DURATIONS } from '../lib/onboarding';
import './onboarding.css';
const titles=['你可以自由设计','与垫料配合，打造鼠鼠的秘密基地','可以模块化组装','把喜欢的搭配，带回家'];
const magneticCaptions=['看看组件底部的磁铁','揭开完整表层，露出内嵌铁片','小屋和楼梯，吸附到平台上','方糖小屋，还能吸在 L 型屋顶上'];
const beddingCaptions=['在礼物盒小屋内开洞','安装向下连通管道','向下探索，通往垫料空间'];
const steps=[{title:'复制配置码私信',description:'在清单中复制编号，私信发给我们'},{title:'预定下单',description:'确认搭配与需求，完成预定'},{title:'等待收货',description:'收到后，亲手组装你的小家'}];
function StepArtwork({step}:{step:number}) {
 return <svg viewBox="0 0 112 94" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
  <ellipse cx="56" cy="82" rx="43" ry="7" fill="currentColor" opacity=".07" stroke="none"/>
  {step===0?<><rect x="20" y="10" width="44" height="68" rx="9" fill="#fbfaf3"/><path d="M35 17h14M38 70h8"/><rect x="28" y="29" width="28" height="25" rx="4" fill="#dbe7cf" stroke="none"/><path d="M34 37h16M34 44h10"/><path d="M63 31h31a7 7 0 0 1 7 7v18a7 7 0 0 1-7 7H80l-11 9v-9h-6a7 7 0 0 1-7-7V38a7 7 0 0 1 7-7Z" fill="#dbe7cf"/><path d="m69 46 6 6 12-12"/></>:
   step===1?<><rect x="24" y="17" width="64" height="62" rx="8" fill="#fbfaf3"/><rect x="42" y="10" width="28" height="14" rx="5" fill="#dbe7cf"/><path d="M36 36h30M36 46h19M36 57h14"/><circle cx="80" cy="64" r="20" fill="#dbe7cf"/><path d="m70 64 7 7 13-15"/></>:
   <><path d="m20 33 36-17 36 17v39L56 85 20 72Z" fill="#fbfaf3"/><path d="m20 33 36 15 36-15M56 48v37M39 24l36 15v18l-13 5V44"/><path d="m20 33-9-9 34-16 11 8M92 33l9-9L67 8 56 16" fill="#dbe7cf"/><path d="m45 65 11-8 11 8v12H45Z" fill="#dbe7cf"/></>}
 </svg>;
}

export default function Onboarding({onFinish}:{onFinish:()=>void}) {
 const [page,setPage]=useState(0),[phase,setPhase]=useState(0),[paused,setPaused]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const annotations=useRef<SVGSVGElement>(null);
 const host=useRef<HTMLDivElement>(null),progress=useRef<HTMLSpanElement>(null),runtime=useRef<ReturnType<typeof createOnboardingScene>|null>(null),elapsed=useRef(0),phaseRef=useRef(0),finish=useRef(onFinish);
 finish.current=onFinish;
 const designs=useMemo(createIntroductionDesigns,[]);
 const reduced=useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 function changePage(next:number){
  elapsed.current=0;phaseRef.current=0;setPhase(0);
  if(next===page){runtime.current?.paint(0,reduced.current,paused);return;}
  setReady(next===3);setError('');setPage(next);setAttempt(0);
 }
 useEffect(()=>{
  elapsed.current=0;phaseRef.current=0;setPhase(0);setError('');
  if(page===3){setReady(true);return;}
  setReady(false);let active=true;
  try {runtime.current=createOnboardingScene(host.current!,page as 0|1|2,message=>{if(active){setError(message||'');setReady(!message);}},annotations.current);}
  catch {setError('3D 介绍暂时无法启动，请重试');}
  return()=>{active=false;runtime.current?.dispose();runtime.current=null;};
 },[page,attempt]);
 useEffect(()=>{
  let frame=0,last=0,lastDraw=0,closed=false;
  const tick=(now:number)=>{
   if(closed||document.hidden)return;
   frame=requestAnimationFrame(tick);
   if(!last)last=now;
   if(ready&&!paused){elapsed.current+=Math.min(100,now-last);}
   last=now;
   if(now-lastDraw<1000/30)return;lastDraw=now;
   const t=elapsed.current,duration=ONBOARDING_DURATIONS[page];
   if(progress.current)progress.current.style.transform=`scaleX(${Math.min(1,t/duration)})`;
   const phase=introductionPhase(page,t);if(phase!==phaseRef.current){phaseRef.current=phase;setPhase(phase);}
   runtime.current?.paint(t,reduced.current,paused);
   if(ready&&!paused&&t>=duration){closed=true;cancelAnimationFrame(frame);if(page===3)finish.current();else changePage(page+1);}
  };
  const visibility=()=>{last=0;cancelAnimationFrame(frame);if(!document.hidden&&!closed)frame=requestAnimationFrame(tick);};
  document.addEventListener('visibilitychange',visibility);frame=requestAnimationFrame(tick);
  return()=>{closed=true;cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',visibility);};
 },[page,paused,ready]);
 return <div className="onboarding-content" data-page={page+1} data-phase={phase+1}>
  <header className="onboarding-heading"><span className="onboarding-eyebrow">认识 HamilyMart <span>0{page+1} / 04</span></span><h2 id="modal-title">{page===1?<>与垫料配合<br/>打造鼠鼠的秘密基地</>:titles[page]}</h2></header>
  {page<3?<div className="onboarding-visual">
   <div ref={host} className="onboarding-canvas">
    {page>0&&<svg ref={annotations} className="onboarding-annotations" aria-label="模型结构指示">
     <defs><marker id="intro-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="#315b45"/></marker></defs>
     <g data-callout="true" style={{display:'none'}}><path data-arrow="true" fill="none" stroke="#315b45" strokeWidth="1.6" markerEnd="url(#intro-arrow)"/><circle data-point="true" r="5.5" fill="none" stroke="#d69736" strokeWidth="2"/><g data-label="true"><rect width="140" height="44" rx="10" fill="#fbfaf3" stroke="#c7d6bc"/><text data-title="true" x="10" y="18"/><text data-description="true" x="10" y="33"/></g></g>
    </svg>}
   </div>
   <div className="onboarding-scene-caption" aria-live="polite">{page===0?<><strong>{designs[phase].title}</strong><span>{designs[phase].layout}</span></>:<strong>{page===1?beddingCaptions[phase]:magneticCaptions[phase]}</strong>}</div>
   {!ready&&<div className="onboarding-loading" role="status"><span>{error||'正在准备模型…'}</span>{error&&<button onClick={()=>setAttempt(n=>n+1)}>重新加载 3D</button>}</div>}
   {page===0&&<div className="onboarding-platform-counts" aria-label="平台数量">{[1,2,3].map((n,i)=><span key={n} className={i===phase?'active':''}>{n} 个平台</span>)}</div>}
  </div>:<div className="onboarding-order" aria-label="预定流程">
   <ol>{steps.map(({title,description},i)=><li key={title} className={phase===i?'active':phase>i?'complete':''}>
    <div className="onboarding-step-art"><StepArtwork step={i}/><span className="onboarding-step-number">{i+1}</span>{phase>i&&<span className="onboarding-step-done"><Check size={16}/></span>}</div>
    <div className="onboarding-step-copy"><strong>{title}</strong><p>{description}</p></div>
   </li>)}</ol>
   <p className={`onboarding-custom ${phase===2?'is-visible':''}`}>有定制需求，也欢迎私信聊聊。</p>
  </div>}
  <footer className="onboarding-footer">
   <div className="onboarding-controls"><div className="onboarding-dots" aria-label="介绍分页">{titles.map((title,i)=><button key={title} aria-label={`第 ${i+1} 页：${title}`} aria-current={i===page?'step':undefined} onClick={()=>changePage(i)}><span/></button>)}</div><button className="onboarding-pause" aria-label={paused?'继续播放介绍':'暂停播放介绍'} onClick={()=>setPaused(p=>!p)}>{paused?<Play size={16}/>:<Pause size={16}/>}</button></div>
   <button className="onboarding-next" onClick={()=>page===3?onFinish():changePage(page+1)}>{page===3?'开始搭建':'下一页'}<ArrowRight size={17}/></button>
  </footer>
  <div className="onboarding-progress" aria-hidden="true"><span ref={progress}/></div>
 </div>;
}
