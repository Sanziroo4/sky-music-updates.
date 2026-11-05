// Pure MIPS32 educational machine. One UI step is a stage, not a hardware clock.
export const BASE=0x00400000, INPUT=0x1f000000, OUTPUT=0x1f000004;
export const names=['zero','at','v0','v1','a0','a1','a2','a3','t0','t1','t2','t3','t4','t5','t6','t7','s0','s1','s2','s3','s4','s5','s6','s7','t8','t9','k0','k1','gp','sp','fp','ra'];
export const hex=n=>'0x'+(n>>>0).toString(16).toUpperCase().padStart(8,'0');
export const signed=n=>n|0;
export const sx=n=>(n<<16)>>16;
export function decode(word){
 const w=word>>>0,op=w>>>26,rs=(w>>>21)&31,rt=(w>>>16)&31,rd=(w>>>11)&31,shamt=(w>>>6)&31,funct=w&63,imm=sx(w&65535),index=w&0x3ffffff;
 let name,format=op===0?'R':op===2?'J':'I';
 if(w===0)name='nop'; else if(op===0){name=({32:'add',33:'addu',36:'and',37:'or',42:'slt'})[funct];if(shamt!==0)throw Error('Бұл R нұсқауында shamt 0 болуы керек.');}
 else name=({8:'addi',35:'lw',43:'sw',4:'beq',5:'bne',2:'j'})[op];
 if(!name)throw Error('Қолдау көрсетілмейтін opcode немесе funct. Оқу жиынындағы нұсқауды таңдаңыз.');
 if(name==='addi'||name==='lw'||name==='sw'||name==='beq'||name==='bne')format='I';
 let asm=name;
 if(['add','addu','and','or','slt'].includes(name))asm+=` $${names[rd]}, $${names[rs]}, $${names[rt]}`;
 if(name==='addi')asm+=` $${names[rt]}, $${names[rs]}, ${imm}`;
 if(name==='lw'||name==='sw')asm+=` $${names[rt]}, ${imm}($${names[rs]})`;
 if(name==='beq'||name==='bne')asm+=` $${names[rs]}, $${names[rt]}, ${imm}`;
 if(name==='j')asm+=' '+hex(index*4);
 const widths=format==='R'?[6,5,5,5,5,6]:format==='I'?[6,5,5,16]:[6,26];
 const labels=format==='R'?['opcode','rs','rt','rd','shamt','funct']:format==='I'?['opcode','rs','rt','imm16']:['opcode','instr_index'];
 const binary=w.toString(2).padStart(32,'0');let pos=0;
 const fields=widths.map((size,i)=>{const bits=binary.slice(pos,pos+size),high=31-pos;pos+=size;return {label:labels[i],bits,size,high,low:32-pos,value:parseInt(bits,2)};});
 const writes=['add','addu','addi','and','or','slt','lw'].includes(name);
 return {word:w,op,rs,rt,rd,shamt,funct,imm,index,name,asm,format,fields,signals:{RegWrite:+writes,ALUSrc:+['addi','lw','sw'].includes(name),MemRead:+(name==='lw'),MemWrite:+(name==='sw'),Branch:+['beq','bne'].includes(name),Jump:+(name==='j')}};
}
export function encode({name,rs=8,rt=9,rd=10,imm=0,target=BASE}){
 for(const r of [rs,rt,rd])if(!Number.isInteger(r)||r<0||r>31)throw Error('Регистр нөмірі 0–31 болуы керек.');
 if(name==='nop')return 0;
 const fn={add:32,addu:33,and:36,or:37,slt:42}[name];
 if(fn)return ((rs<<21)|(rt<<16)|(rd<<11)|fn)>>>0;
 if(name==='j'){if(!Number.isInteger(target)||target<0||target>0xffffffff||target%4)throw Error('Секіру адресі 32 бит және 4 байтқа тураланған болуы керек.');return ((2<<26)|((target>>>2)&0x3ffffff))>>>0;}
 const op={addi:8,lw:35,sw:43,beq:4,bne:5}[name];
 if(!op)throw Error('Нұсқау түрі белгісіз.');
 if(!Number.isInteger(imm)||imm< -32768||imm>32767)throw Error('Immediate −32768…32767 аралығында болуы керек.');
 return ((op<<26)|(rs<<21)|(rt<<16)|(imm&65535))>>>0;
}
export const examples={
 add:{title:'01 · Қосу',words:[0x01095020],regs:{8:7,9:5}},
 negative:{title:'02 · Теріс immediate',words:[0x210afffd],regs:{8:7}},
 overflow:{title:'03 · Overflow',words:[0x210a0001],regs:{8:2147483647}},
 memory:{title:'04 · Load / store',words:[0x8e080000,0x21090005,0xae090004],regs:{16:0x10010000},mem:{[0x10010000]:7}},
 branch:{title:'05 · Тармақ',words:[0x11090002,0,0x200a0001,0x200b0002],regs:{8:7,9:7}},
 jump:{title:'06 · Jump',words:[0x08100003,0,0x200a0001,0x200b0002],regs:{}},
 lock:{title:'Электронды құлып',words:[0x8e080000,0x15090002,0,0x200a0001,0xae0a0004],regs:{16:INPUT,9:42},mem:{[OUTPUT]:0}}
};
export function createMachine(config=examples.add,input=42){
 const regs=Array(32).fill(0);for(const [r,v]of Object.entries(config.regs||{}))regs[r]=v>>>0;regs[0]=0;
 const program=Object.fromEntries(config.words.map((w,i)=>[BASE+i*4,w>>>0]));
 return {regs,mem:{...(config.mem||{}),[INPUT]:input},program,end:BASE+config.words.length*4,pc:BASE,instrPC:BASE,ir:null,decoded:null,stage:-1,pending:null,delay:false,halted:false,error:null,trace:[],log:[],changed:null,effect:null,steps:0};
}
export function step(previous){
 const s=structuredClone(previous);if(s.halted)return s;s.changed=null;s.steps++;
 try{
 if(s.stage===-1||s.stage===2){
  if(!(s.pc in s.program)){if(s.pc===s.end&&s.pending===null){s.halted=true;s.log.push('Бағдарлама аяқталды.');return s;}throw Error('Нұсқау адресі жарамсыз: '+hex(s.pc));}
  s.instrPC=s.pc;s.ir=s.program[s.pc];s.decoded=null;s.stage=0;s.delay=s.pending!==null;s.effect=null;s.trace.push(s.pc);s.log.push(`FETCH ${hex(s.pc)} → IR ${hex(s.ir)}`);return s;
 }
 if(s.stage===0){s.decoded=decode(s.ir);s.stage=1;s.log.push('DECODE '+s.decoded.asm);return s;}
 const d=s.decoded,a=s.regs[d.rs]>>>0,b=s.regs[d.rt]>>>0,seq=(s.instrPC+4)>>>0;
 let result,dest,address,write,branch=false,target,taken=false;
 switch(d.name){
 case 'add':case 'addi':{const right=d.name==='addi'?d.imm:signed(b),n=signed(a)+right;if(n>2147483647||n< -2147483648)throw Error('Signed overflow: нәтиже 32 биттік таңбалы санға сыймайды. Регистрге жазу бұғатталды.');result=n>>>0;dest=d.name==='addi'?d.rt:d.rd;break;}
 case 'addu':result=(a+b)>>>0;dest=d.rd;break;
 case 'and':result=(a&b)>>>0;dest=d.rd;break;
 case 'or':result=(a|b)>>>0;dest=d.rd;break;
 case 'slt':result=+(signed(a)<signed(b));dest=d.rd;break;
 case 'lw':case 'sw':address=(a+d.imm)>>>0;if(address%4)throw Error('Жад адресі 4 байтқа тураланбаған: '+hex(address));if(d.name==='lw'){result=(s.mem[address]||0)>>>0;dest=d.rt;}else write=b;break;
 case 'beq':case 'bne':branch=true;taken=d.name==='beq'?a===b:a!==b;target=(seq+d.imm*4)>>>0;break;
 case 'j':branch=true;taken=true;target=((seq&0xf0000000)|(d.index<<2))>>>0;break;
 }
 if(branch&&s.delay)throw Error('Delay slot ішіндегі тармақ бұл оқу моделінде анықталмаған.');
 if(dest!==undefined&&dest!==0){s.regs[dest]=result;s.changed={type:'reg',key:dest,before:previous.regs[dest],after:result};}
 if(write!==undefined){if(address===INPUT)throw Error('Пернетақта адресі тек оқуға арналған.');s.mem[address]=write;s.changed={type:'mem',key:address,before:previous.mem[address]||0,after:write};}
 s.effect={a,b,result,dest,address,write,branch,target,taken,seq,actualNext:s.delay?s.pending:seq};
 s.pc=s.delay?s.pending:seq;s.pending=null;
 if(branch)s.pending=taken?target:(s.instrPC+8)>>>0;
 s.regs[0]=0;s.stage=2;s.log.push(`EXECUTE ${d.asm}${result!==undefined?' → '+result:''}${write!==undefined?' → '+hex(address)+' = '+write:''}${branch?' → '+(taken?'тармақ алынды':'тармақ алынбады')+', delay slot '+hex(seq):''}`);
 }catch(e){s.error=e.message;s.halted=true;s.log.push('ҚАТЕ · '+e.message);}
 return s;
}
export function run(config,input=42,limit=300){let s=createMachine(config,input);while(!s.halted&&s.steps<limit)s=step(s);return s;}
