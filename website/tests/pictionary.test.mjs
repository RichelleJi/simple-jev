import test from 'node:test';
import assert from 'node:assert/strict';
import {levels,idFor,buildRequest,guessesFrom} from '../cool-demo/pictionary/request.mjs';

const drawing='data:image/png;base64,YWJj';
const answerFor=(level,winner)=>{
 const ids=levels[level].words.map(idFor);
 const probabilities=Object.fromEntries(ids.map(k=>[k,k===winner?0.9:0.1/(ids.length-1)]));
 return {answers:{drawing:{type:'choice',choice:winner,confidence:0.9,probabilities}}};
};

test('word lists fit the choice limit and produce unique readable IDs',()=>{
 for(const [name,{words,winAt}] of Object.entries(levels)){
  assert.ok(words.length>=2&&words.length<=50,name);
  const ids=words.map(idFor);
  assert.equal(new Set(ids).size,ids.length,name);
  for(const id of ids)assert.match(id,/^[a-z0-9]+(_[a-z0-9]+)*$/);
  assert.ok(winAt>0&&winAt<1);
 }
 assert.equal(idFor('the smell of rain'),'the_smell_of_rain');
 assert.equal(idFor('Wi-Fi'),'wi_fi');
});

test('request sends one drawing with a choice over the current level only',()=>{
 const r=buildRequest('featherless-ai/gemma-4-26B-A4B-classifier','absurd',drawing);
 assert.equal(r.state,undefined);
 assert.equal(r.messages[0].content.filter(x=>x.type==='image_url').length,1);
 assert.equal(r.messages[0].content[1].image_url.url,drawing);
 assert.deepEqual(Object.keys(r.questions),['drawing']);
 assert.deepEqual(Object.keys(r.questions.drawing.criteria),levels.absurd.words.map(idFor));
 assert.ok(!('cat' in r.questions.drawing.criteria));
 assert.throws(()=>buildRequest('featherless-ai/RWKV-small-classifier','normal',drawing),/vision model/);
 assert.throws(()=>buildRequest('featherless-ai/gemma-4-26B-A4B-classifier','impossible',drawing),/difficulty/);
 assert.throws(()=>buildRequest('featherless-ai/gemma-4-26B-A4B-classifier','normal','https://example.com/x.png'),/drawing/);
});

test('guesses come back sorted with display words',()=>{
 const g=guessesFrom(answerFor('normal','ice_cream'),'normal');
 assert.equal(g.length,levels.normal.words.length);
 assert.equal(g[0].id,'ice_cream');
 assert.equal(g[0].word,'ice cream');
 for(let i=1;i<g.length;i++)assert.ok(g[i-1].p>=g[i].p);
});

test('invalid or mismatched answers cannot be displayed as guesses',()=>{
 const good=answerFor('normal','cat');
 assert.throws(()=>guessesFrom(good,'absurd'),/invalid/);
 const bad=[
  a=>{a.answers.drawing.choice='dragon'},
  a=>{delete a.answers.drawing.probabilities.book},
  a=>{a.answers.drawing.probabilities.dog=NaN},
  a=>{a.answers.drawing.probabilities.dog=1.2},
 ];
 for(const breakIt of bad){const a=answerFor('normal','cat');breakIt(a);assert.throws(()=>guessesFrom(a,'normal'),/invalid/);}
 assert.throws(()=>guessesFrom({},'normal'),/invalid/);
});
