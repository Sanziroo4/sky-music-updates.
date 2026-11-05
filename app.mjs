import {BASE,INPUT,OUTPUT,names,hex,signed,decode,encode,examples,createMachine,step,run} from './engine.mjs';
import {Timeline} from './playback.mjs';
const $=id=>document.getElementById(id), $$=query=>[...document.querySelectorAll(query)];
const reduced=matchMedia('(prefers-reduced-motion: reduce)'), timeline=new Timeline();
let config=examples.add,machine=createMachine(config),snapshots=[],instructionBase={state:structuredClone(machine),length:0};
let mode='lab',activeKind='machine',generation=0,taskActive=false,inFlight=false,playing=false,preview=null,previewResultReady=false,activeField=0;
let defensePart=0,predictionSeen=false,lockInput=42,coreIndex=-1,clock=0,corePending=null,pipelinePending=null;
const stages=['FETCH','DECODE','EXECUTE'];
const help={opcode:'Нұсқаулар тобын таңдайды.',rs:'Бірінші көз регистрі; lw/sw үшін base адресі.',rt:'Екінші көз регистрі; addi/lw үшін нәтиже регистрі.',rd:'R форматындағы нәтиже регистрі.',shamt:'Ығыстыру мөлшері. Бұл оқу жиынындағы R амалдары үшін 0.',funct:'SPECIAL тобындағы нақты амал: 0x20 ADD, 0x21 ADDU, 0x24 AND, 0x25 OR, 0x2A SLT.',imm16:'Таңбалы immediate 32 битке таңбамен кеңейтіледі. Тармақта сөз ығысуы ретінде 4-ке көбейеді.',instr_index:'26 биттік индекс << 2. PC + 4 жоғарғы төрт битімен бірігеді.'};
const coreNames={pc:'PC',l1:'L1I кэші',lower:'L2 / негізгі жад',decoder:'Декодер',regs:'Регистрлер',alu:'ALU',memory:'Деректер жады',wb:'Write-back'};
const coreHit=[['pc',hex(BASE),'PC нұсқау адресін L1I кэшіне береді.'],['l1',hex(0x01095020),'Cache hit: нұсқау L1I ішінде табылды. Ол декодерге шығады.'],['decoder','ADD · $t2','Декодер opcode пен funct-тен ADD амалын, rs/rt/rd өрістерінен регистрлерді анықтайды.'],['regs','7 + 5','Регистрлер файлынан $t0 = 7 және $t1 = 5 оқылады.'],['alu','7 + 5 = 12','ALU қосады. ADD деректер жадын пайдаланбайды, нәтиже write-back жолына өтеді.'],['wb','$t2 ← 12','Write-back нәтижені $t2 регистріне бекітеді. Нұсқау аяқталды.']];
function coreRoute(){return $('cache').value==='hit'?coreHit:[coreHit[0],['l1','L1I · MISS','Cache miss: L1I нұсқауды таппады. Төменгі деңгейге сұрау жіберіледі.'],['lower',hex(BASE),'Сұрау L2 кэшіне немесе негізгі жадқа жетті. Жауапта нұсқау сөзі қайтады.'],['l1',hex(0x01095020),'Жауап төменгі деңгейден L1I-ге қайтты. Енді нұсқау декодерге беріледі.'],...coreHit.slice(2)];}
function motionDuration(){return reduced.matches?0:Number($('speed').value)===2800?800:Number($('speed').value)===1000?600:700;}
function holdDuration(){return Math.max(300,Number($('speed').value)-motionDuration());}
function isDone(s=machine){return s.halted||(s.stage===2&&s.pc===s.end&&s.pending===null&&!(s.pc in s.program));}
function showError(message){$('input-error').hidden=!message;$('input-error').textContent=message||'';}
function syncPlayback(status){playing=status==='playing';document.body.dataset.playback=status;document.body.classList.toggle('is-paused',status!=='playing');const complete=status==='complete';for(const id of ['auto','core-auto','pipeline-auto']){$(id).textContent=complete?'Аяқталды ✓':playing?'Кідірту Ⅱ':'Жалғастыру ▷';$(id).disabled=complete;}}
function cancel(){generation++;timeline.cancel();taskActive=false;inFlight=false;preview=null;corePending=null;pipelinePending=null;$$('.signal-token,.core-signal').forEach(el=>el.remove());$('datapath').dataset.animating='false';syncPlayback('paused');}
function pause(){timeline.pause();syncPlayback('paused');}
function resume(){if(taskActive){timeline.resume();syncPlayback('playing');}else start(activeKind);}
function toggle(){if(playing)pause();else resume();}
function currentDecode(s=preview||machine){try{return s.decoded||decode(s.ir??s.program[s.pc]??0);}catch{return null;}}
function resetMachine(c,input=lockInput){config=structuredClone(c);lockInput=input;machine=createMachine(config,input);snapshots=[];instructionBase={state:structuredClone(machine),length:0};activeField=0;predictionSeen=false;showError('');}
function load(c,input=lockInput,auto=true){cancel();activeKind='machine';resetMachine(c,input);renderMachine();if(auto)start('machine');}
function shouldPredict(){return mode==='defense'&&defensePart>=2&&machine.stage===1&&machine.decoded?.name==='bne'&&!predictionSeen;}
function showMode(next){cancel();if(location.hash==='#home')window.history.replaceState(null,'',location.pathname+location.search);mode=next;$('home').hidden=true;$('workspace').hidden=false;$('nav').hidden=false;document.body.classList.toggle('projector',next==='defense');
  const titles={lab:['ИНТЕРАКТИВТІ ЗЕРТХАНА / 01','Бір нұсқау. Үш саты.'],lock:['ӨМІРДЕГІ ТӘЖІРИБЕ / 02','Кодтан — қозғалысқа.'],core:['НАҚТЫ ЯДРО / 03','Нұсқаудың ұзақ жолы.'],pipeline:['КОНВЕЙЕР / 04','Бір уақытта, әртүрлі сатыда.'],defense:['ҚОРҒАУ / 05','Көр. Болжа. Тексер.']};
  $('section-kicker').textContent=titles[next][0];$('section-title').textContent=titles[next][1];$$('[data-mode]').forEach(el=>{el.classList.toggle('active',el.dataset.mode===next);el.setAttribute('aria-current',el.dataset.mode===next?'page':'false');});
  $('machine-view').hidden=!['lab','lock','defense'].includes(next);$('core-view').hidden=next!=='core';$('pipeline-view').hidden=next!=='pipeline';$('lab-tools').hidden=next!=='lab';$('lock-panel').hidden=next!=='lock';$('defense-guide').hidden=next!=='defense';$('comparison').hidden=true;
  if(next==='lab')load(examples[$('example').value]||examples.add);if(next==='lock')load(examples.lock,Number($('lock-code').value)||0);if(next==='core')replayCore();if(next==='pipeline')replayPipeline();if(next==='defense'){defensePart=0;applyDefense();}window.scrollTo({top:0,behavior:'instant'});
}
function applyDefense(){cancel();$('core-view').hidden=defensePart!==1;$('pipeline-view').hidden=true;$('machine-view').hidden=defensePart===1;$('lab-tools').hidden=true;$('lock-panel').hidden=defensePart<2;
  $('defense-text').textContent=['01 / 04 · Бір ADD нұсқауының үш сатысы.','02 / 04 · Нақты ядро: кэштен нәтижеге дейін. Конвейерді жеке мәзірден ашуға болады.','03 / 04 · Код 42. bne алдында тоқтап, келесі адресті болжаңыз.','04 / 04 · Код 17. Delay slot және 0 шығыс сигналы.'][defensePart];$('defense-next').textContent=defensePart===3?'Қорғауды басынан ↺':'Келесі бөлім →';
  if(defensePart===0)load(examples.add);if(defensePart===1)replayCore();if(defensePart>=2){$('lock-code').value=defensePart===2?42:17;load(examples.lock,Number($('lock-code').value));}
}
function center(el,container){const r=el.getBoundingClientRect(),p=container.getBoundingClientRect();return {x:r.left-p.left+r.width/2,y:r.top-p.top+r.height/2};}
async function travel(container,selectors,label,id,kind='signal-token',onArrival=null){
  if(id!==generation)return false;
  const token=document.createElement('span');token.className=kind;token.textContent=label;token.setAttribute('aria-hidden','true');container.append(token);
  const points=selectors.map(selector=>container.querySelector(selector)).filter(Boolean).map(el=>center(el,container));
  if(points.length<2||reduced.matches){if(onArrival)onArrival(token);token.remove();return id===generation;}
  const frames=points.map((p,i)=>({transform:`translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`,opacity:i===0?.65:1,offset:i/(points.length-1)}));
  const animation=timeline.animate(token,frames,{duration:motionDuration(),easing:'ease-in-out',fill:'forwards'});
  const checkpoint=onArrival?(async()=>{if(await timeline.sleep(motionDuration()/2)&&id===generation)onArrival(token);})():Promise.resolve();
  const ok=await animation;await checkpoint;token.remove();return ok&&id===generation;
}
async function machineFrame(id){
  if(isDone())return false;
  if(shouldPredict()){syncPlayback('paused');renderMachine();return false;}
  const before=structuredClone(machine),target=step(machine);
  if(target.stage===0&&(before.stage===-1||before.stage===2))instructionBase={state:structuredClone(before),length:snapshots.length};
  inFlight=true;preview=target;previewResultReady=false;renderMachine();$('datapath').dataset.animating='true';
  const d=currentDecode(target),e=target.effect;let path,label;
  if(target.stage===0){path=['pc','imem','ir'];label=hex(target.instrPC);}
  else if(target.stage===1){path=['ir','decoder','registers'];label=d?.name.toUpperCase()||'ҚАТЕ';}
  else {path=['registers','alu',...(e?.overflow?[]:['wb']),...(d?.name==='lw'?['registers']:[])];const ops=operands(target,d);label=d?.name==='nop'?'NOP':`${signed(ops.a)} / ${signed(ops.b)}`;}
  if(!await travel($('datapath'),path.map(n=>`[data-node="${n}"]`),label,id,'signal-token',token=>{
    if(target.stage===0)token.textContent=hex(target.ir);
    if(target.stage===2){previewResultReady=true;renderMachine();token.textContent=e?.overflow?String(e.rawResult):e?.address!==undefined?hex(e.address):e?.result!==undefined?String(signed(e.result)):e?.branch?hex(target.pc):'NOP';}
  }))return false;
  if(id!==generation)return false;
  snapshots.push(before);machine=target;preview=null;inFlight=false;$('datapath').dataset.animating='false';renderMachine();return true;
}
async function start(kind,one=false){cancel();activeKind=kind;taskActive=true;syncPlayback('playing');const id=generation;
  try{
    do{
      if(kind==='machine'&&machine.steps>=300&&!one){showError('Автоматты жүріс 300 қадамнан кейін тоқтады. Циклді тексеріңіз немесе қолмен жалғастырыңыз.');break;}
      const ok=kind==='machine'?await machineFrame(id):kind==='core'?await coreFrame(id):await pipelineFrame(id);
      if(!ok||id!==generation)break;
      const finished=kind==='machine'?isDone():kind==='core'?coreIndex===coreRoute().length-1:clock===6;
      if(finished){syncPlayback('complete');break;}
      if(one){syncPlayback('paused');break;}
      if(!await timeline.sleep(holdDuration())||id!==generation)break;
    }while(id===generation);
  }finally{if(id===generation){taskActive=false;inFlight=false;if(playing)syncPlayback('paused');}}
}
function stageReplay(stage){cancel();activeKind='machine';machine=structuredClone(instructionBase.state);snapshots=snapshots.slice(0,instructionBase.length);predictionSeen=false;for(let i=0;i<stage;i++){snapshots.push(structuredClone(machine));machine=step(machine);}renderMachine();start('machine',true);}
function goBack(){const pending=inFlight;cancel();if(!pending&&snapshots.length)machine=snapshots.pop();predictionSeen=false;const fetchIndex=snapshots.findLastIndex(s=>s.stage===-1||s.stage===2&&s.pc===machine.instrPC);if(fetchIndex>=0)instructionBase={state:structuredClone(snapshots[fetchIndex]),length:fetchIndex};else instructionBase={state:createMachine(config,lockInput),length:0};renderMachine();}
function operands(s,d){if(d?.name==='j')return {a:(s.instrPC+4)>>>0,b:d.index*4,leftName:'PC + 4',rightName:'index << 2'};const e=s.effect,a=e?.a??s.regs[d?.rs??8],b=e?.right??(['addi','lw','sw'].includes(d?.name)?d.imm:s.regs[d?.rt??9]);return {a,b,leftName:'$'+names[d?.rs??8],rightName:['addi','lw','sw'].includes(d?.name)?'immediate':'$'+names[d?.rt??9]};}
function equation(d,e){if(!e)return 'Операндтар → амал';if(e.overflow)return `${signed(e.a)} + ${e.right} = ${e.rawResult}`;if(e.address!==undefined)return `${hex(e.a)} + (${d.imm}) = ${hex(e.address)}`;if(e.branch)return d.name==='j'?`j → ${hex(e.target)}`:`${signed(e.a)} ${d.name==='beq'?'=':'≠'} ${signed(e.b)} → ${e.taken?'иә':'жоқ'}`;if(d.name==='nop')return 'NOP · күй өзгермейді';return `${signed(e.a)} ${{add:'+',addu:'+',addi:'+',and:'AND',or:'OR',slt:'<'}[d.name]} ${d.name==='addi'?d.imm:signed(e.b)} = ${signed(e.result)}`;}
function explanation(s,d,pending){
  if(s.error)return 'ALU есептеуді орындады. Төмендегі ескертуге байланысты нәтиже регистрге бекітілмеді.';
  if(s.stage<0)return 'PC нұсқау адресін көрсетеді. Көрсетілім Fetch сатысынан басталады.';
  if(s.stage===0)return pending?`PC ${hex(s.instrPC)} адресін жадыға береді. ${hex(s.ir)} сөзі IR-ге қарай жылжып келеді.`:`${hex(s.ir)} сөзі IR-ге жетті. IR оны келесі Decode сатысы үшін ұстайды. PC + 4 = ${hex((s.instrPC+4)>>>0)}.`;
  if(s.stage===1)return d.name==='nop'?'32 нөл бит nop нұсқауын білдіреді. Delay slot та осы үш сатыдан толық өтеді.':`Декодер ${d.name.toUpperCase()} амалын таныды. ${d.format} форматы. ${d.format==='R'?`opcode = 0 — SPECIAL; funct = 0x${d.funct.toString(16).toUpperCase()} — ${d.name.toUpperCase()}.` :d.format==='I'?`imm16 = ${d.imm}, таңбамен 32 битке кеңейеді.`:'26 биттік индекс PC + 4 жоғарғы төрт битімен бірігеді.'} Өрістерді төменнен жеке ашыңыз.`;
  const e=s.effect;if(!e)return '';
  if(d.name==='nop')return `nop күйді өзгертпейді. Келесі Fetch ${hex(s.pc)}${s.delay?' — delay slot аяқталғаннан кейінгі адрес.':'.'}`;
  if(e.branch)return `${d.name==='j'?'Секіру есептелді':e.taken?'Тармақ алынды':'Тармақ алынбады'}. Алдымен ${hex(e.seq)} адресіндегі delay slot орындалады. Одан кейін ${hex(s.pending)} оқылады.`;
  if(d.name==='lw')return `${hex(e.address)} адресінен ${e.result} оқылып, $${names[d.rt]} регистріне ${pending?'барады':'жазылды'}. Бағыт: жад → регистр.`;
  if(d.name==='sw')return `$${names[d.rt]} = ${e.write} мәні ${hex(e.address)} адресіне ${pending?'барады':'жазылды'}. Бағыт: регистр → жад.${e.address===OUTPUT?' Құлыпты осы шығыс сигналы басқарады.':''}`;
  return `${equation(d,e)}. ALU → ${e.dest===0?'$zero: нәтиже тасталады':`$${names[e.dest]}`}. ${pending?'Сигнал жеткенде ғана мән бекітіледі.':'Нәтиже бекітілді.'}`;
}
function renderMachine(){
  const s=preview||machine,d=currentDecode(s),pending=!!preview,visible=pending?machine:s,e=s.effect,stage=s.stage;const resultVisible=!pending||previewResultReady;
  document.body.dataset.stage=Math.max(0,stage);$('step-count').textContent=`${s.steps} ҚАДАМ${s.error?' / ҚАТЕ':isDone(s)?' / АЯҚТАЛДЫ':pending?' / ҚОЗҒАЛЫС':''}`;
  $$('[data-stage]').forEach(b=>{const active=Number(b.dataset.stage)===stage;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('instruction-asm').textContent=d?.asm||'Белгісіз нұсқау';$('instruction-word').textContent=hex(s.ir??s.program[s.pc]??0);$('delay-badge').hidden=!s.delay;$('pc-value').textContent=hex(visible.pc);$('imem-value').textContent=hex(s.instrPC);$('ir-value').textContent=visible.ir===null?'—':hex(visible.ir);
  const ops=operands(s,d);$('operands').textContent=`${signed(ops.a)} / ${signed(ops.b)}`;$('operand-names').textContent=`${ops.leftName} = ${signed(ops.a)} · ${ops.rightName} = ${signed(ops.b)}`;
  $('decoder-value').textContent=stage>=1?(d?`${d.format} · ${d.name.toUpperCase()}`:'Белгісіз нұсқау'):'opcode · rs · rt · rd · funct';
  $('alu-label').textContent=e?.overflow?'EXECUTE / ALU · OVERFLOW':e?.branch?'КЕЛЕСІ АДРЕСТІ ТАҢДАУ':e?.address!==undefined?'BASE + SIGN EXTEND':'АМАЛ ЖӘНЕ НӘТИЖЕ';
  $('alu-value').textContent=stage===2&&resultVisible?(e?.overflow?String(e.rawResult):e?.address!==undefined?hex(e.address):e?.branch?(e.taken?'TAKEN':'NOT TAKEN'):e?.result!==undefined?String(signed(e.result)):'NOP'):'ALU';$('alu-detail').textContent=stage===2?(resultVisible?equation(d,e):`${signed(ops.a)} / ${signed(ops.b)} → ALU`):'Операндтар → амал';
  const dest=e?.dest??(d?.format==='R'?d.rd:d?.rt),isMem=['lw','sw'].includes(d?.name),branch=['beq','bne','j'].includes(d?.name);
  $('wb-label').textContent=e?.overflow?'РЕГИСТРГЕ ЖАЗУ БҰҒАТТАЛДЫ':isMem?(d.name==='lw'?'ЖАД → РЕГИСТР':'РЕГИСТР → ЖАД'):branch?'DELAY SLOT → PC':'НӘТИЖЕ РЕГИСТРІ';
  $('wb-value').textContent=isMem?(e?.address!==undefined?hex(e.address):'Деректер жады'):branch?'PC':dest!==undefined?'$'+names[dest]:'WB';
  $('wb-detail').textContent=e?.overflow?`$${names[dest]} = ${signed(visible.regs[dest])}`:pending?'Сигналды күту':s.changed?`${signed(s.changed.before)} → ${signed(s.changed.after)}`:e?.branch?hex(s.pc):'Жазуды күту';
  $$('[data-node]').forEach(el=>el.classList.remove('lit','active'));
  const active=stage===0?['pc','imem','ir']:stage===1?['ir','decoder','registers']:stage===2?e?.overflow?['registers','alu']:['registers','alu','wb']:[];
  for(const node of active)document.querySelector(`[data-node="${node}"]`).classList.add('lit','active');$$('.fetch-wire').forEach(el=>el.classList.toggle('lit',stage===0));$$('.execute-wire').forEach(el=>el.classList.toggle('lit',stage===2));
  const seq=(s.instrPC+4)>>>0;let target=null;if(d&&['beq','bne'].includes(d.name))target=(seq+d.imm*4)>>>0;if(d?.name==='j')target=((seq&0xf0000000)|(d.index<<2))>>>0;
  $('sequential').textContent=hex(seq);$('target').textContent=target===null?'—':hex(target);$('next-pc').textContent=stage===2?hex(s.pc):s.delay?hex(s.pending):hex(seq);$('stage-label').textContent=`${stages[Math.max(0,stage)]} / ${String(Math.max(0,stage)+1).padStart(2,'0')}`;
  $('stage-value').textContent=stage===0?hex(s.ir):stage===1?d?.name.toUpperCase()||'ҚАТЕ':stage===2?(resultVisible?equation(d,e):'Операндтар → ALU'):hex(BASE);
  $('stage-destination').textContent=stage===0?'PC → жады → IR':stage===1?'IR → өрістер → регистрлер':e?.overflow?'ALU → жазу бұғатталды':isMem?d.name==='lw'?'Жад → регистр':'Регистр → жад':branch?'Салыстыру → delay slot → PC':'ALU → write-back';
  $('explanation').textContent=explanation(s,d,pending);$('machine-error').hidden=pending||!s.error;$('machine-error').textContent=s.error?s.error.replace(/^Signed overflow:\s*/,''):'';
  $('completion').hidden=pending||!isDone(s)||!!s.error;$('completion').textContent=mode==='lock'||mode==='defense'&&defensePart>=2?`Нәтиже: OUT = ${s.mem[OUTPUT]||0} · ${s.mem[OUTPUT]===1?'құлып ашық':'құлып жабық'}`:`Көрсетілім аяқталды · келесі PC ${hex(s.pc)}`;
  $('prediction').hidden=!shouldPredict();$('back').disabled=!snapshots.length&&!pending;$('next').disabled=isDone(s)&&!pending;$('next-instruction').disabled=isDone(s)&&!pending;
  const reg=r=>`<div class="register-chip ${!pending&&s.changed?.type==='reg'&&s.changed.key===r?'changed':''}" data-register="${r}" data-value="${visible.regs[r]}"><span>$${names[r]} <small>${r}</small></span><span class="value" title="${hex(visible.regs[r])}">${signed(visible.regs[r])}</span></div>`;
  const relevant=[...new Set([0,d?.rs??8,...(d?.name==='nop'?[]:[d?.rt??9]),...(dest===undefined?[]:[dest])])].slice(0,5);
  $('registers').innerHTML=relevant.map(reg).join('');$('all-registers').innerHTML=names.map((_,r)=>reg(r)).join('');
  $('memory').innerHTML=Object.entries(visible.mem).sort((a,b)=>a[0]-b[0]).map(([address,value])=>`<div class="${!pending&&s.changed?.type==='mem'&&s.changed.key===Number(address)?'changed':''}" data-address="${address}"><code>${hex(Number(address))}${Number(address)===INPUT?' · IN':Number(address)===OUTPUT?' · OUT':''}</code><code>${value} / ${hex(value)}</code></div>`).join('');
  $('program-list').innerHTML=Object.entries(s.program).map(([address,w])=>{let asm;try{asm=decode(w).asm;}catch{asm='Белгісіз';}return `<div class="im-row ${Number(address)===s.instrPC?'current':''}"><code>${hex(Number(address))} · ${hex(w)}</code><span>${asm}</span></div>`;}).join('');
  $('log').innerHTML=visible.log.map(text=>`<li>${text}</li>`).join('');$('latest-event').textContent=visible.error?`EXECUTE · ${d?.asm||''} · жазу бұғатталды`:visible.log.at(-1)||'Алғашқы Fetch-ті күту.';$('trace-addresses').textContent=visible.trace.map(hex).join(' → ')||'Fetch әлі басталмады.';
  const unlocked=visible.mem[OUTPUT]===1;$('lock-icon').classList.toggle('open',unlocked);$('lock-state').textContent=unlocked?'Құлып ашық':'Құлып жабық';$('lock-signal').textContent=`OUT = ${visible.mem[OUTPUT]||0} · ${hex(OUTPUT)}`;
  renderDecode(s,d,pending);renderActiveDetail(s,d,pending,resultVisible);$('presentation').textContent=document.body.classList.contains('projector')?'Қалыпты өлшем ↙':'Проектор ↗';
}
function renderActiveDetail(s,d,pending,resultVisible){
  const el=$('active-detail');
  if(s.stage===1&&d){el.innerHTML='<div class="live-fields">'+d.fields.map((f,i)=>`<button data-field="${i}" class="${i===activeField?'selected':''}" aria-pressed="${i===activeField}"><code>${f.bits}</code><small>${f.label} · ${f.size} bit</small></button>`).join('')+'</div>';return;}
  if(s.stage===2){const e=s.effect;let message='NOP · күй өзгермейді';if(e?.overflow)message=`$${names[e.dest]} = ${signed(machine.regs[e.dest])} · жазу бұғатталды`;else if(e?.branch)message=`PC → ${hex(s.pc)} · содан кейін ${hex(s.pending)}`;else if(e?.address!==undefined)message=`${d.name==='lw'?'Жад → $'+names[d.rt]:'$'+names[d.rt]+' → жад'} · ${hex(e.address)}`;else if(e?.dest!==undefined)message=`$${names[e.dest]}: ${pending?signed(machine.regs[e.dest]):signed(s.changed?.before||0)} → ${pending?'сигналды күту':signed(s.regs[e.dest])}`;el.textContent=message;return;}
  el.innerHTML=`<span>PC <code>${hex(s.instrPC)}</code> → нұсқаулар жады</span><span><code>${hex(s.ir??s.program[s.pc]??0)}</code> → IR ${pending?'· сигнал жолда':'· қабылданды'}</span>`;
}
function renderDecode(s,d,pending){
  $('format-label').textContent=d?`${d.format} / 32 BIT`:'?';if(!d){$('bit-fields').replaceChildren();$('field-info').textContent='Нұсқау декодталмады.';return;}
  const unlocked=s.stage>=1;$('decode-panel').classList.toggle('decoding',unlocked&&pending);$('decode-panel').classList.toggle('focused',s.stage===1);
  $('bit-fields').innerHTML=d.fields.map((f,i)=>`<button style="--field-index:${i}" data-field="${i}" class="${i===activeField?'selected':''}" aria-pressed="${i===activeField}"><span>${unlocked?f.bits:'·'.repeat(f.size)}</span><small>${f.label} · ${f.size} bit</small></button>`).join('');
  const f=d.fields[Math.min(activeField,d.fields.length-1)];let more='';if(['rs','rt','rd'].includes(f.label))more=` → $${names[f.value]} → ${signed((pending?machine:s).regs[f.value])}`;if(f.label==='imm16')more=` → signExtend = ${d.imm}`;const opcodeHelp=d.op===0?'0 — SPECIAL, нақты амалды funct таңдайды.':`${d.op} (0x${d.op.toString(16).toUpperCase()}) — ${d.name.toUpperCase()} тобы.`;
  $('field-info').textContent=unlocked?`${f.label} [${f.high}:${f.low}] · ${f.bits}₂ = ${f.value}${more}. ${f.label==='opcode'?opcodeHelp:help[f.label]}`:'Decode сатысында 32 биттік сөз өрістерге бөлінеді. Сатыны басып, оны жеке ойната аласыз.';
  $('signals').innerHTML=unlocked?Object.entries(d.signals).map(([k,v])=>`<code class="${v?'on':''}">${k} = ${v}</code>`).join(''):'<p>Сигналдар Decode кезінде анықталады.</p>';
}
function renderCore(){
  const route=coreRoute(),at=corePending??coreIndex,node=route[at]?.[0],previous=new Set(route.slice(0,Math.max(0,at)).map(item=>item[0]));document.body.dataset.stage=node==='pc'||node==='l1'||node==='lower'?0:node==='decoder'||node==='regs'?1:2;
  $('core-path').innerHTML=Object.entries(coreNames).filter(([key])=>key!=='lower'||$('cache').value==='miss').map(([key,name],i)=>`${i?'<b aria-hidden="true">→</b>':''}<div data-core-node="${key}" class="core-node ${node===key?'active':''} ${previous.has(key)&&node!==key?'complete':''}"><span>${name}</span><small>${key==='memory'?'ADD үшін өткізіледі':node===key?route[at][1]:'32 BIT'}</small></div>`).join('');
  $('core-value').textContent=route[at]?.[1]||'Нұсқауды күту';$('core-explanation').textContent=route[at]?.[2]||'Бағыт PC-ден басталады.';$('cache-explanation').textContent=$('cache').value==='hit'?'Hit: PC → L1I → декодер. Нұсқау кэште бар.':'Miss: PC → L1I → төменгі жад → L1I → декодер. Сұрау мен жауап бөлек көрсетіледі.';
  $('core-back').disabled=coreIndex<0;$('core-next').disabled=coreIndex>=route.length-1;
}
async function coreFrame(id){const route=coreRoute(),next=coreIndex+1;if(next>=route.length)return false;corePending=next;renderCore();inFlight=true;
  const from=route[Math.max(0,next-1)][0],to=route[next][0];if(!await travel($('core-path'),[`[data-core-node="${from}"]`,`[data-core-node="${to}"]`],route[next][1],id,'core-signal'))return false;
  coreIndex=next;corePending=null;inFlight=false;renderCore();return true;
}
function replayCore(){cancel();coreIndex=-1;activeKind='core';renderCore();start('core');}
function renderPipeline(){const current=pipelinePending??clock;document.body.dataset.stage=current<=1?0:current===2?1:2;const phases=['IF','ID','EX','MEM','WB'];
  $('pipeline-lanes').innerHTML=[['add $t2, $t0, $t1',current-1],['and $t5, $t3, $t4',current-2]].map(([name,position],row)=>`<div class="pipeline-lane"><code>${name}</code><div class="pipeline-stops">${phases.map((phase,i)=>`<div class="pipeline-stop ${i===position?'active':''} ${i<position?'done':''}" data-lane="${row}" data-phase="${i}"><strong>${phase}</strong><span>${['Оқу','Тану','Есептеу','Жад','Жазу'][i]}</span></div>`).join('')}</div><p>${position<0?'Келесі тактте басталады':position>4?'Нәтиже бекітілді · аяқталды':`${name.split(' ')[0].toUpperCase()} → ${phases[position]}`}</p></div>`).join('');
  const first=current>5?'аяқталды':phases[current-1]||'күтіп тұр',second=current<2?'әлі басталған жоқ':phases[current-2];$('pipeline-explanation').textContent=`Такт ${current}. Бірінші нұсқау ${first}${current<=5?' сатысында':''}, екіншісі ${second}${current>=2?' сатысында':''}. ${current===6?'Екі нұсқаудың нәтижесі бекітілді.':'Екі жолақ бір тактте қатар жылжиды.'}`;$('clock-label').textContent=`ТАКТ ${current} / 6`;
  const rows=[['Такт',1,2,3,4,5,6],['add $t2','IF','ID','EX','MEM','WB','—'],['and $t5','—','IF','ID','EX','MEM','WB']];$('pipeline').innerHTML=rows.map((row,r)=>row.map((v,c)=>`<div class="${c===0?'pipeline-name':String(v).toLowerCase()} ${r&&c===current?'current':''}">${v}</div>`).join('')).join('');$('pipeline-back').disabled=clock<=1;$('pipeline-next').disabled=clock===6;
}
async function pipelineFrame(id){if(clock>=6)return false;const next=clock+1;pipelinePending=next;renderPipeline();inFlight=true;
  const moves=[0,1].map(lane=>{const phase=next-1-lane;if(phase<0||phase>4)return Promise.resolve(true);const container=$('pipeline-lanes').children[lane].querySelector('.pipeline-stops');return travel(container,[`[data-phase="${Math.max(0,phase-1)}"]`,`[data-phase="${phase}"]`],lane===0?'ADD':'AND',id,'signal-token pipeline-marker');});
  if(!(await Promise.all(moves)).every(Boolean))return false;
  if(id!==generation)return false;clock=next;pipelinePending=null;inFlight=false;renderPipeline();return true;
}
function replayPipeline(){cancel();clock=0;activeKind='pipeline';renderPipeline();start('pipeline');}
function integer(raw,label){if(!/^-?(?:0x[0-9a-f]+|\d+)$/i.test(raw.trim()))throw Error(`${label}: бүтін сан енгізіңіз.`);const n=Number(raw);if(!Number.isSafeInteger(n)||n< -2147483648||n>4294967295)throw Error(`${label}: 32 биттік сан қажет.`);return n;}
function builderHints(){const op=$('operation').value,r=['add','addu','and','or','slt'].includes(op),jump=op==='j';$('rd').disabled=!r;$('rs').disabled=jump||op==='nop';$('rt').disabled=jump||op==='nop';$('immediate').disabled=r||op==='nop';$('builder-hint').textContent=r?'R · opcode 6 | rs 5 | rt 5 | rd 5 | shamt 5 | funct 6':jump?'J · opcode 6 | instr_index 26. Толық адрес енгізіңіз: мысалы 0x00400008.':'I · opcode 6 | rs 5 | rt 5 | imm16 16. Тармақ offset-і сөз санымен беріледі.';}
$('open').onclick=async()=>{cancel();const id=generation;$('home').classList.add('opening');$('open').disabled=true;syncPlayback('playing');if(await timeline.sleep(reduced.matches?0:650)&&id===generation){$('home').classList.remove('opening');$('open').disabled=false;showMode('lab');}};
window.addEventListener('hashchange',()=>{if(location.hash==='#home'){cancel();$('home').hidden=false;$('workspace').hidden=true;$('nav').hidden=true;$('home').classList.remove('opening');$('open').disabled=false;document.body.classList.remove('projector');document.body.dataset.stage=1;window.scrollTo({top:0,behavior:'instant'});}});
$$('[data-mode]').forEach(b=>b.onclick=()=>showMode(b.dataset.mode));$$('[data-stage]').forEach(b=>b.onclick=()=>stageReplay(Number(b.dataset.stage)));
$('auto').onclick=toggle;$('core-auto').onclick=toggle;$('pipeline-auto').onclick=toggle;
$('next').onclick=()=>start('machine',true);$('back').onclick=goBack;$('restart').onclick=()=>load(config,lockInput);
$('next-instruction').onclick=async()=>{cancel();activeKind='machine';taskActive=true;syncPlayback('playing');const id=generation;for(let i=0;i<3;i++){if(!await machineFrame(id)||id!==generation)break;if(machine.stage===0||isDone())break;}if(id===generation){taskActive=false;syncPlayback(isDone()?'complete':'paused');}};
for(const id of ['speed','core-speed','pipeline-speed'])$(id).onchange=()=>{for(const key of ['speed','core-speed','pipeline-speed'])$(key).value=$(id).value;};
$('example').onchange=()=>load(examples[$('example').value]);$('operation').onchange=builderHints;
function selectField(event){const b=event.target.closest('[data-field]');if(b){pause();activeField=Number(b.dataset.field);const s=preview||machine;renderDecode(s,currentDecode(s),!!preview);renderActiveDetail(s,currentDecode(s),!!preview,previewResultReady);if(s.stage===1)$('explanation').textContent=$('field-info').textContent;}}
$('bit-fields').onclick=selectField;$('active-detail').onclick=selectField;
$('trace-toggle').onclick=()=>{$('trace-addresses').hidden=!$('trace-addresses').hidden;$('trace-toggle').setAttribute('aria-expanded',String(!$('trace-addresses').hidden));};$('presentation').onclick=()=>{document.body.classList.toggle('projector');$('presentation').textContent=document.body.classList.contains('projector')?'Қалыпты өлшем ↙':'Проектор ↗';};
$('build-form').onsubmit=e=>{e.preventDefault();pause();try{const name=$('operation').value,rs=Number($('rs').value),rt=Number($('rt').value),rd=Number($('rd').value),a=integer($('a-value').value,'rs мәні'),b=integer($('b-value').value,'rt мәні'),imm=$('immediate').disabled?0:integer($('immediate').value,'Immediate / адрес');if(rs===rt&&a!==b&&!['nop','j'].includes(name))throw Error('Бір регистрге екі түрлі бастапқы мән беру мүмкін емес.');const word=encode({name,rs,rt,rd,imm,target:imm});load({words:['beq','bne','j'].includes(name)?[word,0]:[word],regs:{[rs]:a,[rt]:b}});$('hex-input').value=hex(word);}catch(err){showError(err.message);}};
$('hex-form').onsubmit=e=>{e.preventDefault();pause();try{const text=$('hex-input').value.trim();if(!/^(?:0x)?[a-f0-9]{8}$/i.test(text))throw Error('Дәл 8 hex таңба енгізіңіз: мысалы, 0x01095020.');const word=parseInt(text.replace(/^0x/i,''),16),d=decode(word);load({words:['beq','bne','j'].includes(d.name)?[word,0]:[word],regs:{8:7,9:5,16:0x10010000}});}catch(err){showError(err.message);}};
function setCode(n){$('lock-code').value=n;$('comparison').hidden=true;load(examples.lock,n);}
$('lock-form').onsubmit=e=>{e.preventDefault();const n=Number($('lock-code').value);if(!Number.isInteger(n)||n<0||n>99){showError('Код 0–99 аралығындағы бүтін сан болуы керек.');return;}setCode(n);};$('code42').onclick=()=>setCode(42);$('code17').onclick=()=>setCode(17);
$('compare').onclick=()=>{pause();$('comparison').hidden=!$('comparison').hidden;$('compare').setAttribute('aria-expanded',String(!$('comparison').hidden));$('comparison').innerHTML=[42,17].map(n=>{const s=run(examples.lock,n);return `<div><h3>Код ${n} · OUT = ${s.mem[OUTPUT]}</h3><p>${s.steps-1} оқу сатысы · ${s.trace.length} нұсқау · ${s.mem[OUTPUT]?'ашық':'жабық'}</p><code>${s.trace.map(hex).join(' → ')}</code><p>nop: ${hex(BASE+8)} · ${n===42?'bne алынбады, addi орындалды':'bne алынды, addi өткізіліп кетті'}</p></div>`;}).join('');};
$('cache').onchange=replayCore;$('core-replay').onclick=replayCore;$('core-next').onclick=()=>start('core',true);$('core-back').onclick=()=>{const pending=inFlight;cancel();if(!pending)coreIndex=Math.max(-1,coreIndex-1);renderCore();};$('to-pipeline').onclick=()=>showMode('pipeline');$('pipeline-reset').onclick=replayPipeline;$('pipeline-next').onclick=()=>start('pipeline',true);$('pipeline-back').onclick=()=>{const pending=inFlight;cancel();if(!pending)clock=Math.max(1,clock-1);renderPipeline();};$('defense-next').onclick=()=>{defensePart=(defensePart+1)%4;applyDefense();};$('reveal').onclick=()=>{predictionSeen=true;start('machine');};
for(const [key,c]of Object.entries(examples))if(key!=='lock')$('example').add(new Option(c.title,key));for(const op of ['add','addu','addi','and','or','slt','lw','sw','beq','bne','j','nop'])$('operation').add(new Option(op,op));for(const id of ['rs','rt','rd'])names.forEach((name,index)=>$(id).add(new Option(`$${name} · ${index}`,index)));$('rs').value=8;$('rt').value=9;$('rd').value=10;builderHints();renderMachine();syncPlayback('paused');document.body.dataset.stage=1;
// Details use the same local panel animation; no invisible view keeps a live timeline.
document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('tab-hidden',document.hidden);if(document.hidden)pause();});
reduced.addEventListener('change',()=>{const kind=activeKind;const wasPlaying=playing;cancel();if(kind==='machine')renderMachine();else if(kind==='core')renderCore();else renderPipeline();if(wasPlaying)start(kind);});
