// Resize the existing artwork; keep the same 4 x 2 sprite frame grid.
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
const root=new URL('../public/assets/mining/',import.meta.url),results=[];
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage();
 const sources=[{name:'toy-cavern-v2',widths:[640,960,1440]},...['copper','silver','gold'].map(tier=>({name:'toy-miner-'+tier+'-v3',widths:[1024]}))];
 for(const {name,widths} of sources){
  const original=await fs.readFile(new URL(name+'.webp',root));
  for(const width of widths){
   const result=await page.evaluate(async({data,width})=>{
    const image=new Image();image.src=data;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.round(image.height*width/image.width);
    const context=canvas.getContext('2d');context.imageSmoothingQuality='high';context.drawImage(image,0,0,canvas.width,canvas.height);
    return {width:canvas.width,height:canvas.height,data:canvas.toDataURL('image/webp',.9).split(',')[1]};
   },{data:'data:image/webp;base64,'+original.toString('base64'),width});
   const output=name+'-w'+width+'.webp',bytes=Buffer.from(result.data,'base64');await fs.writeFile(new URL(output,root),bytes);
   results.push({file:output,width:result.width,height:result.height,bytes:bytes.length,originalBytes:original.length});
  }
 }
}finally{await browser.close();}
console.log(JSON.stringify(results,null,2));
