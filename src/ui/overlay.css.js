/* Styles for the overlay's shadow root.
   Direction "scorebug": flat dark surfaces lifted by one soft shadow, one type family (Archivo), orange only on small marks
   (the value pill, the +delta, the win bar), red only for a loss. No borders, rings, side bars, glows, gradients or per-letter
   text. Spacing steps are 4, 8, 12 and 16; nothing under 12px. Motion is transform and opacity only, and every motion starts
   from something already on screen: a card grows out of its player's row, a number rolls from the value it had.
   Timings come from transitions.dev. */
(function (root) {
  'use strict';
  const CSS = `
:host{all:initial}
*{box-sizing:border-box}
[hidden]{display:none!important}
#stage{position:fixed;inset:0;pointer-events:none;color:var(--text);
  --ff:"SidelineArchivo","Segoe UI",Roboto,system-ui,-apple-system,sans-serif;
  --ink:rgba(14,16,22,.95);--ink2:#1b1f2a;--ink3:#2a2f3c;--text:#f4f5f8;--mute:#a0a6b6;--accent:#ff6a1f;--accent-ink:#160a03;--bad:#ff5a68;--bad-ink:#1c0508;
  --mx:20px;--my:20px;--z:1;--rest:.45;--u:calc(1px * var(--z));--bh:0px;
  --fs-xs:max(12px,calc(12 * var(--u)));--fs-sm:max(12px,calc(13 * var(--u)));
  --shadow:0 calc(2 * var(--u)) calc(6 * var(--u)) rgba(0,0,0,.3),0 calc(12 * var(--u)) calc(32 * var(--u)) rgba(0,0,0,.4);
  --ease-smooth-out:cubic-bezier(.22,1,.36,1);
  --duration-quick:150ms;--duration-fast:250ms;--duration-medium:350ms;--duration-slow:400ms;--duration-very-slow:500ms;
  --reel-dur:900ms;--reel-ease:cubic-bezier(.16,1,.3,1);
  font:500 calc(13 * var(--u))/1.25 var(--ff);font-stretch:100%}
/* Android caps an overlay window at 80% opacity, so on the TV the panels are fully solid to keep the picture from showing through the text.
   Read from across the room, the text steps up one size. */
#stage.tv{--mx:96px;--my:54px;--ink:#0e1016;--fs-xs:calc(16 * var(--u));--fs-sm:calc(17 * var(--u))}
#stage.tv .r .nm{font-size:calc(18 * var(--u))}

/* ---- the lineup box ---- */
#box{position:absolute;width:calc(300 * var(--u));background:var(--ink);border-radius:calc(16 * var(--u));box-shadow:var(--shadow);overflow:hidden;
  opacity:0;transform:translateY(calc(8 * var(--u)));transition:opacity var(--duration-fast) var(--ease-smooth-out),transform var(--duration-medium) var(--ease-smooth-out)}
/* see-through at rest so the game shows; solid while something is happening (overlay.js wake) */
#box.is-in{opacity:var(--rest);transform:none;transition:opacity 700ms var(--ease-smooth-out),transform var(--duration-medium) var(--ease-smooth-out)}
#box.is-in.awake{opacity:1;transition:opacity var(--duration-fast) var(--ease-smooth-out)}
#stage.c-tl #box,#stage.c-tr #box{transform:translateY(calc(-8 * var(--u)))} #stage.c-tl #box.is-in,#stage.c-tr #box.is-in{transform:none}
#stage.c-bl #box{left:var(--mx);bottom:var(--my)} #stage.c-br #box{right:var(--mx);bottom:var(--my)}
#stage.c-tl #box{left:var(--mx);top:var(--my)} #stage.c-tr #box{right:var(--mx);top:var(--my)}
#stage.multi #box{width:calc(280 * var(--u))}

.tabs{position:relative;display:flex;margin:calc(12 * var(--u)) calc(12 * var(--u)) 0;padding:calc(4 * var(--u));background:var(--ink2);border-radius:calc(12 * var(--u))}
.tabs button{position:relative;z-index:1;flex:1;min-height:calc(28 * var(--u));pointer-events:auto;cursor:pointer;border:0;background:none;color:var(--mute);
  font:600 var(--fs-sm)/1 var(--ff);padding:calc(8 * var(--u));border-radius:calc(8 * var(--u));transition:color var(--duration-fast) var(--ease-smooth-out),transform var(--duration-quick) var(--ease-smooth-out)}
.tabs button:hover{color:var(--text)}
.tabs button:active{transform:scale(.97)}
.tabs button[aria-selected=true]{color:var(--text)}
.tabs button:focus-visible{outline:calc(2 * var(--u)) solid var(--text);outline-offset:calc(1 * var(--u))}
.tabs .pill{position:absolute;z-index:0;top:calc(4 * var(--u));bottom:calc(4 * var(--u));left:0;border-radius:calc(8 * var(--u));background:var(--ink3);transition:transform var(--duration-fast) var(--ease-smooth-out)}
.tabs:not([hidden])+.score{padding-top:calc(12 * var(--u))}

.score{display:grid;grid-template-columns:1fr 1fr;gap:calc(12 * var(--u));padding:calc(16 * var(--u)) calc(16 * var(--u)) 0}
.tm .nm{display:block;font:600 var(--fs-xs)/1.3 var(--ff);color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tm.op{text-align:right}
.tm .big{display:flex;margin-top:calc(4 * var(--u));font:700 calc(34 * var(--u))/1 var(--ff);letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:var(--mute)}
.tm.op .big{justify-content:flex-end}
.tm.lead .big{color:var(--text)}
/* the win chance belongs to my side, so it sits under my score, and the bar fills from there */
.wp{display:flex;align-items:center;gap:calc(12 * var(--u));padding:calc(12 * var(--u)) calc(16 * var(--u))}
.wp .pct{font:700 var(--fs-sm)/1 var(--ff);font-variant-numeric:tabular-nums;white-space:nowrap}
.wp .pct small{color:var(--mute);font-size:inherit;font-weight:500;margin-left:calc(4 * var(--u))}
.wp .track{position:relative;flex:1;height:calc(8 * var(--u));border-radius:calc(4 * var(--u));background:var(--ink3);overflow:hidden}
.wp .track i{position:absolute;inset:0;background:var(--accent);transform-origin:0 50%;transform:scaleX(var(--p,.5));transition:transform 600ms var(--ease-smooth-out)}
.wp .track::after{content:"";position:absolute;left:calc(50% - 1 * var(--u));top:0;bottom:0;width:calc(2 * var(--u));background:var(--ink)}

.rows{list-style:none;margin:0;padding:0 0 calc(8 * var(--u))}
.r{display:flex;align-items:center;gap:calc(12 * var(--u));padding:calc(8 * var(--u)) calc(16 * var(--u))}
.av{position:relative;flex:none;width:calc(40 * var(--u));height:calc(40 * var(--u));border-radius:50%;overflow:hidden;background:var(--ink2);display:grid;place-items:center;
  font:700 var(--fs-xs)/1 var(--ff);color:var(--mute)}
.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 12%;opacity:0;transition:opacity 150ms linear}
.av.has img{opacity:1}
.av.has{background:var(--tc,var(--ink2));color:transparent}
.av.logo,.av.logo.has{background:#eef0f5}
.av.logo img{object-fit:contain;padding:calc(8 * var(--u))}
.r.pre .av,.r.bye .av{opacity:.6}
.r .who{flex:1;min-width:0}
.r .nm{display:block;font:600 calc(15 * var(--u))/1.2 var(--ff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.r.pre .nm,.r.bye .nm,.r.pre .pt,.r.bye .pt{color:var(--mute)}
.r .sub{display:block;margin-top:calc(4 * var(--u));font:500 var(--fs-xs)/1.3 var(--ff);color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.r .pt{font:700 calc(22 * var(--u))/1 var(--ff);font-variant-numeric:tabular-nums}
.r .dl{flex:none;font:700 var(--fs-sm)/1 var(--ff);color:var(--accent);font-variant-numeric:tabular-nums;animation:dl 3200ms var(--ease-smooth-out) both}
.r .dl.neg{color:var(--bad)}

.strip{display:grid;grid-template-columns:repeat(3,1fr);gap:calc(8 * var(--u));padding:calc(12 * var(--u)) calc(12 * var(--u)) calc(12 * var(--u))}
.chip{display:flex;align-items:center;gap:calc(8 * var(--u));padding:calc(4 * var(--u)) calc(8 * var(--u)) calc(4 * var(--u)) calc(4 * var(--u));border-radius:calc(999 * var(--u));background:var(--ink2);color:var(--text)}
.chip .av{width:calc(24 * var(--u));height:calc(24 * var(--u))} .chip .av.logo img{padding:calc(4 * var(--u))}
.chip b{font:700 calc(15 * var(--u))/1 var(--ff);font-variant-numeric:tabular-nums}
.chip.pre b,.chip.bye b{color:var(--mute)}
.chip.pre .av,.chip.bye .av{opacity:.6}

.ft{display:flex;flex-wrap:wrap;gap:calc(8 * var(--u));padding:0 calc(12 * var(--u)) calc(12 * var(--u))}
.ft:empty{display:none}
.pill-s{font:600 var(--fs-xs)/1.3 var(--ff);color:var(--text);background:var(--ink2);border-radius:calc(12 * var(--u));padding:calc(8 * var(--u)) calc(12 * var(--u))}
.pill-s.bad{color:var(--bad)}

/* ---- reels: digits roll from the value they had (transitions.dev spinning counter) ---- */
.reel{display:inline-flex;align-items:baseline;height:1em;line-height:1;overflow:hidden}
.rc{display:inline-block;height:1em;overflow:hidden;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 18%,#000 82%,transparent 100%);mask-image:linear-gradient(to bottom,transparent 0,#000 18%,#000 82%,transparent 100%)}
.rstrip{display:flex;flex-direction:column;will-change:transform}
.rstrip span,.rs{display:block;height:1em;line-height:1em}

/* ---- moments ---- */
#toasts{position:absolute;width:calc(300 * var(--u));display:flex;flex-direction:column;gap:calc(8 * var(--u))}
#stage.c-bl #toasts{left:var(--mx);bottom:calc(var(--my) + var(--bh) + calc(8 * var(--u)))} #stage.c-br #toasts{right:var(--mx);bottom:calc(var(--my) + var(--bh) + calc(8 * var(--u)))}
#stage.c-tl #toasts{left:var(--mx);top:calc(var(--my) + var(--bh) + calc(8 * var(--u)))} #stage.c-tr #toasts{right:var(--mx);top:calc(var(--my) + var(--bh) + calc(8 * var(--u)))}
/* on a short screen the moment sits beside the box instead of above it, so a tall card never runs off the top */
#stage.side.c-bl #toasts{left:calc(var(--mx) + 312 * var(--u));bottom:var(--my)} #stage.side.c-br #toasts{right:calc(var(--mx) + 312 * var(--u));bottom:var(--my)}
#stage.side.c-tl #toasts{left:calc(var(--mx) + 312 * var(--u));top:var(--my)} #stage.side.c-tr #toasts{right:calc(var(--mx) + 312 * var(--u));top:var(--my)}
/* in multiview a tile's moment sits on the side of the tile away from the box, so the two never overlap */
#stage.multi.c-bl #tiles .lane,#stage.multi.c-tl #tiles .lane{left:auto;right:var(--lr,calc(12 * var(--u)))}
#tiles .tile{position:absolute}
#tiles .lane{position:absolute;left:var(--ll,calc(12 * var(--u)));bottom:var(--lb,calc(12 * var(--u)));width:calc(280 * var(--u));display:flex;flex-direction:column;gap:calc(8 * var(--u))}
.mo{width:100%;background:var(--ink);border-radius:calc(16 * var(--u));box-shadow:var(--shadow);overflow:hidden;transform-origin:0 0}
.mo .head{display:flex;justify-content:space-between;align-items:center;gap:calc(12 * var(--u));padding:calc(16 * var(--u)) calc(16 * var(--u)) 0}
.mo .word{min-width:0;overflow:hidden;text-overflow:ellipsis;font:700 calc(22 * var(--u))/1.1 var(--ff);white-space:nowrap;animation:rise var(--duration-very-slow) var(--ease-smooth-out) 120ms both}
.mo.td .word{font-size:calc(26 * var(--u))}
.mo.opp .word,.mo.opp.td .word{font-size:calc(20 * var(--u))}   /* "Their touchdown" is longer: it still fits beside the pill */
.mo .vp{flex:none;display:inline-flex;align-items:center;height:calc(32 * var(--u));padding:0 calc(12 * var(--u));border-radius:calc(999 * var(--u));background:var(--accent);color:var(--accent-ink);
  font:700 calc(17 * var(--u))/1 var(--ff);font-variant-numeric:tabular-nums;animation:rise var(--duration-very-slow) var(--ease-smooth-out) 200ms both}
.mo.bad .vp,.mo.neg .vp,.mo.opp .vp{background:var(--bad);color:var(--bad-ink)}   /* their points are your loss */
.mo .who{display:flex;gap:calc(12 * var(--u));align-items:center;padding:calc(12 * var(--u)) calc(16 * var(--u)) calc(16 * var(--u));animation:rise var(--duration-very-slow) var(--ease-smooth-out) 240ms both}
.mo .who .av{width:calc(48 * var(--u));height:calc(48 * var(--u))}
.mo .who b{display:block;font:700 calc(17 * var(--u))/1.2 var(--ff)}
.mo .who em{display:block;margin-top:calc(4 * var(--u));font:500 var(--fs-sm)/1.3 var(--ff);font-style:normal;color:var(--mute)}
.mo .ch{display:flex;gap:calc(8 * var(--u));flex-wrap:wrap;padding:0 calc(16 * var(--u)) calc(16 * var(--u));animation:rise var(--duration-very-slow) var(--ease-smooth-out) 300ms both}
.mo .ch i{font:600 var(--fs-xs)/1 var(--ff);font-style:normal;background:var(--ink2);border-radius:calc(999 * var(--u));padding:calc(8 * var(--u)) calc(12 * var(--u))}
#stage.multi .mo .word{font-size:calc(17 * var(--u))} #stage.multi .mo.td .word{font-size:calc(22 * var(--u))} #stage.multi .mo .vp{height:calc(28 * var(--u));font-size:calc(15 * var(--u))}
/* the distance beside the yard line or the posts: one style for both */
.yd{font:700 calc(34 * var(--u))/1 var(--ff);font-variant-numeric:tabular-nums}
.run small,.km small{font:600 var(--fs-sm)/1 var(--ff);color:var(--mute)}
/* big play: the ball runs the yard line, the gain rolls up as it goes (ticks are 10 yards apart, the line is 60 yards long) */
.mo.big,.mo.td{--run-dur:700ms;--ease-run:cubic-bezier(.16,1,.3,1)}
.run{padding:calc(12 * var(--u)) calc(16 * var(--u)) 0;animation:rise var(--duration-very-slow) var(--ease-smooth-out) 140ms both}
.run .line{position:relative;height:calc(24 * var(--u))}
.run .line::before{content:"";position:absolute;left:0;right:0;top:50%;height:calc(4 * var(--u));margin-top:calc(-2 * var(--u));border-radius:calc(2 * var(--u));background:var(--ink3)}
.run .ticks{position:absolute;inset:0;background-image:linear-gradient(90deg,rgba(255,255,255,.28) calc(2 * var(--u)),transparent 0);background-size:calc(100% / 6) 100%}
.run.td .ticks{background-size:calc(100% / 10) 100%}
.run .trail{position:absolute;left:0;top:50%;height:calc(4 * var(--u));margin-top:calc(-2 * var(--u));width:var(--to);background:var(--accent);border-radius:calc(2 * var(--u));transform-origin:0 50%;animation:trail var(--run-dur) var(--ease-run) 180ms both}
.run .dot{position:absolute;left:0;top:50%;width:calc(14 * var(--u));height:calc(14 * var(--u));margin:calc(-7 * var(--u)) 0 0 calc(-7 * var(--u));border-radius:50%;background:var(--text);animation:dot var(--run-dur) var(--ease-run) 180ms both}
.run .end{position:absolute;left:var(--to);top:0;bottom:0;width:calc(2 * var(--u));margin-left:calc(-1 * var(--u));background:var(--accent);transform:scaleY(0);animation:flag 260ms var(--ease-smooth-out) calc(180ms + var(--run-dur) - 140ms) forwards}
.run .meta{display:flex;align-items:baseline;gap:calc(8 * var(--u));margin-top:calc(8 * var(--u))}
.run .dn{margin-left:auto;font:500 var(--fs-sm)/1 var(--ff);font-style:normal;color:var(--mute)}
/* field goal: the kick rises through the uprights (a ball on two transform tracks), the distance sits on the right like the big play's */
.kick{display:flex;align-items:center;justify-content:space-between;gap:calc(12 * var(--u));padding:calc(8 * var(--u)) calc(16 * var(--u)) 0;animation:rise var(--duration-very-slow) var(--ease-smooth-out) 140ms both}
.kick .fld{position:relative;flex:none;width:calc(142 * var(--u));height:calc(52 * var(--u))}
.kick .km{display:flex;align-items:baseline;gap:calc(8 * var(--u))}
.kick svg{display:block;width:100%;height:100%;overflow:visible}
.kick .up{fill:none;stroke:var(--text);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:draw 420ms var(--ease-smooth-out) 140ms forwards}
.kick .bx{position:absolute;left:49%;top:0;width:6%;height:0;animation:kx 780ms linear 420ms both}
.kick .by{position:absolute;left:0;top:0;width:calc(8 * var(--u));height:calc(8 * var(--u));margin:calc(-4 * var(--u)) 0 0 calc(-4 * var(--u));border-radius:50%;background:var(--accent);animation:ky 780ms cubic-bezier(.2,.7,.4,1) 420ms both}
/* turnover: one short shake, per-segment like the transitions.dev error state */
.mo.bad .head{animation:shake 440ms var(--ease-smooth-out) 140ms both}
/* ---- touchdown takeover (overlay.js celebrate): the one loud moment. Sized from the area it covers (--q is 1px on a
   1920-wide screen), so a multiview tile gets the same picture at its own size. ---- */
.party{position:absolute;overflow:hidden;display:grid;place-items:center;transition:opacity 420ms var(--ease-smooth-out)}
.party.out{opacity:0}
.party .veil{position:absolute;inset:0;background:rgba(8,9,13,.74);animation:fade 260ms linear both}
.party .flash{position:absolute;inset:0;background:#fff;opacity:0;animation:flash 460ms ease-out 400ms both}
.party .zoom{position:relative;transition:transform 420ms var(--ease-smooth-out)}
.party.out .zoom{transform:scale(1.08)}
.party .body{display:flex;flex-direction:column;align-items:center;gap:calc(128 * var(--q));animation:jolt 380ms ease-out 400ms both}
.party .word{position:relative;display:grid;place-items:center;transform:rotate(-6deg)}
.party .b1{position:absolute;left:50%;top:calc(-44 * var(--q));bottom:calc(-44 * var(--q));width:calc(var(--fw) * 1.5);margin-left:calc(var(--fw) * -.75);background:var(--tc);
  transform-origin:0 50%;animation:sweep 560ms cubic-bezier(.16,1,.3,1) 60ms both}
.party .b2{position:absolute;left:50%;bottom:calc(-80 * var(--q));height:calc(16 * var(--q));width:calc(var(--fw) * 1.5);margin-left:calc(var(--fw) * -.75);background:var(--b2);
  transform-origin:100% 50%;animation:sweep 560ms cubic-bezier(.16,1,.3,1) 180ms both}
.party .word span{grid-area:1/1;position:relative;font:900 calc(160 * var(--q))/1 var(--ff);font-stretch:125%;text-transform:uppercase;color:var(--tk);white-space:nowrap}
.party .w{animation:stamp 420ms cubic-bezier(.2,.9,.25,1) 0ms both}
.party .echo{opacity:0;animation:echo 900ms cubic-bezier(.16,1,.3,1) 420ms both}
.party .echo+.echo{animation-delay:560ms}
.party .who{display:flex;align-items:center;gap:calc(32 * var(--q));animation:up 560ms cubic-bezier(.16,1,.3,1) 600ms both}
.party .av{width:calc(152 * var(--q));height:calc(152 * var(--q));font-size:calc(40 * var(--q))}
.party .av.logo img{padding:calc(24 * var(--q))}
.party .nm b{display:block;font:800 calc(68 * var(--q))/1.05 var(--ff);color:var(--text);white-space:nowrap}
.party .nm em{display:block;margin-top:calc(12 * var(--q));font:500 calc(32 * var(--q))/1.2 var(--ff);font-style:normal;color:var(--mute);white-space:nowrap}
.party .vp{display:inline-flex;align-items:center;height:calc(104 * var(--q));padding:0 calc(36 * var(--q));margin-left:calc(16 * var(--q));border-radius:calc(999 * var(--q));
  background:var(--accent);color:var(--accent-ink);font:800 calc(60 * var(--q))/1 var(--ff);font-variant-numeric:tabular-nums;animation:up 560ms cubic-bezier(.16,1,.3,1) 720ms both}
.party .conf{position:absolute;inset:0}
.party .conf i{position:absolute;left:50%;top:44%;width:calc(var(--pw) * var(--q));height:calc(var(--ph) * var(--q));border-radius:calc(2 * var(--q));background:var(--c);opacity:0;
  animation:conf var(--dur) linear var(--d) both}
@keyframes fade{from{opacity:0}}
@keyframes flash{0%{opacity:0}20%{opacity:.2}100%{opacity:0}}
@keyframes sweep{from{transform:scaleX(0)}}
@keyframes stamp{from{transform:scale(1.9);opacity:0}to{transform:none;opacity:1}}
@keyframes echo{0%{opacity:.4;transform:none}100%{opacity:0;transform:scale(1.5)}}
@keyframes jolt{0%{transform:none}20%{transform:translate(calc(-12 * var(--q)),calc(8 * var(--q)))}45%{transform:translate(calc(9 * var(--q)),calc(-6 * var(--q)))}70%{transform:translate(calc(-4 * var(--q)),calc(3 * var(--q)))}100%{transform:none}}
@keyframes up{from{transform:translateY(calc(56 * var(--q)));opacity:0}}
@keyframes conf{0%{transform:translate(0,0) rotate(0) scale(.3);opacity:1;animation-timing-function:cubic-bezier(.15,.75,.3,1)}
  32%{transform:translate(var(--dx),var(--dy)) rotate(var(--r1)) scale(1);opacity:1;animation-timing-function:cubic-bezier(.45,0,.85,.55)}
  85%{opacity:1}100%{transform:translate(calc(var(--dx) * 1.3),calc(var(--dy) + var(--fall))) rotate(var(--r2)) scale(1);opacity:0}}
@keyframes trail{from{transform:scaleX(0)}}
@keyframes dot{from{transform:translateX(0)}to{transform:translateX(var(--span,0px))}}
@keyframes flag{to{transform:scaleY(1)}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes kx{from{transform:translateX(0)}to{transform:translateX(100%)}}
@keyframes ky{0%{transform:translateY(calc(47 * var(--u))) scale(1);opacity:1}80%{opacity:1}100%{transform:translateY(calc(6 * var(--u))) scale(.6);opacity:0}}
@keyframes shake{0%{transform:none}22%{transform:translateX(calc(-6 * var(--u)))}48%{transform:translateX(calc(8 * var(--u)))}74%{transform:translateX(calc(-4 * var(--u)))}100%{transform:none}}
@keyframes rise{from{transform:translateY(calc(8 * var(--u)));opacity:0}}
@keyframes dl{0%{opacity:0;transform:translateX(calc(8 * var(--u)))}9%{opacity:1;transform:none}82%{opacity:1}100%{opacity:0}}

/* reduced motion: nothing travels or rolls; cards and the box still fade in and out (150 ms) so they don't just pop */
@media (prefers-reduced-motion:reduce){
  #box{transition:opacity 150ms linear!important;transform:none!important}
  .tabs .pill,.wp .track i,.rstrip,.tabs button{transition:none!important}
  .mo .word,.mo .vp,.mo .who,.mo .ch,.mo .head,.run,.run .trail,.run .dot,.run .end,.kick,.kick .up,.kick .bx,.kick .by,.r .dl{animation:none!important}
  .run .end{transform:none}.run .dot{transform:translateX(var(--span,0px))}.kick .up{stroke-dashoffset:0}.kick .bx{display:none}
  .party{animation:fade 150ms linear both;transition-duration:150ms}.party *{animation:none!important;transition:none!important}.party .flash,.party .echo,.party .conf{display:none}
}
`;
  const api = { CSS };
  if (typeof module !== 'undefined') module.exports = api; else (root.SL = root.SL || {}).css = api;
})(typeof self !== 'undefined' ? self : globalThis);
