import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {app} from './helpers/app-fixture.mjs';

const assets=['طلا','شمش نقره 999','فملی','BTC','Tether','دلار'];
const stamp='2026-10-11T09:00:00Z';
const report=amounts=>({vals:Object.fromEntries(assets.map((asset,index)=>[asset,amounts[index]])),total:amounts.reduce((sum,value)=>sum+value,0),priceTime:stamp});
const boxes=svg=>[...svg.matchAll(/<rect data-label-category="([^"]+)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(match=>({category:match[1],x:+match[2],y:+match[3],w:+match[4],h:+match[5]}));

test('Estedad regular and bold are authentic bundled fonts and included in the Vercel function',async()=>{
  const expected={Regular:'812996efdeff8fd68bb854fbb3db218886661fbfd50ed38a06d50bd14c1f3c7f',Bold:'7fa317abae24c82aef5a5816bba4be8b86b344bd740c600276bcb738e416dd76'};
  for(const [weight,digest] of Object.entries(expected)){
    const font=await fs.readFile(new URL('../assets/fonts/Estedad-'+weight+'.ttf',import.meta.url));
    assert.equal(createHash('sha256').update(font).digest('hex'),digest);
  }
  assert.match(await fs.readFile(new URL('../assets/fonts/OFL.txt',import.meta.url),'utf8'),/SIL OPEN FONT LICENSE Version 1.1/);
  const config=JSON.parse(await fs.readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.functions['api/telegram.js'].includeFiles,'assets/fonts/**');
  const a=await app(),svg=a.ns.buildAllocationPieSvg(report([37,9,23,11,7,13]));
  assert.match(svg,/font-family="Estedad"/);
  assert.match(svg,/<rect width="1600" height="1160" fill="#101b2e"/);
  const metadata=await sharp(a.ns.renderAllocationSvg(svg)).metadata();
  assert.equal(metadata.width,1600);assert.equal(metadata.height,1160);
});

test('every positive-group callout starts on its corresponding slice and keeps the exact calculated percentage',async()=>{
  const a=await app(),data=report([37,9,23,11,7,13]);
  const svg=a.ns.buildAllocationPieSvg(data);
  const groups=a.ns.allocationGroups(data.vals,data.total);
  let angle=-Math.PI/2;
  for(const group of groups){
    const end=angle+group.percentage/100*2*Math.PI,middle=(angle+end)/2;
    const leader=[...svg.matchAll(/data-leader-category="([^"]+)" data-anchor="([\d.-]+) ([\d.-]+)"/g)].find(match=>match[1]===group.category);
    assert.ok(leader,group.category);
    assert.ok(Math.abs(+leader[2]-(800+440*Math.cos(middle)))<.001);
    assert.ok(Math.abs(+leader[3]-(565+242*Math.sin(middle)))<.001);
    assert.ok(svg.includes('data-category="'+group.category+'" data-percentage="'+group.percentage+'"'));
    assert.ok(svg.includes('>'+group.label+'</text>'));
    angle=end;
  }
  assert.equal((svg.match(/data-layer="leader"/g)||[]).length,6);
});

test('callouts do not overlap or leave the canvas with balanced, tiny, dominant and zero groups',async()=>{
  const a=await app();
  for(const amounts of [[1,1,1,1,1,1],[99.9999995,.0000001,.0000001,.0000001,.0000001,.0000001],[0,1,0,0,0,0],[70,0,0,10,0,20],[.01,15,20,30,35,0]]){
    const svg=a.ns.buildAllocationPieSvg(report(amounts)),labels=boxes(svg);
    assert.equal(labels.length,6);assert.equal(new Set(labels.map(label=>label.category)).size,6);
    assert.doesNotMatch(svg,/NaN|Infinity/);
    assert.equal((svg.match(/data-layer="leader"/g)||[]).length,amounts.filter(value=>value>0).length);
    for(const [index,label] of labels.entries()){
      assert.ok(label.x>=0&&label.y>=184&&label.x+label.w<=1600&&label.y+label.h<1038);
      for(const other of labels.slice(index+1))
        assert.ok(label.x+label.w<=other.x||other.x+other.w<=label.x||label.y+label.h<=other.y||other.y+other.h<=label.y);
    }
    const png=a.ns.renderAllocationSvg(svg);assert.ok(png.length>1000);
  }
});
