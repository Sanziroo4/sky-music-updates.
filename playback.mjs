// One cancellable timeline shared by every demonstration. Pausing preserves time left.
export class Timeline {
  constructor() { this.paused=false; this.waits=new Set(); this.animations=new Set(); }
  sleep(ms) {
    return new Promise(resolve=>{
      const item={remaining:ms,started:0,timer:null,resolve};
      item.arm=()=>{item.started=performance.now();item.timer=setTimeout(()=>{this.waits.delete(item);resolve(true);},Math.max(0,item.remaining));};
      this.waits.add(item);if(!this.paused)item.arm();
    });
  }
  animate(element,keyframes,options) {
    const animation=element.animate(keyframes,options);this.animations.add(animation);
    if(this.paused)animation.pause();
    return animation.finished.then(()=>{this.animations.delete(animation);return true;},()=>{this.animations.delete(animation);return false;});
  }
  pause() {
    if(this.paused)return;this.paused=true;
    for(const item of this.waits) {clearTimeout(item.timer);item.remaining=Math.max(0,item.remaining-(performance.now()-item.started));item.timer=null;}
    for(const animation of this.animations)animation.pause();
  }
  resume() {if(!this.paused)return;this.paused=false;for(const item of this.waits)item.arm();for(const animation of this.animations)animation.play();}
  cancel() {
    for(const item of this.waits){clearTimeout(item.timer);item.resolve(false);}this.waits.clear();
    for(const animation of this.animations)animation.cancel();this.animations.clear();this.paused=false;
  }
}
